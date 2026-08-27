const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'project.config.json');

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) throw new Error(`Missing project config: ${CONFIG_FILE}`);
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (!Number.isInteger(config.currentYear) || config.currentYear < 2000 || config.currentYear > 2100) {
    throw new Error(`Invalid currentYear in project.config.json: ${config.currentYear}`);
  }
  for (const key of ['designFile', 'copyFile']) {
    if (!config[key] || typeof config[key] !== 'string') throw new Error(`Missing config field: ${key}`);
  }
  for (const campus of ['nanhu', 'hunnan']) {
    if (!/^\d{6,12}$/.test(String(config.groups?.[campus] || ''))) {
      throw new Error(`Invalid ${campus} group number in project.config.json`);
    }
  }
  if (!Number.isInteger(config.output?.fanSizePx) || config.output.fanSizePx < 1200) {
    throw new Error(`Invalid output.fanSizePx in project.config.json: ${config.output?.fanSizePx}`);
  }
  if (!Number.isInteger(config.output?.fanDpi) || config.output.fanDpi < 72) {
    throw new Error(`Invalid output.fanDpi in project.config.json: ${config.output?.fanDpi}`);
  }
  return config;
}

const CONFIG = readConfig();
const YEAR = String(CONFIG.currentYear);
const HTML_FILE = path.resolve(ROOT, CONFIG.designFile);
const COPY_FILE = path.resolve(ROOT, CONFIG.copyFile);
const HTML_URL_PATH = `/${CONFIG.designFile.replace(/\\/g, '/')}`;

function outputName(suffix) {
  return `NEUTV-${YEAR}-${suffix}`;
}

module.exports = {
  ROOT,
  CONFIG_FILE,
  CONFIG,
  YEAR,
  HTML_FILE,
  COPY_FILE,
  HTML_URL_PATH,
  outputName,
  readConfig,
};
