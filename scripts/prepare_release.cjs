const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  ROOT, CONFIG, YEAR, outputName,
} = require('./project_config.cjs');

const outputRoot = path.join(ROOT, 'output');
const pngRoot = path.join(outputRoot, 'png');
const finalRoot = path.join(outputRoot, `东北大学电视台${YEAR}招新物料_最终版`);

const files = [
  {
    source: path.join(pngRoot, outputName('A4-front.png')),
    destination: path.join(finalRoot, `01_A4宣传单_正面_${CONFIG.output.a4Dpi}dpi.png`),
  },
  {
    source: path.join(pngRoot, outputName('A4-back.png')),
    destination: path.join(finalRoot, `02_A4宣传单_反面_${CONFIG.output.a4Dpi}dpi.png`),
  },
  {
    source: path.join(pngRoot, outputName(`rollup-80x200cm-${CONFIG.output.rollupDpi}dpi.png`)),
    destination: path.join(finalRoot, `03_易拉宝_80×200厘米_${CONFIG.output.rollupDpi}dpi.png`),
  },
];

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

fs.mkdirSync(finalRoot, { recursive: true });
for (const file of files) {
  if (!fs.existsSync(file.source)) throw new Error(`Missing rendered output: ${file.source}`);
  fs.copyFileSync(file.source, file.destination);
  if (hash(file.source) !== hash(file.destination)) throw new Error(`Copy hash mismatch: ${file.destination}`);
  console.log(`${path.basename(file.destination)} <- ${path.relative(ROOT, file.source)}`);
}
console.log(`Release folder ready: ${finalRoot}`);
