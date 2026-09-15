import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import opentype from "opentype.js";
import { composeBrand, rasterizeBrand } from "../brand-assets.mjs";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function loadFonts(root) {
  const fonts = {};
  for (const name of ["ExtraBold", "Medium"]) {
    const bytes = await readFile(
      join(root, `app/assets/fonts/MonaSans/MonaSans-${name}.ttf`),
    );
    fonts[name] = opentype.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  }
  return fonts;
}
export function text(fonts, value, x, y, size, color, weight, maxWidth) {
  const font = fonts[weight];
  const width = font.getAdvanceWidth(value, size, { kerning: true });
  assert(width <= maxWidth, `Copy too wide for its column: ${value}`);
  // Outline at design scale: tiny direct coordinates can produce NaNs in OpenType.
  const d = font
    .getPath(value, 0, 0, 1000, { kerning: true })
    .toPathData({ decimalPlaces: 3, flipY: false });
  assert(!/NaN|Infinity/.test(d), `Invalid font outline: ${value}`);
  return `<path d="${d}" fill="${color}" transform="translate(${x} ${y}) scale(${size / 1000})"/>`;
}

export async function brandLockup(brand, height) {
  const lockup = composeBrand(brand, "wordmark-lockup", "white-on-transparent");
  // Place the lockup by its ink bounds, not its padded canvas.
  const ink = {
    x: Math.min(...lockup.bounds.map((b) => b.x)),
    y: Math.min(...lockup.bounds.map((b) => b.y)),
    height: Math.max(...lockup.bounds.map((b) => b.y + b.height)),
  };
  ink.height -= ink.y;
  const logoScale = height / ink.height;
  const logoWidth = lockup.width * logoScale;
  const logoHeight = lockup.height * logoScale;
  const logo = await rasterizeBrand(
    lockup.svg,
    Math.round(logoWidth * 2),
    Math.round(logoHeight * 2),
    false,
  );

  return { ink, logoScale, logoWidth, logoHeight, logo };
}
