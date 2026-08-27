const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { PDFDocument } = require('pdf-lib');
const {
  ROOT, YEAR, HTML_FILE, HTML_URL_PATH, outputName,
} = require('./project_config.cjs');
const { resolveBrowserExecutable } = require('./browser_runtime.cjs');

const OUTPUT_PDF = path.join(ROOT, 'output', 'pdf');
const CHROME = resolveBrowserExecutable();
const MM_TO_PT = 72 / 25.4;

const OUTPUTS = {
  a4: path.join(OUTPUT_PDF, outputName('A4-double-sided.pdf')),
  rollup: path.join(OUTPUT_PDF, outputName('rollup-80x200cm.pdf')),
};

const SPECS = {
  front: {
    name: 'A4 front',
    selector: '#a4-front',
    cssWidth: 1240,
    cssHeight: 1754,
    paperWidthMm: 210,
    paperHeightMm: 297,
  },
  back: {
    name: 'A4 back',
    selector: '#a4-back',
    cssWidth: 1240,
    cssHeight: 1754,
    paperWidthMm: 210,
    paperHeightMm: 297,
  },
  rollup: {
    name: '80 x 200 cm roll-up',
    selector: '#rollup',
    cssWidth: 1200,
    cssHeight: 3000,
    paperWidthMm: 800,
    paperHeightMm: 2000,
  },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function createStaticServer() {
  return http.createServer((request, response) => {
    try {
      const parsed = new URL(request.url, 'http://127.0.0.1');
      if (parsed.pathname === '/favicon.ico') {
        response.writeHead(204).end();
        return;
      }

      const pathname = decodeURIComponent(
        parsed.pathname === '/' ? HTML_URL_PATH : parsed.pathname,
      );
      const requested = path.resolve(ROOT, `.${pathname}`);
      const insideRoot = requested === ROOT || requested.startsWith(`${ROOT}${path.sep}`);
      if (!insideRoot) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }

      response.writeHead(200, {
        'Content-Type': MIME[path.extname(requested).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(requested).pipe(response);
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
}

async function waitForAssets(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [...document.images];
    await Promise.all(images.map(async image => {
      if (image.complete && image.naturalWidth > 0) return;
      if (typeof image.decode === 'function') {
        await image.decode();
        return;
      }
      await new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', () => reject(new Error(`Image failed: ${image.src}`)), {
          once: true,
        });
      });
    }));

    const broken = images.filter(image => !image.complete || image.naturalWidth === 0);
    if (broken.length) {
      throw new Error(`Broken images: ${broken.map(image => image.src).join(', ')}`);
    }
  });
}

async function prepareSingleSheet(page, spec) {
  await page.emulateMedia({ media: 'screen' });
  await page.addStyleTag({
    content: `
      @page {
        size: ${spec.paperWidthMm}mm ${spec.paperHeightMm}mm;
        margin: 0;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: ${spec.paperWidthMm}mm !important;
        height: ${spec.paperHeightMm}mm !important;
        min-width: 0 !important;
        min-height: 0 !important;
        overflow: hidden !important;
        background: white !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    `,
  });

  const geometry = await page.evaluate(({ selector, cssWidth, cssHeight, paperWidthMm, paperHeightMm }) => {
    const target = document.querySelector(selector);
    const stage = document.querySelector('.design-stage');
    if (!target) throw new Error(`Missing print target: ${selector}`);
    if (!stage) throw new Error('Missing .design-stage');

    document.querySelectorAll('.sheet').forEach(sheet => {
      if (sheet !== target) sheet.style.setProperty('display', 'none', 'important');
    });

    stage.style.cssText = [
      'display:block',
      'position:relative',
      `width:${paperWidthMm}mm`,
      `height:${paperHeightMm}mm`,
      'margin:0',
      'padding:0',
      'gap:0',
      'overflow:hidden',
      'background:white',
    ].join(';');

    target.style.setProperty('display', 'block', 'important');
    target.style.position = 'absolute';
    target.style.left = '0';
    target.style.top = '0';
    target.style.margin = '0';
    target.style.width = `${cssWidth}px`;
    target.style.height = `${cssHeight}px`;
    target.style.boxShadow = 'none';
    target.style.transformOrigin = '0 0';

    const stageRect = stage.getBoundingClientRect();
    const scaleX = stageRect.width / cssWidth;
    const scaleY = stageRect.height / cssHeight;
    target.style.transform = `scale(${scaleX}, ${scaleY})`;

    document.getAnimations().forEach(animation => animation.finish());
    const targetRect = target.getBoundingClientRect();
    return {
      stage: { width: stageRect.width, height: stageRect.height },
      target: { width: targetRect.width, height: targetRect.height },
      scaleX,
      scaleY,
    };
  }, spec);

  const widthError = Math.abs(geometry.stage.width - geometry.target.width);
  const heightError = Math.abs(geometry.stage.height - geometry.target.height);
  if (widthError > 0.25 || heightError > 0.25) {
    throw new Error(
      `${spec.name} print geometry mismatch: ` +
      `${widthError.toFixed(3)}px wide, ${heightError.toFixed(3)}px high`,
    );
  }

  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  return geometry;
}

async function exportSheet(browser, baseUrl, spec, outputPath) {
  const context = await browser.newContext({
    viewport: { width: Math.max(spec.cssWidth, 1280), height: 1200 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);

  const browserErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => browserErrors.push(`page: ${error.message}`));
  page.on('requestfailed', request => {
    browserErrors.push(`request: ${request.url()} - ${request.failure()?.errorText}`);
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await waitForAssets(page);
    const geometry = await prepareSingleSheet(page, spec);
    await page.pdf({
      path: outputPath,
      width: `${spec.paperWidthMm}mm`,
      height: `${spec.paperHeightMm}mm`,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      displayHeaderFooter: false,
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
      outline: true,
      timeout: 180_000,
    });

    if (browserErrors.length) {
      throw new Error(`${spec.name} browser errors:\n${browserErrors.join('\n')}`);
    }
    console.log(
      `${spec.name}: CSS scale ${geometry.scaleX.toFixed(6)} x ${geometry.scaleY.toFixed(6)}`,
    );
  } finally {
    await context.close();
  }
}

function points(mm) {
  return mm * MM_TO_PT;
}

async function embedSourcePage(targetPdf, sourcePath, expectedPageCount = 1) {
  const sourcePdf = await PDFDocument.load(fs.readFileSync(sourcePath));
  if (sourcePdf.getPageCount() !== expectedPageCount) {
    throw new Error(
      `${sourcePath} has ${sourcePdf.getPageCount()} pages; expected ${expectedPageCount}`,
    );
  }
  return targetPdf.embedPage(sourcePdf.getPage(0));
}

function addExactPage(pdf, embeddedPage, widthMm, heightMm) {
  const widthPt = points(widthMm);
  const heightPt = points(heightMm);
  const page = pdf.addPage([widthPt, heightPt]);
  page.drawPage(embeddedPage, { x: 0, y: 0, width: widthPt, height: heightPt });
}

function applyMetadata(pdf, { title, subject }) {
  pdf.setTitle(title);
    pdf.setAuthor('东北大学融媒体中心 · 东北大学电视台');
  pdf.setSubject(subject);
  pdf.setCreator(`NEUTV ${YEAR} HTML print pipeline`);
  pdf.setProducer('Google Chrome + pdf-lib (vector-preserving page normalization)');
  pdf.setLanguage('zh-CN');
}

async function saveA4(frontSource, backSource, outputPath) {
  const pdf = await PDFDocument.create();
  applyMetadata(pdf, {
    title: `东北大学电视台 ${YEAR} 招新宣传单`,
    subject: 'A4 双面招新宣传单 · 210 × 297 mm',
  });

  const front = await embedSourcePage(pdf, frontSource);
  const back = await embedSourcePage(pdf, backSource);
  addExactPage(pdf, front, 210, 297);
  addExactPage(pdf, back, 210, 297);
  fs.writeFileSync(outputPath, await pdf.save({ useObjectStreams: true }));
}

async function saveRollup(rollupSource, outputPath) {
  const pdf = await PDFDocument.create();
  applyMetadata(pdf, {
    title: `东北大学电视台 ${YEAR} 招新易拉宝`,
    subject: '80 × 200 cm 招新易拉宝 · 800 × 2000 mm',
  });

  const rollup = await embedSourcePage(pdf, rollupSource);
  addExactPage(pdf, rollup, 800, 2000);
  fs.writeFileSync(outputPath, await pdf.save({ useObjectStreams: true }));
}

async function verifyOutput(filePath, expectedPages) {
  const pdf = await PDFDocument.load(fs.readFileSync(filePath));
  if (pdf.getPageCount() !== expectedPages.length) {
    throw new Error(
      `${filePath} has ${pdf.getPageCount()} pages; expected ${expectedPages.length}`,
    );
  }

  const tolerancePt = 0.01;
  pdf.getPages().forEach((page, index) => {
    const actual = page.getSize();
    const expected = expectedPages[index];
    const expectedWidth = points(expected.widthMm);
    const expectedHeight = points(expected.heightMm);
    if (
      Math.abs(actual.width - expectedWidth) > tolerancePt ||
      Math.abs(actual.height - expectedHeight) > tolerancePt
    ) {
      throw new Error(
        `${filePath} page ${index + 1} size mismatch: ` +
        `${actual.width.toFixed(4)} x ${actual.height.toFixed(4)} pt`,
      );
    }
  });
}

function printHelp() {
  console.log(`
Usage: node scripts/export_vector_pdf.cjs

Exports Chrome-generated, vector-preserving print PDFs:
  ${OUTPUTS.a4}
  ${OUTPUTS.rollup}

Set NEUTV_CHROME_PATH to override the default Chrome executable.
`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }
  if (!fs.existsSync(HTML_FILE)) throw new Error(`Missing HTML: ${HTML_FILE}`);

  fs.mkdirSync(OUTPUT_PDF, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neutv-vector-pdf-'));
  const temporary = {
    front: path.join(tempDir, 'a4-front.pdf'),
    back: path.join(tempDir, 'a4-back.pdf'),
    rollup: path.join(tempDir, 'rollup.pdf'),
    a4Final: path.join(tempDir, 'a4-final.pdf'),
    rollupFinal: path.join(tempDir, 'rollup-final.pdf'),
  };

  let server;
  let browser;

  try {
    server = createStaticServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}${HTML_URL_PATH}`;
    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: [
        '--disable-gpu-sandbox',
        '--disable-dev-shm-usage',
        '--hide-scrollbars',
        '--force-color-profile=srgb',
        '--font-render-hinting=none',
      ],
    });

    await exportSheet(browser, baseUrl, SPECS.front, temporary.front);
    await exportSheet(browser, baseUrl, SPECS.back, temporary.back);
    await exportSheet(browser, baseUrl, SPECS.rollup, temporary.rollup);
    await browser.close();
    browser = undefined;
    await new Promise(resolve => server.close(resolve));
    server = undefined;

    await saveA4(temporary.front, temporary.back, temporary.a4Final);
    await saveRollup(temporary.rollup, temporary.rollupFinal);
    await verifyOutput(temporary.a4Final, [
      { widthMm: 210, heightMm: 297 },
      { widthMm: 210, heightMm: 297 },
    ]);
    await verifyOutput(temporary.rollupFinal, [{ widthMm: 800, heightMm: 2000 }]);

    fs.copyFileSync(temporary.a4Final, OUTPUTS.a4);
    fs.copyFileSync(temporary.rollupFinal, OUTPUTS.rollup);
    await verifyOutput(OUTPUTS.a4, [
      { widthMm: 210, heightMm: 297 },
      { widthMm: 210, heightMm: 297 },
    ]);
    await verifyOutput(OUTPUTS.rollup, [{ widthMm: 800, heightMm: 2000 }]);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server?.listening) {
      await new Promise(resolve => server.close(() => resolve()));
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`A4 vector PDF (2 pages, 210 x 297 mm) -> ${OUTPUTS.a4}`);
  console.log(`Roll-up vector PDF (800 x 2000 mm) -> ${OUTPUTS.rollup}`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
