// One-time import from the read-only visual authority; never part of a site build.
import { copyFile, mkdir } from 'node:fs/promises';
const original = new URL('../../../sovran.money/public/', import.meta.url);
const target = new URL('../public/', import.meta.url);
const files = [
  'fonts/MonaSans/MonaSans-Regular.ttf', 'fonts/MonaSans/MonaSans-Bold.ttf',
  'fonts/MonaSans/MonaSans-ExtraBold.ttf', 'supporters/opensats.png',
  ...['bitcoin', 'cashu', 'nostr', 'btcmap', 'vertex', 'coco', 'npubcash'].map(name => `stack/${name}-greyscale.png`),
];
for (const file of files) {
  await mkdir(new URL('.', new URL(file, target)), { recursive: true });
  await copyFile(new URL(file, original), new URL(file, target));
}
console.log(`Imported ${files.length} original font and identity assets. No product mockups copied.`);
