const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const {
  ROOT, CONFIG, YEAR, HTML_FILE, HTML_URL_PATH, outputName,
} = require('./project_config.cjs');
const { resolveBrowserExecutable } = require('./browser_runtime.cjs');

sharp.concurrency(2);
sharp.cache({ memory: 256, files: 20, items: 100 });

const OUTPUT_PNG = path.join(ROOT, 'output', 'png');
const OUTPUT_PDF = path.join(ROOT, 'output', 'pdf');
const OUTPUT_PREVIEW = path.join(ROOT, 'output', 'preview');
const OUTPUT_ROLLUP_HIRES = path.join(ROOT, 'output', 'rollup-600dpi-strips');
const TMP_RENDER = path.join(ROOT, 'tmp', 'render');
const CHROME = resolveBrowserExecutable();

for (const dir of [OUTPUT_PNG, OUTPUT_PDF, OUTPUT_PREVIEW, TMP_RENDER]) {
  fs.mkdirSync(dir, { recursive: true });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function createStaticServer() {
  return http.createServer((req, res) => {
    try {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      if (parsed.pathname === '/favicon.ico') {
        res.writeHead(204).end();
        return;
      }
      const pathname = decodeURIComponent(parsed.pathname === '/' ? HTML_URL_PATH : parsed.pathname);
      const requested = path.resolve(ROOT, `.${pathname}`);
      if (!requested.startsWith(ROOT + path.sep) && requested !== ROOT) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(requested).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(requested).pipe(res);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
}

async function renderElement(browser, baseUrl, spec) {
  const context = await browser.newContext({
    viewport: spec.viewport,
    deviceScaleFactor: spec.dpr,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => browserErrors.push(`page: ${error.message}`));
  page.on('requestfailed', request => browserErrors.push(`request: ${request.url()} — ${request.failure()?.errorText}`));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [...document.images];
    await Promise.all(images.map(image => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', () => reject(new Error(`Image failed: ${image.src}`)), { once: true });
      });
    }));
    const broken = images.filter(image => !image.complete || image.naturalWidth === 0);
    if (broken.length) throw new Error(`Broken images: ${broken.map(image => image.src).join(', ')}`);
  });

  if (spec.transparent) {
    await page.evaluate(() => {
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
    });
  }

  const locator = page.locator(spec.selector);
  await locator.waitFor({ state: 'visible' });
  const rawPath = path.join(TMP_RENDER, `${spec.name}-raw.png`);
  const capturePath = spec.directTiledOutput ? spec.output : rawPath;
  if (spec.tiled) {
    await captureTiledElement(page, spec, capturePath);
  } else {
    await locator.screenshot({
      path: rawPath,
      type: 'png',
      animations: 'disabled',
      scale: 'device',
      omitBackground: Boolean(spec.transparent),
    });
  }
  if (!spec.directTiledOutput) {
    let output = sharp(rawPath)
      .resize(spec.width, spec.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 });
    if (!spec.transparent) output = output.flatten({ background: '#ffffff' });
    if (spec.circularMask) {
      const mask = Buffer.from(
        `<svg width="${spec.width}" height="${spec.height}" xmlns="http://www.w3.org/2000/svg">`
          + `<circle cx="${spec.width / 2}" cy="${spec.height / 2}" r="${Math.min(spec.width, spec.height) / 2}" fill="white"/>`
          + '</svg>',
      );
      output = output.composite([{ input: mask, blend: 'dest-in' }]);
    }
    await output
      .withMetadata({ density: spec.density })
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toFile(spec.output);
  }

  const metadata = await sharp(spec.output).metadata();
  if (metadata.width !== spec.width || metadata.height !== spec.height) {
    throw new Error(`${spec.name} size mismatch: ${metadata.width}x${metadata.height}`);
  }
  if (browserErrors.length) {
    throw new Error(`${spec.name} browser errors:\n${browserErrors.join('\n')}`);
  }
  await context.close();
  console.log(`${spec.name}: ${metadata.width}x${metadata.height}, ${spec.density} dpi -> ${spec.output}`);
}

async function captureTiledElement(page, spec, rawPath) {
  const cssWidth = spec.cssWidth;
  const cssHeight = spec.cssHeight;
  const tileHeight = spec.tileHeight || 500;
  const tileOverlap = spec.tileOverlap || 0;

  await page.evaluate(({ selector, cssWidth, cssHeight }) => {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`Missing tiled target: ${selector}`);
    document.querySelectorAll('.sheet, .fan-export').forEach(sheet => {
      if (sheet !== target) sheet.style.display = 'none';
    });
    const stage = document.querySelector('.design-stage');
    stage.style.cssText = 'display:block;position:relative;width:100%;height:100%;padding:0;margin:0;overflow:visible;';
    document.documentElement.style.cssText = `margin:0;width:${cssWidth}px;height:${cssHeight}px;overflow:hidden;background:#fff;`;
    document.body.style.cssText = `margin:0;width:${cssWidth}px;height:${cssHeight}px;overflow:hidden;background:#fff;`;
    target.style.cssText += `;position:absolute;left:0;top:0;margin:0;width:${cssWidth}px;height:${cssHeight}px;box-shadow:none;`;
  }, { selector: spec.selector, cssWidth, cssHeight });

  const tiles = [];
  for (let offset = 0; offset < cssHeight; offset += tileHeight) {
    const height = Math.min(tileHeight, cssHeight - offset);
    const before = Math.min(tileOverlap, offset);
    const after = Math.min(tileOverlap, cssHeight - (offset + height));
    const captureStart = offset - before;
    const captureHeight = before + height + after;
    const pixelTop = Math.round(offset * spec.dpr);
    const pixelBottom = Math.round((offset + height) * spec.dpr);
    const pixelHeight = pixelBottom - pixelTop;
    await page.setViewportSize({ width: cssWidth, height: captureHeight });
    await page.evaluate(({ selector, captureStart }) => {
      const target = document.querySelector(selector);
      target.style.top = `${-captureStart}px`;
    }, { selector: spec.selector, captureStart });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const buffer = await page.screenshot({
      type: 'png',
      animations: 'disabled',
      clip: { x: 0, y: 0, width: cssWidth, height: captureHeight },
      scale: 'device',
    });
    const trimmed = tileOverlap
      ? await sharp(buffer)
          .extract({
            left: 0,
            top: Math.round(before * spec.dpr),
            width: Math.round(cssWidth * spec.dpr),
            height: pixelHeight,
          })
          .png({ compressionLevel: 4, adaptiveFiltering: true })
          .toBuffer()
      : buffer;
    tiles.push({ input: trimmed, left: 0, top: pixelTop });
  }

  let output = sharp({
    create: {
      width: Math.round(cssWidth * spec.dpr),
      height: Math.round(cssHeight * spec.dpr),
      channels: 3,
      background: '#ffffff',
    },
  }).composite(tiles);
  if (spec.directTiledOutput) output = output.withMetadata({ density: spec.density });
  await output
    .png({ compressionLevel: spec.directTiledOutput ? 6 : 4, adaptiveFiltering: true, palette: false })
    .toFile(rawPath);
}

async function captureRollupHiresStrips(browser, baseUrl) {
  const cssWidth = 1200;
  const cssHeight = 3000;
  const tileHeight = 250;
  const tileOverlap = 24;
  const dpr = 15.748;
  const targetWidth = 18898;
  const targetHeight = 3937;
  const stripCount = Math.ceil(cssHeight / tileHeight);
  const selector = '#rollup';
  const rawTilePath = path.join(TMP_RENDER, 'rollup-600dpi-current-raw.png');

  if (stripCount !== 12 || cssHeight % tileHeight !== 0) {
    throw new Error(`Unexpected 600 dpi roll-up strip geometry: ${stripCount} strips`);
  }

  fs.mkdirSync(OUTPUT_ROLLUP_HIRES, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: cssWidth, height: tileHeight + tileOverlap * 2 },
    deviceScaleFactor: dpr,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => browserErrors.push(`page: ${error.message}`));
  page.on('requestfailed', request => browserErrors.push(`request: ${request.url()} — ${request.failure()?.errorText}`));

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(async ({ selector, cssWidth, cssHeight }) => {
      await document.fonts.ready;
      const images = [...document.images];
      await Promise.all(images.map(image => {
        if (image.complete) return Promise.resolve();
        return new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', () => reject(new Error(`Image failed: ${image.src}`)), { once: true });
        });
      }));
      const broken = images.filter(image => !image.complete || image.naturalWidth === 0);
      if (broken.length) throw new Error(`Broken images: ${broken.map(image => image.src).join(', ')}`);

      const target = document.querySelector(selector);
      if (!target) throw new Error(`Missing 600 dpi roll-up target: ${selector}`);
      document.querySelectorAll('.sheet, .fan-export').forEach(sheet => {
        if (sheet !== target) sheet.style.display = 'none';
      });
      const stage = document.querySelector('.design-stage');
      stage.style.cssText = 'display:block;position:relative;width:100%;height:100%;padding:0;margin:0;overflow:visible;';
      document.documentElement.style.cssText = `margin:0;width:${cssWidth}px;height:${cssHeight}px;overflow:hidden;background:#fff;`;
      document.body.style.cssText = `margin:0;width:${cssWidth}px;height:${cssHeight}px;overflow:hidden;background:#fff;`;
      target.style.cssText += `;position:absolute;left:0;top:0;margin:0;width:${cssWidth}px;height:${cssHeight}px;box-shadow:none;`;
    }, { selector, cssWidth, cssHeight });

    for (let index = 0; index < stripCount; index += 1) {
      console.log(`rollup-600dpi strip ${String(index + 1).padStart(2, '0')}/12: capturing...`);
      const offset = index * tileHeight;
      const before = Math.min(tileOverlap, offset);
      const after = Math.min(tileOverlap, cssHeight - (offset + tileHeight));
      const captureStart = offset - before;
      const captureHeight = before + tileHeight + after;

      await page.setViewportSize({ width: cssWidth, height: captureHeight });
      await page.evaluate(({ selector, captureStart }) => {
        document.querySelector(selector).style.top = `${-captureStart}px`;
      }, { selector, captureStart });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({
        path: rawTilePath,
        type: 'png',
        animations: 'disabled',
        clip: { x: 0, y: 0, width: cssWidth, height: captureHeight },
        scale: 'device',
      });

      const rawMetadata = await sharp(rawTilePath).metadata();
      const cropTop = Math.round(before * dpr);
      if (!rawMetadata.width || !rawMetadata.height || rawMetadata.height < cropTop + targetHeight) {
        throw new Error(
          `Roll-up strip ${index + 1} raw capture too small: ${rawMetadata.width}x${rawMetadata.height}`,
        );
      }
      const output = path.join(
        OUTPUT_ROLLUP_HIRES,
        outputName(`rollup-80x200cm-600dpi-strip-${String(index + 1).padStart(2, '0')}-of-12.png`),
      );
      await sharp(rawTilePath)
        .extract({ left: 0, top: cropTop, width: rawMetadata.width, height: targetHeight })
        .resize(targetWidth, targetHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .flatten({ background: '#ffffff' })
        .withMetadata({ density: 600 })
        .png({ compressionLevel: 6, adaptiveFiltering: true, palette: false })
        .toFile(output);

      const metadata = await sharp(output).metadata();
      if (metadata.width !== targetWidth || metadata.height !== targetHeight) {
        throw new Error(`Roll-up strip ${index + 1} size mismatch: ${metadata.width}x${metadata.height}`);
      }
      console.log(
        `rollup-600dpi strip ${String(index + 1).padStart(2, '0')}/12: `
          + `${metadata.width}x${metadata.height}, 600 dpi -> ${output}`,
      );
    }

    if (browserErrors.length) {
      throw new Error(`rollup-600dpi browser errors:\n${browserErrors.join('\n')}`);
    }
  } finally {
    await context.close();
    if (fs.existsSync(rawTilePath)) fs.unlinkSync(rawTilePath);
  }
}

async function renderHiresOutputs(browser, baseUrl) {
  await renderElement(browser, baseUrl, {
    name: 'rollup-80x200cm-300dpi', selector: '#rollup',
    output: path.join(OUTPUT_PNG, outputName('rollup-80x200cm-300dpi.png')),
    viewport: { width: 1200, height: 300 }, dpr: 7.874,
    tiled: true, directTiledOutput: true,
    cssWidth: 1200, cssHeight: 3000, tileHeight: 250, tileOverlap: 24,
    width: 9449, height: 23622, density: 300,
  });
}

async function makeA4Preview(frontPath, backPath) {
  const itemHeight = 1180;
  const itemWidth = Math.round(itemHeight * 2480 / 3508);
  const margin = 68;
  const gap = 58;
  const canvasWidth = margin * 2 + itemWidth * 2 + gap;
  const canvasHeight = itemHeight + margin * 2;
  const [front, back] = await Promise.all([
    sharp(frontPath).resize({ height: itemHeight }).png().toBuffer(),
    sharp(backPath).resize({ height: itemHeight }).png().toBuffer(),
  ]);
  const previewPath = path.join(OUTPUT_PREVIEW, 'A4-double-sided-preview.png');
  await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 3, background: '#dfe9f4' },
  })
    .composite([
      { input: front, left: margin, top: margin },
      { input: back, left: margin + itemWidth + gap, top: margin },
    ])
    .png({ compressionLevel: 9 })
    .toFile(previewPath);
  console.log(`A4 preview -> ${previewPath}`);
}

async function makeFanPreview(frontPath, backPath) {
  const itemSize = 920;
  const margin = 76;
  const gap = 64;
  const canvasWidth = margin * 2 + itemSize * 2 + gap;
  const canvasHeight = itemSize + margin * 2;
  const [front, back] = await Promise.all([
    sharp(frontPath).resize(itemSize, itemSize).png().toBuffer(),
    sharp(backPath).resize(itemSize, itemSize).png().toBuffer(),
  ]);
  const previewPath = path.join(OUTPUT_PREVIEW, 'round-fan-double-sided-preview.png');
  await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 3, background: '#dfe9f4' },
  })
    .composite([
      { input: front, left: margin, top: margin },
      { input: back, left: margin + itemSize + gap, top: margin },
    ])
    .png({ compressionLevel: 9 })
    .toFile(previewPath);
  console.log(`Round fan preview -> ${previewPath}`);
}

async function makeReviewPreviews(specs) {
  for (const spec of specs) {
    const previewPath = path.join(OUTPUT_PREVIEW, `${spec.name}-review.png`);
    await sharp(spec.output)
      .resize({ width: spec.name === 'rollup-80x200cm' ? 720 : 850, withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toFile(previewPath);
  }
}

async function addPngPage(pdf, pngPath, widthPt, heightPt) {
  const bytes = fs.readFileSync(pngPath);
  const image = await pdf.embedPng(bytes);
  const page = pdf.addPage([widthPt, heightPt]);
  page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
}

async function writePdfs(frontPath, backPath, rollupPath) {
  const a4 = await PDFDocument.create();
  a4.setTitle(`东北大学电视台 ${YEAR} 招新宣传单`);
    a4.setAuthor('东北大学融媒体中心 · 东北大学电视台');
  a4.setSubject('A4 双面招新宣传单');
  await addPngPage(a4, frontPath, 595.2755906, 841.8897638);
  await addPngPage(a4, backPath, 595.2755906, 841.8897638);
  const a4Path = path.join(OUTPUT_PDF, outputName('A4-double-sided.pdf'));
  fs.writeFileSync(a4Path, await a4.save({ useObjectStreams: false }));

  const rollup = await PDFDocument.create();
  rollup.setTitle(`东北大学电视台 ${YEAR} 招新易拉宝`);
    rollup.setAuthor('东北大学融媒体中心 · 东北大学电视台');
  rollup.setSubject('80 × 200 cm 招新易拉宝');
  await addPngPage(rollup, rollupPath, 2267.7165354, 5669.2913386);
  const rollupPdfPath = path.join(OUTPUT_PDF, outputName('rollup-80x200cm.pdf'));
  fs.writeFileSync(rollupPdfPath, await rollup.save({ useObjectStreams: false }));
  console.log(`A4 PDF -> ${a4Path}`);
  console.log(`Roll-up PDF -> ${rollupPdfPath}`);
}

async function main() {
  if (!fs.existsSync(HTML_FILE)) throw new Error(`Missing HTML: ${HTML_FILE}`);
  const rollupOnly = process.argv.includes('--rollup-only');
  if (process.argv.includes('--hires')) {
    throw new Error('--hires is retired. Set output.a4Dpi or output.rollupDpi in project.config.json instead.');
  }

  const server = createStaticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}${HTML_URL_PATH}`;

  const a4Dpi = CONFIG.output.a4Dpi;
  const rollupDpi = CONFIG.output.rollupDpi;
  const a4Width = Math.round(210 / 25.4 * a4Dpi);
  const a4Height = Math.round(297 / 25.4 * a4Dpi);
  const rollupWidth = Math.round(CONFIG.output.rollupWidthMm / 25.4 * rollupDpi);
  const rollupHeight = Math.round(CONFIG.output.rollupHeightMm / 25.4 * rollupDpi);
  const frontPath = path.join(OUTPUT_PNG, outputName('A4-front.png'));
  const backPath = path.join(OUTPUT_PNG, outputName('A4-back.png'));
  const rollupPath = path.join(OUTPUT_PNG, outputName(`rollup-80x200cm-${rollupDpi}dpi.png`));
  const fanFrontPath = path.join(OUTPUT_PNG, outputName('round-fan-front.png'));
  const fanBackPath = path.join(OUTPUT_PNG, outputName('round-fan-back.png'));
  const fanSize = CONFIG.output.fanSizePx;
  const fanDpi = CONFIG.output.fanDpi;
  const specs = [
    {
      name: 'A4-front', selector: '#a4-front', output: frontPath,
      viewport: { width: 1320, height: 1900 }, dpr: 2,
      width: a4Width, height: a4Height, density: a4Dpi,
    },
    {
      name: 'A4-back', selector: '#a4-back', output: backPath,
      viewport: { width: 1320, height: 1900 }, dpr: 2,
      width: a4Width, height: a4Height, density: a4Dpi,
    },
    {
      name: 'rollup-80x200cm', selector: '#rollup', output: rollupPath,
      viewport: { width: 1200, height: 500 }, dpr: rollupHeight / 3000,
      tiled: true, cssWidth: 1200, cssHeight: 3000, tileHeight: 500, tileOverlap: 24,
      width: rollupWidth, height: rollupHeight, density: rollupDpi,
    },
    {
      name: 'round-fan-front', selector: '#fan-front', output: fanFrontPath,
      viewport: { width: 1320, height: 1320 }, dpr: fanSize / 1200,
      width: fanSize, height: fanSize, density: fanDpi, transparent: true, circularMask: true,
    },
    {
      name: 'round-fan-back', selector: '#fan-back', output: fanBackPath,
      viewport: { width: 1320, height: 1320 }, dpr: fanSize / 1200,
      width: fanSize, height: fanSize, density: fanDpi, transparent: true, circularMask: true,
    },
  ];
  const selectedSpecs = rollupOnly ? specs.filter(spec => spec.selector === '#rollup') : specs;

  const browserArgs = [
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
  ];
  let browser;
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: browserArgs });
    for (const spec of selectedSpecs) await renderElement(browser, baseUrl, spec);
    await browser.close();
    browser = undefined;

    if (process.argv.includes('--hires')) {
      browser = await chromium.launch({
        executablePath: CHROME,
        headless: true,
        args: browserArgs,
      });
      await renderHiresOutputs(browser, baseUrl);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  if (!rollupOnly) {
    await makeA4Preview(frontPath, backPath);
    await makeFanPreview(fanFrontPath, fanBackPath);
    await makeReviewPreviews(specs);
  }

  if (process.argv.includes('--with-pdf')) {
    if (rollupOnly) throw new Error('--with-pdf cannot be combined with --rollup-only');
    await writePdfs(frontPath, backPath, rollupPath);
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
