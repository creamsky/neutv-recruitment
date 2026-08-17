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
    const sequence = await page.evaluate(() => {
      const content = document.querySelector('#js_content');
      if (!content) return [];
      const imageIndex = new Map([...content.querySelectorAll('img')].map((img, i) => [img, i]));
      const walker = document.createTreeWalker(
        content,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent.replace(/\s+/g, ' ').trim();
              return text ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
            if (node.tagName === 'IMG') return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_SKIP;
          },
        },
      );
      const output = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeType === Node.TEXT_NODE) {
          output.push({ type: 'text', text: node.textContent.replace(/\s+/g, ' ').trim() });
        } else {
          output.push({ type: 'image', index: imageIndex.get(node), url: node.getAttribute('data-src') || node.getAttribute('src') || '' });
        }
      }
      return output;
    });
    const start = sequence.findIndex((item) => item.type === 'text' && item.text.includes('PART FIVE'));
    const end = sequence.findIndex((item, index) => index > start && item.type === 'text' && item.text.includes('PART SIX'));
    process.stdout.write(JSON.stringify({ start, end, sequence: sequence.slice(Math.max(0, start - 12), end + 12) }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
