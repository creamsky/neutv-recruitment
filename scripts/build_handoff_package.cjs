const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, CONFIG, YEAR } = require('./project_config.cjs');
const projectPackage = require('../package.json');

const outputRoot = path.join(ROOT, 'output');
const packageName = `NEUTV招新物料_开源交接包_v${projectPackage.version}_${YEAR}`;
const stagingRoot = path.join(outputRoot, packageName);

const rootFiles = [
  '.editorconfig',
  '.gitignore',
  'AGENTS.md',
  'ASSET_LICENSES.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'HANDOFF.md',
  'LICENSE',
  'README.md',
  'package.json',
  'project.config.json',
  CONFIG.designFile,
  CONFIG.copyFile,
];
const rootDirectories = ['assets', 'docs', 'examples', 'references', 'scripts'];

function assertSafeTarget(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${path.resolve(outputRoot)}${path.sep}`)) {
    throw new Error(`Unsafe staging target: ${resolved}`);
  }
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

assertSafeTarget(stagingRoot);
fs.rmSync(stagingRoot, { recursive: true, force: true });
fs.mkdirSync(stagingRoot, { recursive: true });

for (const relative of rootFiles) {
  const source = path.join(ROOT, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing handoff file: ${relative}`);
  fs.copyFileSync(source, path.join(stagingRoot, relative));
}
for (const relative of rootDirectories) {
  const source = path.join(ROOT, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing handoff directory: ${relative}`);
  copyDirectory(source, path.join(stagingRoot, relative));
}

const packageInfo = {
  name: projectPackage.name,
  version: projectPackage.version,
  currentYear: CONFIG.currentYear,
  generatedAt: new Date().toISOString(),
  sourceDesign: CONFIG.designFile,
  finalDeliveryFormat: 'PNG only',
  outputs: {
    a4Dpi: CONFIG.output.a4Dpi,
    rollupDpi: CONFIG.output.rollupDpi,
  },
};
fs.writeFileSync(
  path.join(stagingRoot, 'HANDOFF_PACKAGE_INFO.json'),
  `${JSON.stringify(packageInfo, null, 2)}\n`,
  'utf8',
);

const manifestFile = path.join(stagingRoot, 'SHA256SUMS.txt');
const manifest = listFiles(stagingRoot)
  .filter(file => file !== manifestFile)
  .sort((a, b) => a.localeCompare(b, 'en'))
  .map(file => `${hash(file)}  ${path.relative(stagingRoot, file).replace(/\\/g, '/')}`)
  .join('\n');
fs.writeFileSync(manifestFile, `${manifest}\n`, 'utf8');

console.log(`Handoff folder: ${stagingRoot}`);
console.log(`Files: ${listFiles(stagingRoot).length}`);
