import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
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

// Caller defines #shadow and #rim once for the canvas. depth controls paint order.
export async function phone({
  screenshot,
  platform,
  x,
  y,
  width,
  rotate = 0,
  depth = 0,
  mask = "frame",
  index = 0,
  dim = 0,
  scaleX = 1,
  frame = "#181818",
  frameEdge = "#2e2e2e",
  underlay = "",
  uiMask,
}) {
  assert(mask === "frame", "Unknown phone mask");
  assert(Number.isFinite(depth));
  const meta = await sharp(screenshot).metadata();
  assert(["ios", "android"].includes(platform), "Unknown platform");
  // Retain the full native capture, including status bar and home indicator.
  let screenBytes = screenshot;

  if (uiMask) {
    const maskMeta = await sharp(uiMask).metadata();
    assert(
      maskMeta.width === meta.width && maskMeta.height === meta.height,
      "UI mask must match the original screenshot size",
    );
    const alpha = await sharp(uiMask).removeAlpha().greyscale().toBuffer();
    const rgb = await sharp(screenBytes).removeAlpha().png().toBuffer();
    screenBytes = await sharp(rgb).joinChannel(alpha).png().toBuffer();
  }
  const w = width,
    h = (meta.height / meta.width) * w;
  const bezel = Math.round(w * 0.03),
    frameW = w + 2 * bezel,
    frameH = h + 2 * bezel,
    frameR = w * 0.135,
    screenR = frameR - bezel;

  return {
    width: w,
    height: h,
    bezel,
    frameH,
    svg: `<g transform="translate(${x} ${y})${rotate || scaleX !== 1 ? ` rotate(${rotate} ${w / 2} ${h / 2}) scale(${scaleX} 1)` : ""}">
  <rect x="${-bezel}" y="${-bezel}" width="${frameW}" height="${frameH}" rx="${frameR}" fill="#000" filter="url(#shadow)"/>
  <rect x="${-bezel}" y="${-bezel}" width="${frameW}" height="${frameH}" rx="${frameR}" fill="${frame}" stroke="${frameEdge}" stroke-width="1"/>
  <clipPath id="screen${index}"><rect width="${w}" height="${h}" rx="${screenR}"/></clipPath>
${underlay ? `  ${underlay}\n` : ""}  <image width="${w}" height="${h}" href="data:image/png;base64,${screenBytes.toString("base64")}" clip-path="url(#screen${index})"/>
  <rect width="${w}" height="${h}" rx="${screenR}" fill="#000" opacity="${dim}"/>
  <rect x="${-bezel + 0.5}" y="${-bezel + 0.5}" width="${frameW - 1}" height="${frameH - 1}" rx="${frameR}" fill="none" stroke="url(#rim)" stroke-width="1"/>
  </g>`,
  };
}
