#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { optimize } from "svgo";
import { svgPathBbox } from "svg-path-bbox";
import opentype from "opentype.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "app/package.json"));
const sharp = require("sharp");
const images = join(root, "app/assets/brand");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const number = (n) => Number(n.toFixed(6));

export const SVGO_OPTIONS = {
  multipass: true,
  floatPrecision: 3,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          convertPathData: {
            applyTransforms: false,
            floatPrecision: 5,
            makeArcs: false,
          },
          convertTransform: { floatPrecision: 6, transformPrecision: 6 },
        },
      },
    },
    "removeDimensions",
    "sortAttrs",
  ],
};

function geometry(svg) {
  assert(
    !/<(?:script|image|use|filter|text)\b|\bon\w+=|href=/i.test(svg),
    "Master must contain self-contained outlined paths",
  );
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(paths.length, 1, "Each canonical source owns one compound path");
  const d = paths[0];
  assert(!/NaN|Infinity/.test(d), "Outlined paths must have finite coordinates");
  const [x1, y1, x2, y2] = svgPathBbox(d);
  return { d, x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export async function loadBrandInputs() {
  const [configBytes, markBytes, wordmarkBytes, appBytes] = await Promise.all([
    readFile(join(images, "source/brand.json")),
    readFile(join(images, "source/symbol.svg")),
    readFile(join(images, "source/wordmark.svg")),
    readFile(join(root, "app/app.json")),
  ]);
  const config = JSON.parse(configBytes);
  assert.equal(config.version, 1);
  assert.deepEqual(config.sizes, [16, 32, 64, 128, 256, 512, 1024, 2048]);
  const fontBytes = await readFile(join(root, config.versionFont));
  const font = opentype.parse(
    fontBytes.buffer.slice(
      fontBytes.byteOffset,
      fontBytes.byteOffset + fontBytes.byteLength,
    ),
  );
  return {
    config,
    font,
    version: JSON.parse(appBytes).expo.version,
    mark: geometry(markBytes.toString()),
    wordmark: geometry(wordmarkBytes.toString()),
    hashes: {
      mark: hash(markBytes),
      wordmark: hash(wordmarkBytes),
      font: hash(fontBytes),
      config: hash(configBytes),
    },
  };
}

function placedPath(shape, x, y, scale, role) {
  const tx = x - shape.x * scale;
  const ty = y - shape.y * scale;
  return {
    svg: `<path d="${shape.d}" transform="translate(${number(tx)} ${number(ty)}) scale(${number(scale)})"/>`,
    bounds: {
      role,
      x: number(x),
      y: number(y),
      width: number(shape.width * scale),
      height: number(shape.height * scale),
    },
  };
}

/** All layouts receive the very same mark path, scaled uniformly by ink bounds. */
export function composeBrand(
  inputs,
  layoutName,
  themeName,
  productVersion = inputs.version,
) {
  assert(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(productVersion),
    "Invalid product version",
  );
  const layout = inputs.config.layouts[layoutName];
  const theme = inputs.config.themes[themeName];
  assert(layout && theme, "Unknown brand variant");
  const [width, height] = layout.canvas;
  const markScale = layout.markHeight / inputs.mark.height;
  const markWidth = inputs.mark.width * markScale;
  const pieces = [];
  if (layoutName === "symbol") {
    pieces.push(
      placedPath(
        inputs.mark,
        (width - markWidth) / 2,
        (height - layout.markHeight) / 2,
        markScale,
        "mark",
      ),
    );
  } else if (layoutName === "wordmark-lockup") {
    const textScale = layout.textHeight / inputs.wordmark.height;
    const textWidth = inputs.wordmark.width * textScale;
    const left = (width - markWidth - layout.gap - textWidth) / 2;
    assert(left > 0, "Wordmark exceeds canvas");
    pieces.push(
      placedPath(
        inputs.mark,
        left,
        (height - layout.markHeight) / 2,
        markScale,
        "mark",
      ),
    );
    pieces.push(
      placedPath(
        inputs.wordmark,
        left + markWidth + layout.gap,
        (height - layout.textHeight) / 2,
        textScale,
        "wordmark",
      ),
    );
  } else {
    const textPath = inputs.font.getPath(productVersion, 0, 0, 100, {
      kerning: true,
    });
    // opentype.js 2.0's decimal rounding fails for near-integer floats
    // (e.g. 185.00000000000003), producing NaN in otherwise valid glyphs.
    // Quantize to the export precision before its SVG serialization.
    for (const command of textPath.commands) {
      for (const key of Object.keys(command)) {
        if (typeof command[key] === "number") {
          command[key] = Number(command[key].toFixed(5));
        }
      }
    }
    const text = geometry(
      `<path d="${textPath.toPathData({ decimalPlaces: 5, flipY: false })}"/>`,
    );
    const textScale = Math.min(
      layout.textHeight / text.height,
      layout.textMaxWidth / text.width,
    );
    const textHeight = text.height * textScale;
    const top = (height - layout.markHeight - layout.gap - textHeight) / 2;
    pieces.push(
      placedPath(inputs.mark, (width - markWidth) / 2, top, markScale, "mark"),
    );
    pieces.push(
      placedPath(
        text,
        (width - text.width * textScale) / 2,
        top + layout.markHeight + layout.gap,
        textScale,
        "version",
      ),
    );
  }
  const defs = [];
  const linear = (id, from, to) =>
    `<linearGradient id="${id}" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
  let background = "";
  if (theme.background) {
    const colors =
      theme.background === "light"
        ? ["#fff", "#e1e1e1"]
        : ["#181818", "#030303"];
    defs.push(linear("bg", ...colors));
    background = `<path fill="url(#bg)" d="M0 0H${width}V${height}H0z"/>`;
  }
  // Flat foregrounds remove near-invisible inner-shadow filter stacks and
  // guarantee identical silhouettes in light/dark/transparent variants.
  const fill = theme.foreground === "dark" ? "#050505" : "#fff";
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${background}<g fill="${fill}">${pieces.map((piece) => piece.svg).join("")}</g></svg>`;
  const svg = optimize(raw, SVGO_OPTIONS).data + "\n";
  return {
    raw,
    svg,
    width,
    height,
    bounds: pieces.map((p) => p.bounds),
    version: layoutName === "version-lockup" ? productVersion : undefined,
  };
}

/** Android's foreground needs extra room for launcher masks and parallax. */
export function composeAndroidAdaptive(inputs) {
  return composeBrand(
    {
      ...inputs,
      config: {
        ...inputs.config,
        layouts: {
          ...inputs.config.layouts,
          symbol: {
            ...inputs.config.layouts.symbol,
            markHeight: inputs.config.androidAdaptive.markHeight,
          },
        },
      },
    },
    "symbol",
    "black-on-transparent",
  );
}

export async function rasterizeBrand(svg, width, height, opaque) {
  // Set the viewport before rendering: every pixel size is rasterized directly
  // from vector curves, never enlarged from another PNG.
  const input = svg.replace(
    "<svg ",
    `<svg width="${width}" height="${height}" `,
  );
  let pipeline = sharp(Buffer.from(input));
  if (opaque) pipeline = pipeline.flatten({ background: "#fff" });
  return pipeline
    .toColourspace("srgb")
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

export async function generateBrand({ check = false } = {}) {
  const inputs = await loadBrandInputs();
  const files = [];
  const variants = [];
  async function output(relativePath, bytes) {
    const file = join(images, relativePath);
    if (check) {
      assert(
        (await readFile(file)).equals(Buffer.from(bytes)),
        `Stale brand export: ${relativePath}; run bun run assets:generate`,
      );
    } else {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, bytes);
      await rename(`${file}.tmp`, file);
    }
    files.push(file);
  }
  for (const layout of Object.keys(inputs.config.layouts)) {
    for (const [theme, colors] of Object.entries(inputs.config.themes)) {
      const directory = `generated/${layout}/${theme}`;
      const drawing = composeBrand(inputs, layout, theme);
      await output(`${directory}/artwork.svg`, drawing.svg);
      const pngs = [];
      for (const width of inputs.config.sizes) {
        const height = Math.round((width * drawing.height) / drawing.width);
        const png = await rasterizeBrand(
          drawing.svg,
          width,
          height,
          !!colors.background,
        );
        const file = `${directory}/${width}x${height}.png`;
        await output(file, png);
        pngs.push({ file, width, height, sha256: hash(png) });
      }
      variants.push({
        layout,
        theme,
        svg: `${directory}/artwork.svg`,
        viewBox: [0, 0, drawing.width, drawing.height],
        bounds: drawing.bounds,
        version: drawing.version,
        svgBytes: Buffer.byteLength(drawing.svg),
        unoptimizedBytes: Buffer.byteLength(drawing.raw),
        pngs,
      });
    }
  }
  const adaptive = composeAndroidAdaptive(inputs);
  await output(
    "generated/android-adaptive-icon/black-on-transparent/artwork.svg",
    adaptive.svg,
  );
  const adaptivePngs = [];
  for (const size of inputs.config.sizes) {
    const png = await rasterizeBrand(adaptive.svg, size, size, false);
    const file = `generated/android-adaptive-icon/black-on-transparent/${size}x${size}.png`;
    await output(file, png);
    adaptivePngs.push({ file, width: size, height: size, sha256: hash(png) });
  }
  const manifest = {
    schema: 1,
    productVersion: inputs.version,
    sources: inputs.hashes,
    tools: {
      svgo: "4.1.0",
      opentype: "2.0.0",
      geometry: "svg-path-bbox@2.1.0",
    },
    variants,
    androidAdaptive: {
      svg: "generated/android-adaptive-icon/black-on-transparent/artwork.svg",
      bounds: adaptive.bounds,
      pngs: adaptivePngs,
    },
  };
  await output(
    "generated/manifest.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const sections = Object.keys(inputs.config.layouts)
    .map(
      (layout) =>
        `<section><h2>${layout}</h2><div class="grid">${variants
          .filter((variant) => variant.layout === layout)
          .map((variant) => {
            const directory = dirname(variant.svg);
            return `<article><h3>${variant.theme}</h3><div class="preview"><img alt="${layout} ${variant.theme}" data-directory="${directory}" data-ratio="${variant.viewBox[3] / variant.viewBox[2]}" src="${directory}/512x${variant.pngs.find((p) => p.width === 512).height}.png"></div><p><a href="${variant.svg}">SVG</a> · <a data-download href="${directory}/512x${variant.pngs.find((p) => p.width === 512).height}.png" download>PNG</a></p></article>`;
          })
          .join("")}</div></section>`,
    )
    .join("");
  await output(
    "index.html",
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sovran brand assets</title><style>
  body{margin:32px;font:16px system-ui;background:#f5f5f5;color:#171717}h1{margin-bottom:8px}header{position:sticky;top:0;background:#f5f5f5;padding:12px 0;z-index:1}select,label{margin-right:16px}section{margin-top:32px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}article{background:white;padding:16px;border-radius:12px}.preview{height:260px;display:flex;align-items:center;justify-content:center;overflow:auto;background:repeating-conic-gradient(#888 0 25%,#aaa 0 50%) 0/20px 20px}.preview img{max-width:100%;max-height:100%;object-fit:contain}.native .preview{justify-content:start;align-items:start}.native .preview img{max-width:none;max-height:none}a{color:#1254a3}
  </style><h1>Sovran brand assets</h1><p>Version ${inputs.version} · one canonical S · PNGs rendered directly from optimized SVGs</p><header><label>PNG width <select id="size">${inputs.config.sizes.map((size) => `<option${size === 512 ? " selected" : ""}>${size}</option>`).join("")}</select></label><label><input id="native" type="checkbox"> Show actual pixels</label><span>Logos and version cards are square; wordmarks are 8:3.</span></header>${sections}<section><h2>Android adaptive foreground</h2><p>Extra padding preserves the same S under launcher masks. <a href="generated/android-adaptive-icon/black-on-transparent/artwork.svg">SVG</a></p><article><div class="preview"><img alt="Android adaptive foreground" data-directory="generated/android-adaptive-icon/black-on-transparent" data-ratio="1" src="generated/android-adaptive-icon/black-on-transparent/512x512.png"></div><p><a data-download href="generated/android-adaptive-icon/black-on-transparent/512x512.png" download>PNG</a></p></article></section><script>
  document.querySelector('#size').addEventListener('change',event=>{for(const img of document.querySelectorAll('img')){const path=img.dataset.directory+'/'+event.target.value+'x'+Math.round(Number(event.target.value)*Number(img.dataset.ratio))+'.png';img.src=path;img.closest('article').querySelector('[data-download]').href=path;}});document.querySelector('#native').addEventListener('change',event=>document.body.classList.toggle('native',event.target.checked));
  </script></html>\n`,
  );
  console.log(
    `${check ? "Verified" : "Generated"} 13 brand SVGs and 104 PNGs (16–2048px), version ${inputs.version}.`,
  );
  return { files, manifest };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert(
    process.argv.length === 2 ||
      (process.argv.length === 3 && process.argv[2] === "--check"),
    "Usage: node scripts/brand-assets.mjs [--check]",
  );
  await generateBrand({ check: process.argv[2] === "--check" });
}
