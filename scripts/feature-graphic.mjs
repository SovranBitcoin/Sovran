#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  loadBrandInputs,
} from "./brand-assets.mjs";

import { loadFonts, text as renderText, phone, brandLockup, hash } from "./lib/marketing-render.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folder = join(root, "marketing/feature-graphic");
const check = process.argv.includes("--check");
assert(
  process.argv.length === 2 || (process.argv.length === 3 && check),
  "Usage: node scripts/feature-graphic.mjs [--check]",
);

const spec = JSON.parse(
  await readFile(join(folder, "source/composition.json")),
);
assert.deepEqual(spec.size, [1024, 500]);
const [W, H] = spec.size;

const fonts = await loadFonts(root);
const text = (...args) => renderText(fonts, ...args);
const p = spec.presentation;
const brand = await loadBrandInputs();
const { ink, logoScale, logoWidth, logoHeight, logo } = await brandLockup(brand, p.copy.logoHeight);

// Copy column: logo, two-line headline and two-line subtitle, centred as a block.
const headlineSize = 44,
  headlineLead = 48,
  subtitleSize = 18,
  subtitleLead = 24;
const blockHeight =
  p.copy.logoHeight +
  34 +
  spec.headline.length * headlineLead +
  12 +
  spec.subtitle.length * subtitleLead;
const blockTop = Math.round((H - blockHeight) / 2);
const logoTop = blockTop;
const headlineBase = logoTop + p.copy.logoHeight + 34 + headlineSize * 0.72;
const subtitleBase =
  headlineBase +
  (spec.headline.length - 1) * headlineLead +
  12 +
  subtitleLead * 0.72 +
  8;
const copy = [
  `<image x="${p.copy.left - ink.x * logoScale}" y="${logoTop - ink.y * logoScale}" width="${logoWidth}" height="${logoHeight}" href="data:image/png;base64,${logo.toString("base64")}"/>`,
  ...spec.headline.map((line, i) =>
    text(
      line,
      p.copy.left,
      headlineBase + i * headlineLead,
      headlineSize,
      p.foreground,
      "ExtraBold",
      p.copy.width,
    ),
  ),
  ...spec.subtitle.map((line, i) =>
    text(
      line,
      p.copy.left + 1,
      subtitleBase + i * subtitleLead,
      subtitleSize,
      p.secondary,
      "Medium",
      p.copy.width,
    ),
  ),
];

const report = {
  size: spec.size,
  inputs: { mark: brand.hashes.mark, wordmark: brand.hashes.wordmark },
  outputs: [],
};
for (const [platform, inputs] of Object.entries(spec.platforms)) {
  const phones = p.platforms[platform].phones;
  assert.equal(inputs.screenshots.length, 4, "Choose exactly four highlights");
  assert.equal(phones.length, 4, "Every screenshot needs a phone slot");
  const stack = [];
  // Screenshots are listed back to front; the last one is the hero.
  for (let index = 0; index < inputs.screenshots.length; index++) {
    const shot = inputs.screenshots[index];
    const slot = phones[index];
    const bytes = await readFile(join(folder, shot.file));
    assert.equal(hash(bytes), shot.sha256, `Screenshot changed: ${shot.file}`);
    const rendered = await phone({ screenshot: bytes, platform, x: slot.x, y: slot.top,
      width: slot.width, index, dim: slot.dim, frame: p.frame, frameEdge: p.frameEdge });
    assert(slot.top + rendered.frameH >= H + 8, `Phone should bleed off canvas: ${platform}/${index}`);
    assert(slot.x - rendered.bezel >= 412 && slot.x + slot.width + rendered.bezel <= W - 28,
      `Phone leaves safe area: ${platform}/${index}`);
    stack.push(rendered.svg);
  }
  const hero = phones[3];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}">
 <defs>
  <radialGradient id="spot" cx="${hero.x + hero.width / 2}" cy="${hero.top + 120}" r="520" gradientUnits="userSpaceOnUse">
   <stop offset="0" stop-color="${p.spotlight}"/>
   <stop offset="1" stop-color="${p.background}"/>
  </radialGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
   <stop offset="0" stop-color="${p.frameHighlight}" stop-opacity="0.28"/>
   <stop offset="0.35" stop-color="${p.frameHighlight}" stop-opacity="0.06"/>
   <stop offset="1" stop-color="${p.frameHighlight}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
   <stop offset="0" stop-color="${p.background}" stop-opacity="0"/>
   <stop offset="1" stop-color="${p.background}" stop-opacity="0.9"/>
  </linearGradient>
  <filter id="shadow" x="-40%" y="-30%" width="180%" height="170%">
   <feGaussianBlur stdDeviation="16"/>
   <feComponentTransfer><feFuncA type="linear" slope="0.85"/></feComponentTransfer>
   <feOffset dx="-14" dy="18"/>
  </filter>
 </defs>
 <rect width="${W}" height="${H}" fill="${p.background}"/>
 <rect width="${W}" height="${H}" fill="url(#spot)"/>
 ${copy.join("\n ")}
 ${stack.join("\n ")}
 <rect y="${H - 64}" width="${W}" height="64" fill="url(#floor)"/>
 </svg>`;
  const png = await sharp(Buffer.from(svg))
    .resize(W, H)
    .flatten({ background: p.background })
    .toColourspace("srgb")
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const metadata = await sharp(png).metadata();
  assert(
    metadata.width === W &&
      metadata.height === H &&
      !metadata.hasAlpha &&
      metadata.channels === 3,
  );
  assert(png.length < 15 * 1024 * 1024);
  const file = `generated/${platform}/1024x500.png`;
  if (check)
    assert(
      (await readFile(join(folder, file))).equals(png),
      `Stale feature graphic: ${file}`,
    );
  else {
    await mkdir(join(folder, "generated", platform), { recursive: true });
    await writeFile(join(folder, file), png);
  }
  report.outputs.push({
    file,
    width: W,
    height: H,
    channels: 3,
    bytes: png.length,
    sha256: hash(png),
    screenshots: inputs.screenshots.map((s) => s.sha256),
  });
}
const manifest = JSON.stringify(report, null, 2) + "\n";
if (check)
  assert.equal(
    await readFile(join(folder, "generated/manifest.json"), "utf8"),
    manifest,
  );
else await writeFile(join(folder, "generated/manifest.json"), manifest);
console.log(
  `${check ? "Verified" : "Generated"} Android and iPhone feature graphics (1024×500, opaque RGB PNG).`,
);
