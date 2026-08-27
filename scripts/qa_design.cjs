const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { PDFDocument } = require('pdf-lib');
const {
  ROOT, CONFIG, YEAR, HTML_FILE: HTML, outputName,
} = require('./project_config.cjs');
const { resolveBrowserExecutable } = require('./browser_runtime.cjs');

const CHROME = resolveBrowserExecutable();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

async function checkRaster(relativePath, expected) {
  const file = abs(relativePath);
  assert(fs.existsSync(file), `Missing raster: ${relativePath}`);
  const image = sharp(file);
  const metadata = await image.metadata();
  if (expected.width) assert(metadata.width === expected.width, `${relativePath}: width ${metadata.width}, expected ${expected.width}`);
  if (expected.height) assert(metadata.height === expected.height, `${relativePath}: height ${metadata.height}, expected ${expected.height}`);
  if (expected.minWidth) assert(metadata.width >= expected.minWidth, `${relativePath}: width ${metadata.width}, expected >= ${expected.minWidth}`);
  if (expected.minHeight) assert(metadata.height >= expected.minHeight, `${relativePath}: height ${metadata.height}, expected >= ${expected.minHeight}`);
  if (expected.density) assert(Math.abs((metadata.density || 0) - expected.density) <= 1, `${relativePath}: density ${metadata.density}, expected ${expected.density}`);
  if (expected.alpha) {
    assert(metadata.hasAlpha && metadata.channels === 4, `${relativePath}: expected RGBA, got ${metadata.channels} channels`);
    const stats = await image.stats();
    const alpha = stats.channels[3];
    assert(alpha.min === 0, `${relativePath}: alpha min ${alpha.min}, expected 0`);
    assert(alpha.max > 200, `${relativePath}: alpha max ${alpha.max}, expected > 200`);
  }
  if (expected.circularAlpha) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const centerX = (info.width - 1) / 2;
    const centerY = (info.height - 1) / 2;
    const radius = Math.min(info.width, info.height) / 2 + 2;
    const radiusSquared = radius * radius;
    let outsideMaxAlpha = 0;
    for (let y = 0; y < info.height; y += 1) {
      const dy = y - centerY;
      for (let x = 0; x < info.width; x += 1) {
        const dx = x - centerX;
        if (dx * dx + dy * dy <= radiusSquared) continue;
        outsideMaxAlpha = Math.max(outsideMaxAlpha, data[(y * info.width + x) * 4 + 3]);
      }
    }
    assert(outsideMaxAlpha === 0, `${relativePath}: circular mask leaks alpha ${outsideMaxAlpha} outside the disc`);
  }
  return `${relativePath} ${metadata.width}x${metadata.height} ${metadata.channels}ch ${metadata.density || '-'}dpi`;
}

async function checkPdf(relativePath, pageSizes) {
  const file = abs(relativePath);
  assert(fs.existsSync(file), `Missing PDF: ${relativePath}`);
  const pdf = await PDFDocument.load(fs.readFileSync(file));
  assert(pdf.getPageCount() === pageSizes.length, `${relativePath}: page count ${pdf.getPageCount()}, expected ${pageSizes.length}`);
  pdf.getPages().forEach((page, index) => {
    const { width, height } = page.getSize();
    const [expectedWidth, expectedHeight] = pageSizes[index];
    assert(Math.abs(width - expectedWidth) < 0.02, `${relativePath} p${index + 1}: width ${width}`);
    assert(Math.abs(height - expectedHeight) < 0.02, `${relativePath} p${index + 1}: height ${height}`);
  });
}

async function auditDom() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 3200 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => errors.push(`${request.url()} — ${request.failure()?.errorText}`));
    await page.goto(pathToFileURL(HTML).href, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
    });
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);

    const result = await page.evaluate(({ nanhuGroup, hunnanGroup }) => {
      const issues = [];
      const selectors = ['#a4-front', '#a4-back', '#rollup', '#fan-front', '#fan-back'];
      const textSelector = 'h1,h2,h3,p,.center-name,.school-en,.tiny-tag,.qr-box,.keywords span';
      for (const selector of selectors) {
        const sheet = document.querySelector(selector);
        const sheetRect = sheet.getBoundingClientRect();
        for (const element of sheet.querySelectorAll(textSelector)) {
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
          const rect = element.getBoundingClientRect();
          if (!(rect.width > 0 && rect.height > 0)) issues.push(`${selector}: zero-size text "${element.textContent.trim().slice(0, 24)}"`);
          if (rect.left < sheetRect.left - 1 || rect.right > sheetRect.right + 1 || rect.top < sheetRect.top - 1 || rect.bottom > sheetRect.bottom + 1) {
            issues.push(`${selector}: out-of-bounds text "${element.textContent.trim().slice(0, 24)}"`);
          }
        }
      }

      for (const selector of ['.brandbar', '.who', '.back-intro', '.qr-strip', '.intro-pill', '.roll-qr', '.roll-footer', '.fan-brand-card', '.fan-back-brand', '.fan-qr-box']) {
        for (const element of document.querySelectorAll(selector)) {
          if (element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2) {
            issues.push(`${selector}: content overflow ${element.scrollWidth}x${element.scrollHeight} > ${element.clientWidth}x${element.clientHeight}`);
          }
        }
      }

      const hostSources = [...document.querySelectorAll('.host-card img,.roll-host img')].map(image => image.getAttribute('src'));
      if (hostSources.length !== 5) issues.push(`host image count ${hostSources.length}, expected 5`);
      if (hostSources.some(src => /video|camera|dept-video/i.test(src))) issues.push(`host region contains camera/video asset: ${hostSources.join(', ')}`);
      if (hostSources.filter(src => src.includes('dept-host-final.png')).length !== 2) issues.push('host region is not using the final female-host asset twice');
      if (hostSources.filter(src => src.includes('props-broadcast.png')).length !== 2) issues.push('host region is not using broadcast-only props twice');
      if (document.querySelectorAll('#a4-back .host-accent-art').length !== 0) issues.push('host accent must not appear on the A4 back');
      if (document.querySelectorAll('#rollup .roll-host .host-accent-art').length !== 1) issues.push('roll-up host region is not using the transparent lower accent exactly once');

      const qrBoxes = document.querySelectorAll('.qr-box');
      if (qrBoxes.length !== 5) issues.push(`QR placement count ${qrBoxes.length}, expected 5`);
      for (const qrBox of qrBoxes) {
        const image = qrBox.querySelector('img.qr-image');
        if (!image || !image.complete || image.naturalWidth < 900 || image.naturalHeight < 900) {
          issues.push('QR placement is missing its high-resolution source image');
        }
        if (qrBox.scrollWidth > qrBox.clientWidth + 1 || qrBox.scrollHeight > qrBox.clientHeight + 1) {
          issues.push('QR image overflows its square frame');
        }
      }
      const visibleText = document.body.innerText;
      if (visibleText.split(nanhuGroup).length - 1 !== 3) issues.push('南湖校区 QQ群号 is not shown exactly three times');
      if (visibleText.split(hunnanGroup).length - 1 !== 2) issues.push('浑南校区 QQ群号 is not shown exactly twice');
      const qrSources = [...document.querySelectorAll('img.qr-image')].map(image => image.getAttribute('src'));
      if (qrSources.filter(source => source.includes('nanhu-qq.png')).length !== 3) issues.push('南湖校区 QR source is not used exactly three times');
      if (qrSources.filter(source => source.includes('hunnan-qq.png')).length !== 2) issues.push('浑南校区 QR source is not used exactly twice');
      if (document.querySelectorAll('#fan-front .emblem,#fan-back .emblem').length !== 0) issues.push('round fan must not contain the university emblem');
      if (document.querySelectorAll('#fan-front .fan-logo,#fan-back .fan-logo').length !== 2) issues.push('round fan must use the official NEUTV logo on both sides');
      if (!document.querySelector('#fan-front .fan-identity')?.innerText.includes('东北大学融媒体中心')) issues.push('round fan front does not identify the institution');
      for (const [fanSelector, contentSelector] of [
        ['#fan-front', '.fan-year-chip,.fan-brand-card,.fan-identity,.fan-main-title,.fan-slogan,.fan-side-note'],
        ['#fan-back', '.fan-back-brand,.fan-back-heading,.fan-group-number,.fan-qr-box,.fan-side-note'],
      ]) {
        const fan = document.querySelector(fanSelector);
        const fanRect = fan.getBoundingClientRect();
        const keepout = {
          left: fanRect.left + fanRect.width / 3,
          right: fanRect.left + fanRect.width * 2 / 3,
          top: fanRect.top + fanRect.height * 2 / 3,
          bottom: fanRect.bottom,
        };
        for (const element of fan.querySelectorAll(contentSelector)) {
          const rect = element.getBoundingClientRect();
          const overlapsKeepout = rect.right > keepout.left + 2
            && rect.left < keepout.right - 2
            && rect.bottom > keepout.top + 2
            && rect.top < keepout.bottom - 2;
          if (overlapsKeepout) issues.push(`${fanSelector}: readable content enters central handle area: ${element.className}`);
        }
      }
      const unframedFanElements = document.querySelectorAll('.fan-year-chip,.fan-brand-card,.fan-back-brand');
      for (const element of unframedFanElements) {
        const style = getComputedStyle(element);
        const hasBorder = parseFloat(style.borderTopWidth) > 0
          || parseFloat(style.borderRightWidth) > 0
          || parseFloat(style.borderBottomWidth) > 0
          || parseFloat(style.borderLeftWidth) > 0;
        if (hasBorder || style.boxShadow !== 'none' || style.backgroundImage !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          issues.push(`round fan direct-layout element still has a frame: ${element.className}`);
        }
      }
      const fanQrStyle = getComputedStyle(document.querySelector('.fan-qr-box'));
      if (parseFloat(fanQrStyle.borderTopWidth) > 0 || fanQrStyle.boxShadow !== 'none' || parseFloat(fanQrStyle.borderTopLeftRadius) > 0) {
        issues.push('round fan QR quiet zone still has decorative framing');
      }
      if (document.querySelectorAll('.fan-side-note').length !== 0) issues.push('round fan still contains framed lower-side note pills');

      const fanTitleParts = [...document.querySelectorAll('#fan-front .fan-main-title span')].map(element => element.getBoundingClientRect());
      if (fanTitleParts.length !== 2) {
        issues.push('round fan headline must contain two inline color groups');
      } else {
        if (Math.abs(fanTitleParts[0].top - fanTitleParts[1].top) > 2) issues.push('round fan six-character headline is not on one line');
        if (fanTitleParts[1].left - fanTitleParts[0].right < 14) issues.push('round fan six-character headline phrase gap is too tight');
      }

      for (const fanSelector of ['#fan-front', '#fan-back']) {
        const fan = document.querySelector(fanSelector);
        const fanRect = fan.getBoundingClientRect();
        const centerX = fanRect.left + fanRect.width / 2;
        const centerY = fanRect.top + fanRect.height / 2;
        const safeRadius = fanRect.width / 2 - 34;
        const readable = fan.querySelectorAll('h1,h2,p,.fan-brand-card,.fan-back-brand,.fan-qr-box');
        for (const element of readable) {
          const rect = element.getBoundingClientRect();
          const corners = [[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]];
          if (corners.some(([x, y]) => Math.hypot(x - centerX, y - centerY) > safeRadius)) {
            issues.push(`${fanSelector}: readable element exceeds circular safe edge: ${element.className}`);
          }
        }
      }
      for (const forbiddenPercentage of ['50%', '30%', '20%']) {
        if (visibleText.includes(forbiddenPercentage)) issues.push(`public-facing percentage remains: ${forbiddenPercentage}`);
      }
      for (const internalNote of ['二维码预留', '定稿前替换', '版面约']) {
        if (visibleText.includes(internalNote)) issues.push(`internal production note remains visible: ${internalNote}`);
      }
      if (document.querySelectorAll('.learn-block').length !== 6) issues.push(`learning-outcome block count ${document.querySelectorAll('.learn-block').length}, expected 6`);
      if (document.querySelectorAll('.workflow').length !== 2) issues.push(`workflow count ${document.querySelectorAll('.workflow').length}, expected 2`);
      for (const learnText of document.querySelectorAll('.learn-block p')) {
        if (learnText.scrollWidth > learnText.clientWidth + 1 || learnText.scrollHeight > learnText.clientHeight + 1) {
          issues.push(`learning line overflows: "${learnText.textContent.trim()}"`);
        }
      }

      const whoPanel = document.querySelector('#a4-front .who').getBoundingClientRect();
      const benefitsPanel = document.querySelector('#a4-front .front-benefits').getBoundingClientRect();
      const frontCopy = document.querySelector('#a4-front .front-copy').getBoundingClientRect();
      const whoLabel = document.querySelector('#a4-front .who .label').getBoundingClientRect();
      const whoRadius = parseFloat(getComputedStyle(document.querySelector('#a4-front .who')).borderTopLeftRadius);
      const benefitsRadius = parseFloat(getComputedStyle(document.querySelector('#a4-front .front-benefits')).borderTopLeftRadius);
      if (Math.abs(whoPanel.left - benefitsPanel.left) > .1 || Math.abs(whoPanel.width - benefitsPanel.width) > .1) issues.push('A4 front primary glass panels do not share the same left edge and width');
      if (Math.abs(whoRadius - benefitsRadius) > .1) issues.push('A4 front primary glass panels use different corner radii');
      if (Math.abs(frontCopy.left - whoLabel.left) > .1) issues.push(`A4 front title group does not align with the who-card text: ${frontCopy.left} vs ${whoLabel.left}`);

      for (const selector of ['.video-card .number', '.host-card .number']) {
        const color = getComputedStyle(document.querySelector(selector)).color;
        const match = color.match(/rgba?\(\s*6\s*,\s*52\s*,\s*174(?:\s*,\s*([\d.]+))?\s*\)/);
        const alpha = match ? Number(match[1] ?? 1) : 0;
        if (!match || alpha < .32) issues.push(`${selector} is not a sufficiently visible deep-blue watermark: ${color}`);
      }

      const centerNames = [...document.querySelectorAll('.center-name')];
if (centerNames.length !== 3 || centerNames.some(node => node.textContent.trim() !== '东北大学融媒体中心')) issues.push('institution name is not updated consistently across all three designs');
      const frontHeadlineSize = parseFloat(getComputedStyle(document.querySelector('#a4-front .headline')).fontSize);
      if (frontHeadlineSize < 200) issues.push(`A4 front headline is not enlarged enough: ${frontHeadlineSize}px`);

      const rollEditingKeywords = [...document.querySelectorAll('#rollup .roll-editing .keywords span')].map(node => node.getBoundingClientRect());
      const keywordRows = [...new Set(rollEditingKeywords.map(rect => Math.round(rect.top)))];
      if (rollEditingKeywords.length !== 4 || keywordRows.length !== 2 || keywordRows.some(top => rollEditingKeywords.filter(rect => Math.round(rect.top) === top).length !== 2)) issues.push('roll-up editing keywords are not a strict 2x2 layout');

      const frontLogo = document.querySelector('#a4-front .neutv').getBoundingClientRect();
      const backLogo = document.querySelector('#a4-back .neutv').getBoundingClientRect();
      const frontEmblem = document.querySelector('#a4-front .emblem').getBoundingClientRect();
      const backEmblem = document.querySelector('#a4-back .emblem').getBoundingClientRect();
      const frontSheet = document.querySelector('#a4-front').getBoundingClientRect();
      const backSheet = document.querySelector('#a4-back').getBoundingClientRect();
      if (Math.abs(frontLogo.width - backLogo.width) > .1 || Math.abs(frontLogo.height - backLogo.height) > .1) issues.push('A4 front/back NEUTV logo sizes differ');
      if (Math.abs(frontEmblem.width - backEmblem.width) > .1 || Math.abs(frontEmblem.height - backEmblem.height) > .1) issues.push('A4 front/back emblem sizes differ');
      if (Math.abs((frontLogo.left - frontSheet.left) - (backLogo.left - backSheet.left)) > .1 || Math.abs((frontLogo.top - frontSheet.top) - (backLogo.top - backSheet.top)) > .1) issues.push('A4 front/back NEUTV logo positions differ');
      if (Math.abs((frontEmblem.right - frontSheet.left) - (backEmblem.right - backSheet.left)) > .1 || Math.abs((frontEmblem.top - frontSheet.top) - (backEmblem.top - backSheet.top)) > .1) issues.push('A4 front/back emblem positions differ');
      if (document.querySelectorAll('#a4-front .school-en').length !== 1 || document.querySelectorAll('#a4-back .school-en').length !== 1) issues.push('A4 front/back English school names are not structurally identical');

      for (const title of document.querySelectorAll('#a4-front h1,#rollup h1')) {
        const station = title.querySelector('.station')?.getBoundingClientRect();
        const recruit = title.querySelector('.recruit')?.getBoundingClientRect();
        if (!station || !recruit) {
          issues.push('title line boxes missing');
        } else if (recruit.top < station.bottom + 2) {
          issues.push(`title lines overlap by ${(station.bottom + 2 - recruit.top).toFixed(2)}px`);
        }
      }
      const brokenImages = [...document.images].filter(image => !image.complete || image.naturalWidth === 0).map(image => image.src);
      if (brokenImages.length) issues.push(`broken images: ${brokenImages.join(', ')}`);
      if (!document.fonts.check('48px "Smiley Sans"')) issues.push('Smiley Sans not loaded');
      if (!document.fonts.check('32px "Noto Sans SC Local"')) issues.push('Noto Sans SC not loaded');
      if (!document.fonts.check('32px "Noto Serif SC Local"')) issues.push('Noto Serif SC not loaded');
      const titleCount = [...document.querySelectorAll('h1')]
        .filter(title => title.innerText.replace(/\s/g, '').includes('电视台招新啦')).length;
      return { issues, titleCount, hostSources };
    }, { nanhuGroup: CONFIG.groups.nanhu, hunnanGroup: CONFIG.groups.hunnan });
    assert(result.issues.length === 0, `DOM audit failed:\n${result.issues.join('\n')}`);
    assert(result.titleCount >= 3, `Expected title on A4, roll-up and round fan, found ${result.titleCount}`);
    return result;
  } finally {
    await browser.close();
  }
}

async function main() {
  assert(fs.existsSync(HTML), `Missing HTML: ${HTML}`);
  const html = fs.readFileSync(HTML, 'utf8');
  const required = [
  '东北大学融媒体中心', '电视台', '招新啦', '把爱留在电视台',
    '面向全体在校生', '南湖校区', '浑南校区',
    CONFIG.groups.nanhu, CONFIG.groups.hunnan,
    '视频部', '主持部', '剪辑部',
    '官方短视频账号', '抖音', '快手', 'B站', '视频号',
    '负责主持部录制的校园新闻后期制作',
  ];
  for (const phrase of required) assert(html.includes(phrase), `HTML missing required phrase: ${phrase}`);
  const forbidden = ['20XX', '官号', '报名截止', '面试时间', '面试地点', '冶金馆', '二维码预留', '定稿前替换'];
  for (const phrase of forbidden) assert(!html.includes(phrase), `HTML contains forbidden/stale phrase: ${phrase}`);

  const rasterChecks = [
    ['assets/brand/neutv-logo-transparent.png', { alpha: true }],
    ['assets/brand/neu-emblem.png', { alpha: true }],
    ['assets/generated/hero-media-trio.png', { alpha: true }],
    ['assets/generated/dept-video.png', { alpha: true }],
    ['assets/generated/dept-host-final.png', { width: 1024, height: 1536, alpha: true }],
    ['assets/generated/dept-editing-final.png', { width: 1024, height: 1536, alpha: true }],
    ['assets/generated/glass-ribbon.png', { alpha: true }],
    ['assets/generated/props-broadcast.png', { width: 1536, height: 1024, alpha: true }],
    ['assets/generated/props-host-accent.png', { width: 1672, height: 940, alpha: true }],
    ['assets/generated/props-editing.png', { width: 1536, height: 1024, alpha: true }],
    ['assets/generated/props-video.png', { width: 1536, height: 1024, alpha: true }],
    ['assets/qr/nanhu-qq.png', { minWidth: 900, minHeight: 900, alpha: true }],
    ['assets/qr/hunnan-qq.png', { minWidth: 900, minHeight: 900, alpha: true }],
    [`output/png/${outputName('A4-front.png')}`, {
      width: Math.round(210 / 25.4 * CONFIG.output.a4Dpi),
      height: Math.round(297 / 25.4 * CONFIG.output.a4Dpi),
      density: CONFIG.output.a4Dpi,
    }],
    [`output/png/${outputName('A4-back.png')}`, {
      width: Math.round(210 / 25.4 * CONFIG.output.a4Dpi),
      height: Math.round(297 / 25.4 * CONFIG.output.a4Dpi),
      density: CONFIG.output.a4Dpi,
    }],
    [`output/png/${outputName(`rollup-80x200cm-${CONFIG.output.rollupDpi}dpi.png`)}`, {
      width: Math.round(CONFIG.output.rollupWidthMm / 25.4 * CONFIG.output.rollupDpi),
      height: Math.round(CONFIG.output.rollupHeightMm / 25.4 * CONFIG.output.rollupDpi),
      density: CONFIG.output.rollupDpi,
    }],
    [`output/png/${outputName('round-fan-front.png')}`, {
      width: CONFIG.output.fanSizePx,
      height: CONFIG.output.fanSizePx,
      density: CONFIG.output.fanDpi,
      alpha: true,
      circularAlpha: true,
    }],
    [`output/png/${outputName('round-fan-back.png')}`, {
      width: CONFIG.output.fanSizePx,
      height: CONFIG.output.fanSizePx,
      density: CONFIG.output.fanDpi,
      alpha: true,
      circularAlpha: true,
    }],
  ];
  const reports = [];
  for (const [relativePath, expected] of rasterChecks) reports.push(await checkRaster(relativePath, expected));
  const dom = await auditDom();

  if (process.argv.includes('--with-pdf')) {
    await checkPdf(`output/pdf/${outputName('A4-double-sided.pdf')}`, [
      [595.2755906, 841.8897638],
      [595.2755906, 841.8897638],
    ]);
    await checkPdf(`output/pdf/${outputName('rollup-80x200cm.pdf')}`, [
      [2267.7165354, 5669.2913386],
    ]);
  }

  console.log(reports.join('\n'));
  console.log(`DOM: ${dom.titleCount} title occurrences, ${dom.hostSources.length} host-region assets, 5 QR placements`);
  console.log('QA PASS');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
