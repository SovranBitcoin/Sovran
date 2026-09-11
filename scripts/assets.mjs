#!/usr/bin/env node
/** Deterministic raster exports. Originals are never rewritten. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateBrand } from "./brand-assets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "app");
const assets = join(app, "assets");
const require = createRequire(join(app, "package.json"));
const sharp = require("sharp");
const check = process.argv[2] === "--check";
assert(
  process.argv.length === 2 || (process.argv.length === 3 && check),
  "Usage: node scripts/assets.mjs [--check]",
);
const manifest = JSON.parse(
  await readFile(join(assets, "manifest.json"), "utf8"),
);
assert.equal(manifest.version, 1);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ownedFiles = new Set();
const brand = await generateBrand({ check });
for (const file of brand.files) ownedFiles.add(file);
let outputBytes = 0;
let outputCount = 0;

function assetPath(path) {
  const result = resolve(assets, path);
  assert(
    result.startsWith(`${assets}/`),
    `Asset path escapes its directory: ${path}`,
  );
  return result;
}

for (const asset of manifest.assets) {
  const source = assetPath(asset.source);
  const bytes = await readFile(source);
  assert.equal(
    sha256(bytes),
    asset.sourceSha256,
    `Source changed: ${asset.source}`,
  );
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], asset.sourceSize);
  if ((metadata.pages ?? 1) > 1)
    assert.equal(
      asset.frame,
      0,
      "Animated sources require an explicit still-frame policy",
    );
  const folder = dirname(source);
  ownedFiles.add(source);
  const [width, height] = asset.baseSize;
  assert(width > 0 && height > 0);
  const exports = asset.scales
    .map((scale) => ({
      file: `image${scale === 1 ? "" : `@${scale}x`}.png`,
      size: [width * scale, height * scale],
    }))
    .concat(asset.exports ?? []);
  for (const output of exports) {
    const file = assetPath(join(relative(assets, folder), output.file));
    assert.equal(
      dirname(file),
      folder,
      "Outputs must stay beside their source",
    );
    assert(!ownedFiles.has(file), `Duplicate asset output: ${file}`);
    ownedFiles.add(file);
    const [w, h] = output.size;
    assert(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0);
    if (!output.allowUpscale)
      assert(
        w <= metadata.width && h <= metadata.height,
        `Refusing to upscale ${output.file}`,
      );
    // Base dimensions are rounded once, then multiplied for Metro densities.
    // Contain preserves the artwork's ratio within that integer-pixel canvas.
    assert(
      Math.abs(w / h - metadata.width / metadata.height) <=
        1 / height + 1 / metadata.height,
      `Aspect ratio changed: ${file}`,
    );
    let pipeline = sharp(bytes, { page: asset.frame ?? 0, pages: 1 })
      .resize(w, h, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: "lanczos3",
      })
      .toColourspace("srgb");
    if (output.flatten)
      pipeline = pipeline.flatten({ background: output.flatten });
    const png = await pipeline
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    if (check) {
      const saved = await readFile(file);
      // A reviewed platform variant must match exact hashes on BOTH sides.
      // Never accept arbitrary pixel tolerances or a changed committed image.
      const equivalents = asset.equivalentExportHashes?.[output.file] ?? [];
      assert(
        saved.equals(png) ||
          (equivalents.includes(sha256(saved)) && equivalents.includes(sha256(png))),
        `Stale export: ${relative(root, file)}; run bun run assets:generate`,
      );
    } else {
      const temporary = `${file}.tmp`;
      await writeFile(temporary, png);
      await rename(temporary, file);
    }
    outputBytes += png.length;
    outputCount++;
  }
}

// Any new raster must declare its source and sizing policy, including files
// accidentally left at the old flat paths. Fonts/SVGs keep their own pipelines.
async function checkRasterInventory(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = join(folder, entry.name);
    if (entry.isDirectory()) await checkRasterInventory(file);
    else if (/\.(png|jpe?g|webp|gif|avif)$/i.test(entry.name)) {
      assert(
        ownedFiles.has(file),
        `Uncatalogued raster: ${relative(assets, file)}`,
      );
    }
  }
}
await checkRasterInventory(assets);

const snapshot = JSON.parse(
  await readFile(
    join(app, "shared/stores/runtime/fixtures/publicDemoSnapshot.json"),
    "utf8",
  ),
);
for (const item of [...snapshot.bundledAvatars, ...snapshot.bundledMedia]) {
  const original = join(app, item.file);
  assert(ownedFiles.has(original), `Uncatalogued public source: ${item.file}`);
  assert.equal(
    sha256(await readFile(original)),
    item.sha256,
    `Public source changed: ${item.file}`,
  );
  assert(
    ownedFiles.has(join(app, item.renderFile)),
    `Missing demo render: ${item.renderFile}`,
  );
}

console.log(
  `${check ? "Verified" : "Generated"} ${outputCount} PNGs from ${manifest.assets.length} unchanged sources (${(outputBytes / 1024 / 1024).toFixed(2)} MiB of exports).`,
);
