#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadBrandInputs } from "./brand-assets.mjs";
import { loadFonts, text, brandLockup, hash } from "./lib/marketing-render.mjs";
import {
  LIBRARY_BODY,
  captureDevice,
  phoneGeometry,
  renderPhone,
} from "./lib/phone-frame.mjs";

export async function phone({
  screenshot,
  platform,
  x,
  y,
  width,
  rotate = 0,
  index = 0,
  underlay = "",
  uiMask,
}) {
  const meta = await sharp(screenshot).metadata();
  let bytes = screenshot;
  if (uiMask) {
    const maskMeta = await sharp(uiMask).metadata();
    assert(
      maskMeta.width === meta.width && maskMeta.height === meta.height,
      "UI mask must match the original screenshot size",
    );
    const alpha = await sharp(uiMask).removeAlpha().greyscale().toBuffer();
    bytes = await sharp(await sharp(bytes).removeAlpha().png().toBuffer())
      .joinChannel(alpha)
      .png()
      .toBuffer();
  }
  const device = captureDevice(platform, meta.width, meta.height);
  const scale = width / device.width;
  const geometry = phoneGeometry(meta.width, meta.height, {
    platform,
    x,
    y,
    rotateZ: rotate,
    scale,
  });
  return {
    width,
    height: (width * meta.height) / meta.width,
    bezel: device.bezel * scale,
    frameH: (device.height + 2 * device.bezel) * scale,
    svg: renderPhone(geometry, {
      id: `artwork-${index}`,
      href: `data:image/png;base64,${bytes.toString("base64")}`,
      underlay,
    }),
  };
}

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FOLDER = join(ROOT, "press/artwork");
export const ASPECTS = {
  wide: [2048, 1000],
  tall: [1080, 1920],
  square: [1080, 1080],
};
const layoutIds = [
  "hero-fan",
  "spotlight",
  "duo",
  "triptych",
  "stack",
  "closeup",
  "portal",
  "pack",
];
const counts = [
  [3, 4],
  [1, 1],
  [2, 2],
  [3, 3],
  [3, 3],
  [1, 1],
  [1, 1],
  [3, 5],
];
const slug = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const sha = /^[a-f0-9]{64}$/;
const uri = (bytes) => `data:image/png;base64,${bytes.toString("base64")}`;
const json = (value) => JSON.stringify(value, null, 2) + "\n";
async function optional(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function sourcePath(file) {
  assert(
    typeof file === "string" &&
      /^source\/[a-zA-Z0-9/._-]+$/.test(file) &&
      !file.split("/").includes(".."),
    `Invalid source path: ${file}`,
  );
  return join(FOLDER, file);
}
export function validateLayouts(catalog) {
  assert.equal(catalog.version, 1);
  assert.deepEqual(catalog.aspects, ASPECTS);
  assert.equal(catalog.margin, 0.0625);
  assert.deepEqual(
    catalog.layouts.map((l) => l.id),
    layoutIds,
    "Layout catalog must include each named layout exactly once",
  );
  for (const [i, l] of catalog.layouts.entries()) {
    assert(
      typeof l.description === "string" && l.description.length > 30,
      "Layout description required",
    );
    assert.deepEqual(
      [l.phones.min, l.phones.max],
      counts[i],
      `Invalid phone count: ${l.id}`,
    );
    assert.deepEqual(
      Object.keys(l.copyBlock).sort(),
      Object.keys(ASPECTS).sort(),
    );
    assert(
      Object.values(l.copyBlock).every((v) =>
        ["left", "top", "top-left", "centred top"].includes(v),
      ),
      "Unknown copy block",
    );
  }
}
export function applicability(spec, layout, project) {
  if (!spec.layouts.includes(layout.id)) return "Not listed by concept";
  if (layout.id === "pack" && spec.screenshots.length < layout.phones.min)
    return `Needs ${layout.phones.min} phones; concept provides ${spec.screenshots.length}`;
  const ids = spec.screenshots.map(
    (key) => project.screenshots[`${spec.platform}/${key}`]?.wallpaperId,
  );
  if (
    layout.id === "portal" &&
    (!spec.background.wallpaperId || !ids.includes(spec.background.wallpaperId))
  )
    return "Needs matching wallpaper capture";
  if (
    layout.id === "pack" &&
    (new Set(ids).size !== ids.length ||
      ids.some(
        (id) => !id || project.wallpapers[id]?.album !== spec.background.album,
      ))
  )
    return "Needs 3–5 different wallpapers from one album";
  return null;
}
export function validateSelection(project) {
  const ids = project.specs.map((s) => s.id);
  assert(
    ids.includes(project.selection.featureGraphic),
    "Unknown featureGraphic concept",
  );
  assert.deepEqual(
    Object.keys(project.selection)
      .filter((id) => id !== "featureGraphic")
      .sort(),
    [...ids].sort(),
    "Selection must cover every concept without extras",
  );
  for (const spec of project.specs) {
    const selection = project.selection[spec.id];
    assert.deepEqual(
      Object.keys(selection).sort(),
      Object.keys(ASPECTS).sort(),
      `Selection needs all aspects: ${spec.id}`,
    );
    for (const id of Object.values(selection)) {
      const layout = project.layouts.layouts.find((l) => l.id === id);
      assert(layout, `Unknown selected layout: ${id}`);
      assert.equal(
        applicability(spec, layout, project),
        null,
        `Selected layout is n/a: ${spec.id}/${id}`,
      );
    }
  }
}
export async function loadProject() {
  const provenance = {};
  const readJson = async (file) => {
    const bytes = await readFile(sourcePath(file));
    provenance[file] = hash(bytes);
    return JSON.parse(bytes);
  };
  const screenshots = await readJson("source/screenshots.json");
  const layouts = await readJson("source/layouts.json");
  validateLayouts(layouts);
  const copy = await readJson("source/copy.json");
  assert(
    Number.isInteger(copy.version) && copy.version > 0,
    "Copy version required",
  );
  const selection = await readJson("source/selection.json");
  const catalog = await readJson("source/wallpapers/catalog.json");
  const wide = await readJson("source/wallpapers-wide/provenance.json");
  const wallpapers = await readJson("source/wallpapers/colors/provenance.json");
  for (const entry of catalog.wallpapers) {
    assert(
      slug.test(entry.themeName) &&
        sha.test(entry.sha256) &&
        entry.eventId &&
        entry.displayName &&
        entry.palette &&
        entry.albumSlug,
      "Invalid wallpaper catalog entry",
    );
    assert.equal(
      new URL(entry.blossomUrl).pathname
        .split("/")
        .at(-1)
        .replace(/\.(jpg|jpeg|png)$/, ""),
      entry.sha256,
      "Blossom URL must identify original bytes",
    );
    assert(!Object.hasOwn(wallpapers, entry.themeName), "Duplicate wallpaper");
    wallpapers[entry.themeName] = {
      ...entry,
      album: entry.albumSlug,
      file: `source/wallpapers/${entry.themeName}.jpg`,
    };
    const panorama = wide[entry.themeName];
    assert(
      panorama &&
        sha.test(panorama.sha256) &&
        sha.test(panorama.promptSha256) &&
        panorama.generator &&
        panorama.generatedAt,
      `Missing wide provenance: ${entry.themeName}`,
    );
  }
  const pages = new Set(
    [
      ...(
        await readFile(join(ROOT, "app/e2e/schema/pages.ts"), "utf8")
      ).matchAll(/^  '([a-z-]+)'/gm),
    ].map((m) => m[1]),
  );
  for (const [key, shot] of Object.entries(screenshots)) {
    const [platform, name, extra] = key.split("/");
    assert(
      ["ios", "android"].includes(platform) && slug.test(name) && !extra,
      `Invalid screenshot key: ${key}`,
    );
    assert(pages.has(shot.page), `Unknown canonical page: ${shot.page}`);
    assert.equal(shot.file, `source/screenshots/${key}.png`);
    if (shot.wallpaperId)
      assert(wallpapers[shot.wallpaperId], "Unknown screenshot wallpaper");
  }
  const specs = [],
    compositions = {};
  for (const file of (await readdir(join(FOLDER, "source/concepts")))
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const spec = await readJson(`source/concepts/${file}`);
    assert(
      slug.test(spec.id) && file === `${spec.id}.json`,
      "Concept filename must match safe ID",
    );
    assert(["ios", "android"].includes(spec.platform));
    assert(
      Array.isArray(spec.screenshots) &&
        spec.screenshots.length >= 1 &&
        spec.screenshots.length <= 5,
    );
    assert(
      new Set(spec.screenshots).size === spec.screenshots.length,
      "Duplicate screenshots",
    );
    assert(
      spec.screenshots.every((key) => screenshots[`${spec.platform}/${key}`]),
      "Unknown screenshot",
    );
    assert(
      Array.isArray(spec.layouts) &&
        spec.layouts.length &&
        new Set(spec.layouts).size === spec.layouts.length &&
        spec.layouts.every((id) => layoutIds.includes(id)),
      "Unknown or duplicate layouts",
    );
    assert(["brand", "wallpaper", "tint"].includes(spec.background.kind));
    if (spec.background.kind !== "brand")
      assert(
        wallpapers[spec.background.wallpaperId],
        "Unknown background wallpaper",
      );
    const c = copy.concepts[spec.copy];
    assert(c, "Unknown concept copy");
    for (const [key, options] of [
      ["headline", c.headlines],
      ["subtitle", c.subtitles],
    ]) {
      assert(
        Array.isArray(options) &&
          options.length &&
          options.every(
            (s) => typeof s === "string" && s.length && !/[!\n]/.test(s),
          ),
        "Invalid copy options",
      );
      assert(
        Number.isInteger(c.chosen[key]) &&
          c.chosen[key] >= 0 &&
          c.chosen[key] < options.length,
        "Invalid copy choice",
      );
    }
    compositions[spec.id] = provenance[`source/concepts/${file}`];
    specs.push(spec);
  }
  const project = {
    screenshots,
    layouts,
    copy,
    selection,
    catalog,
    wide,
    wallpapers,
    specs,
    provenance,
    compositions,
  };
  validateSelection(project);
  return project;
}
// Authenticate originals even when a missing-input draft is requested. No network in rendering.
export async function loadInputs(project, specs, readSource = optional) {
  const missing = new Set(),
    shots = {},
    wallpapers = {},
    wide = {},
    hashes = {};
  const readHashed = async (entry, label) => {
    const bytes = await readSource(sourcePath(entry.file));
    if (!bytes) {
      missing.add(entry.file);
      return null;
    }
    assert(sha.test(entry.sha256 ?? ""), `Missing SHA-256: ${label}`);
    assert.equal(hash(bytes), entry.sha256, `Source hash mismatch: ${label}`);
    await sharp(bytes).metadata();
    hashes[entry.file] = entry.sha256;
    return bytes;
  };
  for (const spec of specs) {
    const id = spec.background.wallpaperId;
    const wallpaperIds = new Set(
      [
        id,
        ...spec.screenshots.map(
          (key) => project.screenshots[`${spec.platform}/${key}`]?.wallpaperId,
        ),
      ].filter(Boolean),
    );
    for (const wallpaperId of wallpaperIds)
      if (!Object.hasOwn(wallpapers, wallpaperId))
        wallpapers[wallpaperId] = await readHashed(
          project.wallpapers[wallpaperId],
          wallpaperId,
        );
    if (id && !Object.hasOwn(wide, id)) {
      if (project.wide[id]) {
        wide[id] = await readHashed(
          { ...project.wide[id], file: `source/wallpapers-wide/${id}.jpg` },
          `${id} panorama`,
        );
        if (wide[id]) {
          const meta = await sharp(wide[id]).metadata();
          assert.equal(meta.width, project.wide[id].width);
          assert.equal(meta.height, project.wide[id].height);
          assert.equal(meta.width / meta.height, 2, "Panorama must be 2:1");
        }
      }
    }
    for (const key of spec.screenshots) {
      const name = `${spec.platform}/${key}`;
      if (Object.hasOwn(shots, name)) continue;
      const entry = project.screenshots[name];
      assert(entry, `Missing screenshot registration: ${name}`);
      if (entry.availability === "unavailable" || entry.freshness === "stale") {
        missing.add(
          `${entry.file} (unavailable: ${entry.unavailableReason ?? entry.staleReason ?? "capture requires review"})`,
        );
        shots[name] = null;
        continue;
      }
      const bytes = await readHashed(entry, name);
      if (bytes)
        assert(
          typeof entry.run === "string" && entry.run.startsWith("run-"),
          `Missing run ID: ${name}`,
        );
      const uiMask = entry.uiMask
        ? await readHashed(entry.uiMask, `${name} UI mask`)
        : null;
      shots[name] = { bytes, uiMask };
    }
    const portal = project.layouts.layouts.find((l) => l.id === "portal");
    if (!applicability(spec, portal, project)) {
      const key = spec.screenshots.find(
        (s) => project.screenshots[`${spec.platform}/${s}`].wallpaperId === id,
      );
      if (!shots[`${spec.platform}/${key}`]?.uiMask)
        missing.add(
          `UI mask for ${spec.platform}/${key} (screenshots.json uiMask)`,
        );
    }
  }
  return {
    shots,
    wallpapers,
    wide,
    hashes: Object.fromEntries(Object.entries(hashes).sort()),
    missing: [...missing].sort(),
  };
}
// Restore catalog pixels at native panorama height; only 24-pixel vertical edges blend.
// The blend is integer arithmetic on raw pixels rather than a libvips composite:
// libvips premultiplies in floating point and its x86 and arm64 vector paths
// round differently by ±1–2 levels inside the feather, which made the same
// source render different bytes on macOS and on the CI runner.
export async function restoreCentre(portrait, panorama) {
  const meta = await sharp(panorama).metadata();
  const original = await sharp(portrait)
    .resize({ height: meta.height, kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert(original.info.width < meta.width, "Portrait must fit panorama");
  assert.equal(original.info.channels, 3);
  // Feather outwards: the entire original strip remains opaque and exact.
  // Extend its edge pixels only into the generated flanks, then fade over 24 px.
  const feather = 24,
    overlayWidth = original.info.width + feather * 2;
  const extended = await sharp(original.data, { raw: original.info })
    .extend({
      left: feather,
      right: feather,
      top: 0,
      bottom: 0,
      extendWith: "copy",
    })
    .raw()
    .toBuffer();
  const base = await sharp(panorama)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(base.info.channels, 3);
  const left = Math.round((meta.width - original.info.width) / 2) - feather;
  const alpha = new Uint8Array(overlayWidth);
  for (let x = 0; x < overlayWidth; x++)
    alpha[x] = Math.round(
      255 * Math.min(1, x / feather, (overlayWidth - 1 - x) / feather),
    );
  const out = Buffer.from(base.data);
  for (let y = 0; y < meta.height; y++)
    for (let x = 0; x < overlayWidth; x++) {
      const a = alpha[x],
        src = (y * overlayWidth + x) * 3,
        dst = (y * meta.width + left + x) * 3;
      for (let c = 0; c < 3; c++)
        out[dst + c] = Math.round(
          (extended[src + c] * a + out[dst + c] * (255 - a)) / 255,
        );
    }
  return sharp(out, { raw: base.info }).png().toBuffer();
}
// Position the restored portrait behind the phone, then use this identical crop
// for both the blurred background and the sharp masked screen. A centred canvas
// crop alone would put a right-hand phone over the generated panorama flank.
export async function portalCanvas(source, portrait, size, position) {
  const [W, H] = size;
  const meta = await sharp(source).metadata();
  const original = await sharp(portrait).metadata();
  const portraitWidth = Math.round(
    (original.width / original.height) * meta.height,
  );
  const focusX = position.x + position.width / 2;
  const scale = Math.max(
    H / meta.height,
    (2 * focusX) / meta.width,
    (2 * (W - focusX)) / meta.width,
    position.width / portraitWidth,
  );
  const width = Math.ceil(meta.width * scale),
    height = Math.ceil(meta.height * scale);
  const left = Math.max(0, Math.min(width - W, Math.round(width / 2 - focusX)));
  const top = Math.round((height - H) / 2);
  const png = await sharp(source)
    .resize(width, height)
    .extract({ left, top, width: W, height: H })
    .png()
    .toBuffer();
  const centreStrip = {
    x: (width - (portraitWidth * width) / meta.width) / 2 - left,
    width: (portraitWidth * width) / meta.width,
  };
  assert(
    position.x >= centreStrip.x - 1 &&
      position.x + position.width <= centreStrip.x + centreStrip.width + 1,
    "Portal phone must show original portrait, not generated flanks",
  );
  return { png, centreStrip };
}
const defs = `<defs>
<radialGradient id="spot"><stop stop-color="#282828"/><stop offset="1" stop-color="#0e0e0e"/></radialGradient>
</defs>`;
export function phoneBounds(p) {
  // Conservative front/roll envelope: includes the widest supported chassis
  // and button protrusions, rather than the old 3% circular bezel.
  const r = (p.rotate * Math.PI) / 180,
    bezel = p.width * 0.046;
  const w = p.width + bezel * 2,
    h = p.height + bezel * 2;
  const width = Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r));
  const height = Math.abs(h * Math.cos(r)) + Math.abs(w * Math.sin(r));
  return {
    x: p.x + p.width / 2 - width / 2,
    y: p.y + p.height / 2 - height / 2,
    width,
    height,
  };
}
export function assertNoCollision(copy, phones) {
  for (const p of phones) {
    const b = phoneBounds(p);
    assert(
      !(
        copy.x < b.x + b.width &&
        copy.x + copy.width > b.x &&
        copy.y < b.y + b.height &&
        copy.y + copy.height > b.y
      ),
      "Copy box collides with phone bounds",
    );
  }
}
// Layout geometry is relative to its reserved phone region. Full native ratios
// determine actual bounds; fit the group horizontally and keep copy clearance.
export function arrange(layout, aspect, size, ratios, copyBottom) {
  const [W, H] = size,
    unit = Math.min(W, H),
    margin = unit * 0.0625;
  const side = layout.copyBlock[aspect] === "left";
  const region = {
    x: side ? W * 0.45 : margin,
    y: side ? margin : copyBottom + unit * 0.05,
    width: side ? W * 0.55 - margin : W - margin * 2,
  };
  region.height = H - margin - region.y;
  const n = ratios.length,
    positions = [];
  const add = (i, x, y, width, rotate = 0, dim = 0) =>
    positions.push({
      index: i,
      x: region.x + x,
      y: region.y + y,
      width,
      height: width * ratios[i],
      rotate,
      dim,
    });
  if (layout.id === "hero-fan") {
    for (let i = n - 1; i >= 0; i--) {
      const depth = (n - 1 - i) / (n - 1);
      const w =
        region.width *
        (aspect === "wide" ? 0.4 + depth * 0.16 : 0.44 + depth * 0.2);
      add(
        i,
        region.width * depth * (aspect === "wide" ? 0.56 : 0.36),
        region.height * (0.26 - depth * 0.23),
        w,
        0,
        (1 - depth) * 0.42,
      );
    }
  } else if (layout.id === "spotlight" || layout.id === "portal") {
    // Side-copy canvases let the phone run off the bottom edge (reference
    // feature graphic); tall keeps the whole phone visible.
    const bleed =
      layout.id === "portal" ? 0.92 : aspect === "tall" ? 0.92 : 1.28;
    const w = Math.min(
      region.width * 0.72,
      (region.height / ratios[0]) * bleed,
    );
    add(
      0,
      (region.width - w) / 2,
      region.height * 0.035,
      w,
      layout.id === "portal" ? 0 : -5,
    );
  } else if (layout.id === "duo") {
    const w = Math.min(
      region.width * 0.46,
      (region.height / Math.max(...ratios)) * (aspect === "tall" ? 0.9 : 1.34),
    );
    add(1, region.width / 2 - w * 0.2, 0, w * 0.94, 5, 0.18);
    add(0, region.width / 2 - w * 0.87, region.height * 0.14, w, -5);
  } else if (layout.id === "triptych" && aspect === "tall") {
    for (let i = 0; i < 3; i++) {
      const w = region.width * (0.53 - i * 0.025);
      add(
        i,
        [0, region.width - w, region.width * 0.16][i],
        i * region.height * 0.24,
        w,
        0,
        (2 - i) * 0.08,
      );
    }
  } else if (layout.id === "pack" && aspect === "tall") {
    const rows = Math.ceil(n / 2),
      gap = unit * 0.07,
      cellHeight = (region.height - gap * (rows - 1)) / rows,
      w = Math.min((region.width - gap) / 2, cellHeight / Math.max(...ratios));
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 2),
        lastSingle = i === n - 1 && n % 2 === 1;
      add(
        i,
        lastSingle
          ? (region.width - w) / 2
          : (region.width - w * 2 - gap) / 2 + (i % 2) * (w + gap),
        row * (cellHeight + gap),
        w,
        lastSingle ? 0 : i % 2 === 0 ? -2 : 2,
      );
    }
  } else if (layout.id === "triptych" || layout.id === "pack") {
    const step = region.width / n;
    for (let i = 0; i < n; i++) {
      const w = Math.min(
        step * 0.88,
        (region.height / ratios[i]) * (aspect === "wide" ? 1.1 : 0.96),
      );
      add(
        i,
        step * i + (step - w) / 2,
        layout.id === "pack" ? Math.abs(i - (n - 1) / 2) * unit * 0.04 : 0,
        w,
        layout.id === "pack" ? (i - (n - 1) / 2) * 3 : 0,
      );
    }
  } else if (layout.id === "stack") {
    const w = Math.min(
      region.width * 0.52,
      (region.height / Math.max(...ratios)) * (aspect === "tall" ? 0.95 : 1.25),
    );
    for (let i = 2; i >= 0; i--)
      add(
        i,
        region.width * 0.17 + i * w * 0.21,
        region.height * (0.15 + i * 0.2),
        w * (1 - i * 0.06),
        -5 + i * 9,
        i * 0.15,
      );
  } else if (layout.id === "closeup") {
    const visible = aspect === "tall" ? 0.6 : 0.55;
    const w = Math.min(
      region.width * 0.9,
      (H - region.y) / (ratios[0] * visible),
    );
    add(0, (region.width - w) / 2, 0, w);
  }
  let bounds = positions.map(phoneBounds);
  if (aspect === "tall" && ["pack", "triptych"].includes(layout.id)) {
    const left = Math.min(...bounds.map((b) => b.x)),
      top = Math.min(...bounds.map((b) => b.y)),
      width = Math.max(...bounds.map((b) => b.x + b.width)) - left,
      height = Math.max(...bounds.map((b) => b.y + b.height)) - top,
      scale = Math.min(region.width / width, region.height / height);
    for (const p of positions) {
      p.x =
        region.x + (region.width - width * scale) / 2 + (p.x - left) * scale;
      p.y =
        region.y + (region.height - height * scale) / 2 + (p.y - top) * scale;
      p.width *= scale;
      p.height *= scale;
    }
    bounds = positions.map(phoneBounds);
  }
  const left = Math.min(...bounds.map((b) => b.x)),
    right = Math.max(...bounds.map((b) => b.x + b.width));
  if (right - left > region.width && layout.id !== "closeup") {
    const scale = region.width / (right - left);
    for (const p of positions) {
      p.x = region.x + (p.x - left) * scale;
      p.y = region.y + (p.y - region.y) * scale;
      p.width *= scale;
      p.height *= scale;
    }
  }
  bounds = positions.map(phoneBounds);
  const dx =
    layout.id === "closeup"
      ? 0
      : Math.max(0, region.x - Math.min(...bounds.map((b) => b.x)));
  const dy = Math.max(0, region.y - Math.min(...bounds.map((b) => b.y)));
  for (const p of positions) {
    p.x += dx;
    p.y += dy;
  }
  return positions;
}
function fitLines(font, value, width, initialSize) {
  for (let size = initialSize; size > initialSize * 0.3; size *= 0.97) {
    const words = value.split(" "),
      lines = [""];
    for (const word of words) {
      const candidate = lines.at(-1) ? `${lines.at(-1)} ${word}` : word;
      if (
        font.getAdvanceWidth(candidate, size, { kerning: true }) > width &&
        lines.at(-1)
      )
        lines.push(word);
      else lines[lines.length - 1] = candidate;
    }
    if (
      lines.length <= 2 &&
      lines.every(
        (line) => font.getAdvanceWidth(line, size, { kerning: true }) <= width,
      )
    )
      return { lines, size };
  }
  throw new Error(`Copy cannot fit two lines: ${value}`);
}
async function copyBlock(spec, layout, aspect, size, project, context) {
  const [W, H] = size,
    unit = Math.min(W, H),
    margin = unit * project.layouts.margin;
  const side = layout.copyBlock[aspect] === "left",
    centred = layout.copyBlock[aspect] === "centred top";
  const box = {
    x: margin,
    y: side ? H * 0.2 : margin,
    width: side ? W * 0.35 : W - 2 * margin,
  };
  const c = project.copy.concepts[spec.copy];
  const headline = fitLines(
    context.fonts.ExtraBold,
    c.headlines[c.chosen.headline],
    box.width,
    unit * (layout.id === "closeup" ? 0.093 : 0.072),
  );
  if (layout.id === "closeup" && headline.lines.length === 1) {
    const words = headline.lines[0].split(" "),
      middle = Math.ceil(words.length / 2);
    headline.lines = [
      words.slice(0, middle).join(" "),
      words.slice(middle).join(" "),
    ];
  }
  const subtitle = fitLines(
    context.fonts.Medium,
    c.subtitles[c.chosen.subtitle],
    box.width,
    unit * 0.028,
  );
  const lockup = await brandLockup(context.brand, unit * 0.047);
  const { ink, logoScale, logoWidth, logoHeight, logo } = lockup;
  const logoX = centred ? (W - logoWidth) / 2 : box.x - ink.x * logoScale;
  const svg = [
    `<image x="${logoX}" y="${box.y - ink.y * logoScale}" width="${logoWidth}" height="${logoHeight}" href="${uri(logo)}"/>`,
  ];
  let y = box.y + unit * 0.096;
  for (const [block, font, color] of [
    [headline, "ExtraBold", "#fff"],
    [subtitle, "Medium", "#c5c5c5"],
  ]) {
    for (const line of block.lines) {
      y += block.size;
      const x = centred
        ? (W -
            context.fonts[font].getAdvanceWidth(line, block.size, {
              kerning: true,
            })) /
          2
        : box.x;
      svg.push(
        text(
          context.fonts,
          line,
          x,
          y,
          block.size,
          color,
          font,
          box.width + 0.01,
        ),
      );
      y += block.size * 0.16;
    }
    y += unit * 0.02;
  }
  box.height = y - box.y;
  return { svg: svg.join(""), box };
}
export async function renderArtwork(
  spec,
  layout,
  aspect,
  inputs,
  project,
  context,
  size = ASPECTS[aspect],
) {
  const [W, H] = size,
    unit = Math.min(W, H);
  const c = await copyBlock(spec, layout, aspect, size, project, context);
  const keys =
    layout.id === "portal"
      ? [
          spec.screenshots.find(
            (key) =>
              project.screenshots[`${spec.platform}/${key}`].wallpaperId ===
              spec.background.wallpaperId,
          ),
        ]
      : Array.from(
          {
            length: Math.max(
              layout.phones.min,
              Math.min(spec.screenshots.length, layout.phones.max),
            ),
          },
          (_, index) => spec.screenshots[index % spec.screenshots.length],
        );
  const missing = [],
    screenshots = [],
    ratios = [];
  const body = LIBRARY_BODY[spec.platform];
  const placeholder = await sharp({
    create: { ...body, channels: 3, background: "#242424" },
  })
    .png()
    .toBuffer();
  for (const key of keys) {
    const shot = inputs.shots[`${spec.platform}/${key}`];
    if (!shot?.bytes) missing.push(`${spec.platform}/${key}`);
    const bytes = shot?.bytes ?? placeholder;
    const meta = await sharp(bytes).metadata();
    screenshots.push({ bytes, uiMask: shot?.uiMask });
    ratios.push(meta.height / meta.width);
  }
  const positions = arrange(
    layout,
    aspect,
    size,
    ratios,
    c.box.y + c.box.height,
  );
  assertNoCollision(c.box, positions);
  let background = '<rect width="100%" height="100%" fill="url(#spot)"/>',
    wallpaper,
    centreRestored = false,
    centreStrip = null;
  // Wallpaper and palette backgrounds belong to the album layouts only; every
  // other layout keeps the brand spotlight so a concept does not go navy for no reason.
  const id = ["pack", "portal"].includes(layout.id)
    ? spec.background.wallpaperId
    : undefined;
  if (id && inputs.wallpapers[id]) {
    let source = inputs.wallpapers[id];
    if (layout.id === "portal" && aspect !== "tall" && project.wide[id]) {
      if (inputs.wide[id]) {
        source = await restoreCentre(source, inputs.wide[id]);
        centreRestored = true;
      } else missing.push(`Panorama for ${id}`);
    }
    if (centreRestored) {
      const canvas = await portalCanvas(
        source,
        inputs.wallpapers[id],
        size,
        positions[0],
      );
      wallpaper = canvas.png;
      centreStrip = canvas.centreStrip;
    } else {
      wallpaper = await sharp(source)
        .resize(W, H, { fit: "cover" })
        .png()
        .toBuffer();
    }
    const blurred = await sharp(wallpaper)
      .blur((24 * unit) / 1000)
      .modulate({ brightness: 0.65 })
      .png()
      .toBuffer();
    background = `<image width="${W}" height="${H}" href="${uri(blurred)}"/>`;
  } else if (id) missing.push(`Wallpaper ${id}`);
  const stack = [];
  for (const p of positions) {
    const shot = screenshots[p.index];
    const portal = layout.id === "portal";
    if (portal && !shot.uiMask) missing.push(`UI mask for ${keys[p.index]}`);
    const complete =
      !portal ||
      (wallpaper &&
        shot.uiMask &&
        inputs.shots[`${spec.platform}/${keys[p.index]}`]?.bytes);
    const underlay =
      portal && complete
        ? `<g clip-path="url(#artwork-${p.index}-screen)"><g transform="scale(${captureDevice(spec.platform, p.width, p.height).width / p.width}) rotate(${-p.rotate} ${p.width / 2} ${p.height / 2}) translate(${-p.x} ${-p.y})"><image width="${W}" height="${H}" href="${uri(wallpaper)}"/></g></g>`
        : "";
    stack.push(
      (
        await phone({
          ...p,
          screenshot: complete ? shot.bytes : placeholder,
          platform: spec.platform,
          index: p.index,
          underlay,
          uiMask: portal && complete ? shot.uiMask : undefined,
        })
      ).svg,
    );
  }
  const warning = missing.length
    ? `<rect y="${H - unit * 0.07}" width="${W}" height="${unit * 0.07}" fill="#9b2929"/>${text(context.fonts, "DRAFT — MISSING INPUTS", unit * 0.035, H - unit * 0.024, unit * 0.026, "#fff", "ExtraBold", W - unit * 0.07)}`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${defs}${background}${c.svg}${stack.join("")}${warning}</svg>`;
  const png = await sharp(Buffer.from(svg))
    .flatten({ background: "#0e0e0e" })
    .toColourspace("srgb")
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  assert(png.length < 15 * 1024 * 1024, "PNG exceeds 15 MB");
  return {
    png,
    record: {
      layout: layout.id,
      aspect,
      size,
      bytes: png.length,
      sha256: hash(png),
      draft: missing.length > 0,
      missing,
      centreRestored,
      centreStrip,
      copyBox: c.box,
      phoneBounds: positions.map(phoneBounds),
    },
  };
}
async function outputFiles(folder, prefix = "") {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!prefix && entry.name === "variants") continue;
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      result.push(...(await outputFiles(join(folder, entry.name), `${name}/`)));
    else result.push(name);
  }
  return result.sort();
}
export async function main(
  args = process.argv.slice(2),
  { readSource = optional } = {},
) {
  let check = false,
    manifestOnly = false,
    allowMissing = false,
    variantsFlag = false,
    output,
    only;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check") check = true;
    else if (args[i] === "--manifest-only") manifestOnly = true;
    else if (args[i] === "--allow-missing") allowMissing = true;
    else if (args[i] === "--variants") variantsFlag = true;
    else if (args[i] === "--out") {
      output = args[++i];
      assert(output && !output.startsWith("--"), "--out needs a directory");
    } else if (args[i] === "--only") {
      only = args[++i];
      assert(slug.test(only ?? ""), "--only needs an id");
    } else throw new Error(`Unknown argument: ${args[i]}`);
  }
  assert(
    !manifestOnly || (!check && !variantsFlag && !only),
    "--manifest-only requires a full run without --check, --variants or --only",
  );
  assert(
    output,
    "Choose --out DIRECTORY for explicit exports; use /social for on-demand artwork.",
  );
  const project = await loadProject();
  const specs = project.specs.filter((s) => !only || s.id === only);
  assert(specs.length, `Unknown concept: ${only}`);
  const featureId = project.selection.featureGraphic;
  const feature = specs.find((s) => s.id === featureId);
  const android = feature ? { ...feature, platform: "android" } : null;
  const allInputs = await loadInputs(
    project,
    [...specs, ...(android ? [android] : [])],
    readSource,
  );
  if (allInputs.missing.length && !allowMissing)
    throw new Error(
      `Missing inputs:\n${allInputs.missing.join("\n")}\nUse --allow-missing for labelled drafts.`,
    );
  const context = {
    fonts: await loadFonts(ROOT),
    brand: await loadBrandInputs(),
  };
  const renderer = {};
  for (const file of [
    "scripts/artwork.mjs",
    "scripts/lib/marketing-render.mjs",
    "scripts/lib/phone-frame.mjs",
    "scripts/brand-assets.mjs",
    "app/assets/fonts/MonaSans/MonaSans-ExtraBold.ttf",
    "app/assets/fonts/MonaSans/MonaSans-Medium.ttf",
  ])
    renderer[file] = hash(await readFile(join(ROOT, file)));
  const rendererHash = hash(json(renderer));
  const generated = resolve(output),
    manifestPath = join(generated, "manifest.json");
  const savedBytes = await optional(manifestPath),
    saved = savedBytes ? JSON.parse(savedBytes) : {};
  if (!check && !manifestOnly) {
    const owned = new Map(
      [
        ...Object.values(saved.concepts ?? {}).flatMap((concept) => [
          ...(concept.outputs ?? []),
          ...Object.values(concept.variants ?? {}),
        ]),
        ...Object.values(saved.featureGraphic ?? {}),
      ].map((record) => [record.file, record.sha256]),
    );
    for (const file of await outputFiles(generated)) {
      if (file === "manifest.json" && savedBytes) continue;
      assert(
        owned.get(file) === hash(await readFile(join(generated, file))),
        `Refusing to replace unowned or edited artwork: ${file}`,
      );
    }
  }
  const manifest = {
    version: 1,
    concepts: only ? { ...saved.concepts } : {},
    featureGraphic: only ? { ...saved.featureGraphic } : {},
  };
  const staging = join(FOLDER, `.staging-${process.pid}`),
    expected = ["manifest.json"];
  const publish = async (file, png, variant = false) => {
    if (!variant) expected.push(file);
    if (check || manifestOnly)
      assert(
        (await readFile(join(generated, file))).equals(png),
        `Stale artwork: ${file}`,
      );
    else {
      await mkdir(dirname(join(staging, file)), { recursive: true });
      await writeFile(join(staging, file), png);
    }
  };
  try {
    for (const spec of specs) {
      const inputs = await loadInputs(project, [spec], readSource);
      const provenance = {
        compositionHash: project.compositions[spec.id],
        copyVersion: project.copy.version,
        copyHash: project.provenance["source/copy.json"],
        sourceHashes: inputs.hashes,
        provenanceHashes: project.provenance,
        rendererHash,
        renderer,
        brand: context.brand.hashes,
      };
      const variants = {},
        statuses = {},
        outputs = [];
      for (const layout of project.layouts.layouts) {
        statuses[layout.id] = applicability(spec, layout, project);
        if (statuses[layout.id]) continue;
        for (const aspect of Object.keys(ASPECTS)) {
          const v = await renderArtwork(
            spec,
            layout,
            aspect,
            inputs,
            project,
            context,
          );
          v.record = {
            ...provenance,
            ...v.record,
            file: `variants/${spec.id}/${layout.id}/${aspect}.png`,
          };
          variants[`${layout.id}/${aspect}`] = v;
          if (variantsFlag) await publish(v.record.file, v.png, true);
          if (project.selection[spec.id][aspect] === layout.id) {
            const file = `${spec.id}/${aspect}.png`;
            await publish(file, v.png);
            outputs.push({ ...v.record, file });
          }
        }
      }
      manifest.concepts[spec.id] = {
        outputs,
        variants: Object.fromEntries(
          Object.entries(variants).map(([key, v]) => [key, v.record]),
        ),
        layouts: statuses,
      };
      if (check)
        assert.deepEqual(
          saved.concepts?.[spec.id],
          manifest.concepts[spec.id],
          `Stale manifest: ${spec.id}`,
        );
      if (spec.id === featureId) {
        const layout = project.layouts.layouts.find(
          (l) => l.id === project.selection[featureId].wide,
        );
        for (const platform of ["ios", "android"]) {
          const platformSpec = { ...spec, platform };
          const platformInputs = await loadInputs(
            project,
            [platformSpec],
            readSource,
          );
          const v =
            platform === spec.platform
              ? variants[`${layout.id}/wide`]
              : await renderArtwork(
                  platformSpec,
                  layout,
                  "wide",
                  platformInputs,
                  project,
                  context,
                );
          const png = await sharp(v.png)
            .resize(1024, 500, { kernel: "lanczos3" })
            .removeAlpha()
            .png({ compressionLevel: 9, adaptiveFiltering: true })
            .toBuffer();
          const file = `feature-graphic/${platform}/1024x500.png`;
          await publish(file, png);
          manifest.featureGraphic[platform] = {
            ...provenance,
            sourceHashes: platformInputs.hashes,
            concept: featureId,
            platform,
            layout: layout.id,
            copyVersion: project.copy.version,
            file,
            size: [1024, 500],
            wideSha256: hash(v.png),
            sha256: hash(png),
            bytes: png.length,
            draft: v.record.draft,
            centreRestored: v.record.centreRestored,
          };
        }
      }
      console.log(
        `${spec.id}: rendered ${Object.entries(statuses)
          .filter(([, reason]) => !reason)
          .map(([id]) => id)
          .join(", ")} × wide/tall/square; n/a ${
          Object.entries(statuses)
            .filter(([, reason]) => reason)
            .map(([id]) => id)
            .join(", ") || "none"
        }`,
      );
    }
    manifest.concepts = Object.fromEntries(
      Object.entries(manifest.concepts).sort(),
    );
    for (const [file, expectedHash] of Object.entries(project.provenance))
      assert.equal(
        hash(await readFile(sourcePath(file))),
        expectedHash,
        `Artwork source changed during rendering: ${file}; retry after edits settle`,
      );
    for (const [file, expectedHash] of Object.entries(renderer))
      assert.equal(
        hash(await readFile(join(ROOT, file))),
        expectedHash,
        `Renderer changed during rendering: ${file}; format before regenerating`,
      );
    if (check) {
      if (feature)
        assert.deepEqual(
          manifest.featureGraphic,
          saved.featureGraphic,
          "Stale feature graphic manifest",
        );
      if (!only) {
        assert.equal(
          savedBytes?.toString(),
          json(manifest),
          "Stale artwork manifest",
        );
        assert.deepEqual(
          await outputFiles(generated),
          expected.sort(),
          "Unexpected generated outputs",
        );
      }
    } else if (manifestOnly) {
      assert.deepEqual(
        await outputFiles(generated),
        expected.sort(),
        "Unexpected generated outputs",
      );
      // Refresh provenance only after every retained image compares byte-for-byte.
      await writeFile(manifestPath, json(manifest));
    } else {
      await mkdir(staging, { recursive: true });
      await writeFile(join(staging, "manifest.json"), json(manifest));
      // Validate every render before replacing committed output. Manifest is last.
      for (const file of (await outputFiles(staging)).filter(
        (f) => f !== "manifest.json",
      )) {
        await mkdir(dirname(join(generated, file)), { recursive: true });
        await rename(join(staging, file), join(generated, file));
      }
      if (variantsFlag) {
        for (const spec of specs) {
          const target = join(generated, "variants", spec.id);
          await mkdir(dirname(target), { recursive: true });
          await rm(target, { recursive: true, force: true });
          await rename(join(staging, "variants", spec.id), target);
        }
      }
      if (!only)
        for (const file of await outputFiles(generated))
          if (!expected.includes(file)) await rm(join(generated, file));
      await rename(join(staging, "manifest.json"), manifestPath);
    }
  } finally {
    if (!check && !manifestOnly)
      await rm(staging, { recursive: true, force: true });
  }
  console.log(
    `${check ? "Verified" : manifestOnly ? "Refreshed manifest for" : "Generated"} ${specs.length} artwork concepts; ${allInputs.missing.length} missing inputs (labelled drafts${allowMissing ? " allowed" : ""}).`,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
