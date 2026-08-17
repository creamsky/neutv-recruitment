const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'assets', 'qr');

const SOURCES = [
  {
    campus: 'hunnan',
    input: path.join(ROOT, '浑南.jpg'),
    output: path.join(OUTPUT, 'hunnan-qq.png'),
    bounds: { left: 270, top: 926, width: 1000, height: 1001 },
    quietZone: 126,
  },
  {
    campus: 'nanhu',
    input: path.join(ROOT, '南湖.jpg'),
    output: path.join(OUTPUT, 'nanhu-qq.png'),
    bounds: { left: 220, top: 769, width: 907, height: 907 },
    quietZone: 114,
  },
];

async function extractQr(spec) {
  const size = Math.max(spec.bounds.width, spec.bounds.height);
  const extraRight = size - spec.bounds.width;
  const extraBottom = size - spec.bounds.height;
  const { data, info } = await sharp(spec.input)
    .extract(spec.bounds)
    .extend({
      top: spec.quietZone,
      bottom: spec.quietZone + extraBottom,
      left: spec.quietZone,
      right: spec.quietZone + extraRight,
      background: '#ffffff',
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let index = 0; index < info.width * info.height; index += 1) {
    const source = index * info.channels;
    const target = index * 4;
    const r = data[source];
    const g = data[source + 1];
    const b = data[source + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const alpha = chroma <= 6 ? 0 : chroma >= 26 ? 255 : Math.round((chroma - 6) * 255 / 20);
    rgba[target] = alpha ? r : 255;
    rgba[target + 1] = alpha ? g : 255;
    rgba[target + 2] = alpha ? b : 255;
    rgba[target + 3] = alpha;
  }

  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(info.width * 2, info.height * 2, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toFile(spec.output);

  const metadata = await sharp(spec.output).metadata();
  const expected = (size + spec.quietZone * 2) * 2;
  if (metadata.width !== expected || metadata.height !== expected) {
    throw new Error(`${spec.campus}: unexpected ${metadata.width}x${metadata.height}, expected ${expected}x${expected}`);
  }
  if (!metadata.hasAlpha || metadata.channels !== 4) {
    throw new Error(`${spec.campus}: expected a transparent RGBA PNG`);
  }
  console.log(`${spec.campus}: ${metadata.width}x${metadata.height} -> ${spec.output}`);
}

(async () => {
  fs.mkdirSync(OUTPUT, { recursive: true });
  for (const source of SOURCES) await extractQr(source);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
