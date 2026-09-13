#!/usr/bin/env node
// Explicit maintenance command only; rendering always reads retained local bytes.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FOLDER } from "./artwork.mjs";
import { hash } from "./lib/marketing-render.mjs";
const refresh = process.argv.includes("--refresh-catalog");
assert(
  process.argv.slice(2).every((arg) => arg === "--refresh-catalog"),
  "Usage: node scripts/fetch-wallpapers.mjs [--refresh-catalog]",
);
const folder = join(FOLDER, "source/wallpapers");
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  assert(response.ok, `Wallpaper download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const bytes = refresh
  ? await download("https://nagg.up.railway.app/app/wallpapers")
  : await readFile(join(folder, "catalog.json"));
const catalog = JSON.parse(bytes);
const portraits = [];
for (const entry of catalog.wallpapers) {
  assert(
    /^[a-z][a-z0-9-]*$/.test(entry.themeName) &&
      /^[a-f0-9]{64}$/.test(entry.sha256),
  );
  const url = new URL(entry.blossomUrl);
  assert(
    url.protocol === "https:" &&
      url.pathname.split("/").at(-1).split(".")[0] === entry.sha256,
    "Blossom URL hash mismatch",
  );
  const portrait = await download(url);
  assert.equal(
    hash(portrait),
    entry.sha256,
    `Portrait hash mismatch: ${entry.themeName}`,
  );
  portraits.push([entry.themeName, portrait]);
}
await mkdir(folder, { recursive: true });
for (const [name, portrait] of portraits)
  await writeFile(join(folder, `${name}.jpg`), portrait);
if (refresh) await writeFile(join(folder, "catalog.json"), bytes);
console.log(
  `Authenticated and retained ${portraits.length} original portrait wallpapers.`,
);
