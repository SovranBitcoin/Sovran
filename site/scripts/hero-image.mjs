// Exports the home page phone screen from the reviewed wallet capture.
// Run from the repository root: node site/scripts/hero-image.mjs
// The crop keeps everything below the history cards out of the shipped bytes,
// so a tab bar in the capture can never appear on the page at any width.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = fileURLToPath(new URL('../../press/screenshots/ios/wallet.png', import.meta.url));
const target = new URL('../public/hero/', import.meta.url);
const HERO = { width: 1320, height: 2868, cropHeight: 2310, widths: [600, 900] };

const meta = await sharp(source).metadata();
if (meta.width !== HERO.width || meta.height !== HERO.height) throw new Error(`Expected a ${HERO.width}x${HERO.height} capture, got ${meta.width}x${meta.height}`);
await mkdir(target, { recursive: true });
for (const width of HERO.widths) {
  const crop = sharp(source).extract({ left: 0, top: 0, width: HERO.width, height: HERO.cropHeight }).resize({ width }).removeAlpha();
  const height = Math.round(HERO.cropHeight * width / HERO.width);
  await crop.clone().avif({ quality: 55, effort: 9 }).toFile(fileURLToPath(new URL(`wallet-${width}.avif`, target)));
  await crop.clone().webp({ quality: 80, effort: 6 }).toFile(fileURLToPath(new URL(`wallet-${width}.webp`, target)));
  console.log(`wallet-${width}: ${width}x${height}`);
}
