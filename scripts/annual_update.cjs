const fs = require('fs');
const path = require('path');
const {
  ROOT, CONFIG_FILE, CONFIG, HTML_FILE, COPY_FILE,
} = require('./project_config.cjs');

function usage() {
  console.log(`
年度换届更新工具

用法：
  node scripts/annual_update.cjs --year 2027 \\
    --nanhu-group 1234567890 --hunnan-group 1234567891

参数：
  --year            新年份，必填
  --nanhu-group     新南湖群号；不填则保留现值
  --hunnan-group    新浑南群号；不填则保留现值
  --dry-run         只显示将发生的变更
  --help            显示帮助

注意：本工具不会修改二维码图片。更新后请手动替换 assets/qr/*.png。
`);
}

function readArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run' || token === '--help') {
      args[token.slice(2)] = true;
      continue;
    }
    if (!token.startsWith('--') || index + 1 >= argv.length) throw new Error(`Invalid argument: ${token}`);
    args[token.slice(2)] = argv[++index];
  }
  return args;
}

function replaceAllChecked(content, from, to, label) {
  const count = content.split(from).length - 1;
  if (count === 0) throw new Error(`${label}: value not found: ${from}`);
  return { content: content.split(from).join(to), count };
}

function atomicWrite(file, content) {
  const temporary = `${file}.annual-update.tmp`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.copyFileSync(temporary, file);
  fs.unlinkSync(temporary);
}

function main() {
  const args = readArguments(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const nextYear = Number(args.year);
  if (!Number.isInteger(nextYear) || nextYear < 2000 || nextYear > 2100) {
    throw new Error('--year must be a four-digit year between 2000 and 2100');
  }

  const nextGroups = {
    nanhu: String(args['nanhu-group'] || CONFIG.groups.nanhu),
    hunnan: String(args['hunnan-group'] || CONFIG.groups.hunnan),
  };
  for (const [campus, number] of Object.entries(nextGroups)) {
    if (!/^\d{6,12}$/.test(number)) throw new Error(`${campus} group number must contain 6-12 digits`);
  }

  const oldYear = String(CONFIG.currentYear);
  const newYear = String(nextYear);
  let html = fs.readFileSync(HTML_FILE, 'utf8');
  let copy = fs.readFileSync(COPY_FILE, 'utf8');
  const report = [];

  for (const target of [
    { label: 'HTML year', value: oldYear, next: newYear, get: () => html, set: value => { html = value; } },
    { label: 'copy year', value: oldYear, next: newYear, get: () => copy, set: value => { copy = value; } },
    { label: 'HTML Nanhu group', value: CONFIG.groups.nanhu, next: nextGroups.nanhu, get: () => html, set: value => { html = value; } },
    { label: 'copy Nanhu group', value: CONFIG.groups.nanhu, next: nextGroups.nanhu, get: () => copy, set: value => { copy = value; } },
    { label: 'HTML Hunnan group', value: CONFIG.groups.hunnan, next: nextGroups.hunnan, get: () => html, set: value => { html = value; } },
    { label: 'copy Hunnan group', value: CONFIG.groups.hunnan, next: nextGroups.hunnan, get: () => copy, set: value => { copy = value; } },
  ]) {
    if (target.value === target.next) {
      report.push(`${target.label}: unchanged`);
      continue;
    }
    const changed = replaceAllChecked(target.get(), target.value, target.next, target.label);
    target.set(changed.content);
    report.push(`${target.label}: ${changed.count} replacement(s)`);
  }

  const nextDesignFile = CONFIG.designFile.includes(oldYear)
    ? CONFIG.designFile.replace(oldYear, newYear)
    : CONFIG.designFile;
  const nextHtmlFile = path.resolve(ROOT, nextDesignFile);
  if (nextHtmlFile !== HTML_FILE && fs.existsSync(nextHtmlFile)) {
    throw new Error(`Target design file already exists: ${nextHtmlFile}`);
  }

  console.log(report.join('\n'));
  console.log(`design file: ${CONFIG.designFile} -> ${nextDesignFile}`);
  console.log(`QR images: unchanged; replace assets/qr/nanhu-qq.png and hunnan-qq.png manually`);
  if (args['dry-run']) return;

  atomicWrite(HTML_FILE, html);
  atomicWrite(COPY_FILE, copy);
  if (nextHtmlFile !== HTML_FILE) fs.renameSync(HTML_FILE, nextHtmlFile);
  const nextConfig = {
    ...CONFIG,
    currentYear: nextYear,
    designFile: nextDesignFile,
    groups: nextGroups,
  };
  atomicWrite(CONFIG_FILE, `${JSON.stringify(nextConfig, null, 2)}\n`);
  console.log('Annual text/config update complete. Run npm run render, then npm run qa.');
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
