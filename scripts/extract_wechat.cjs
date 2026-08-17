const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const input = path.join(root, 'tmp', 'wechat-previous.html');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    await page.goto(pathToFileURL(input).href, { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(() => {
      const content = document.querySelector('#js_content');
      const imageUrls = content ? [...content.querySelectorAll('img')]
        .map((image, index) => ({
          index,
          url: image.getAttribute('data-src') || image.getAttribute('src') || '',
          alt: image.getAttribute('alt') || '',
          width: image.getAttribute('data-w') || image.getAttribute('width') || '',
          type: image.getAttribute('data-type') || '',
        }))
        .filter(image => /^https?:/i.test(image.url)) : [];
      return {
        title: document.querySelector('#activity-name')?.innerText.trim() || document.title,
        author: document.querySelector('#js_name')?.innerText.trim() || '',
        text: content?.innerText.replace(/\n{3,}/g, '\n\n').trim() || '',
        imageUrls,
      };
    });
    process.stdout.write(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
