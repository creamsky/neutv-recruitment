const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

function candidates() {
  const list = [process.env.NEUTV_CHROME_PATH];
  try {
    list.push(chromium.executablePath());
  } catch (_) {
    // Playwright may be installed without its bundled browser.
  }

  if (process.platform === 'win32') {
    list.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    list.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
    );
  }
  return [...new Set(list.filter(Boolean).map(item => path.resolve(item)))];
}

function resolveBrowserExecutable() {
  const executable = candidates().find(candidate => fs.existsSync(candidate));
  if (executable) return executable;
  throw new Error([
    `No Chromium-based browser found on ${os.platform()}.`,
    'Run "npx playwright install chromium" or set NEUTV_CHROME_PATH to Chrome/Edge/Chromium.',
  ].join(' '));
}

module.exports = { resolveBrowserExecutable };
