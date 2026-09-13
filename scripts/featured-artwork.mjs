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
import {
  loadFonts,
  text,
  phone,
  brandLockup,
  hash,
  trimSystemChrome,
} from "./lib/marketing-render.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FOLDER = join(ROOT, "marketing/featured");
export const ASPECTS = {
  wide: [1920, 1080],
  tall: [1080, 1920],
  square: [1080, 1080],
};
const slug = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const themes = ["social", "payments", "ai", "mint-trust", "wallpaper"];
const fraction = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
function keys(value, allowed, where) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    `${where}: expected object`,
  );
  for (const key of Object.keys(value))
    assert(allowed.includes(key), `${where}: unknown key ${key}`);
}
function lines(value, where) {
  assert(
    Array.isArray(value) &&
      value.length <= 4 &&
      value.every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 100,
      ),
    `${where}: expected up to four nonempty lines`,
  );
}
function validateCopy(copy) {
  keys(copy, ["x", "y", "width", "headline", "subtitle"], "copy");
  for (const key of ["x", "y", "width"])
    if (copy[key] !== undefined)
      assert(
        fraction(copy[key]) && (key !== "width" || copy[key] > 0),
        `copy.${key}: fraction required`,
      );
  for (const key of ["headline", "subtitle"])
    if (copy[key] !== undefined) {
      lines(copy[key], key);
      if (key === "headline") assert(copy[key].length, "Headline required");
    }
}
export function validateComposition(spec, screenshots, wallpapers = {}) {
  keys(
    spec,
    [
      "id",
      "theme",
      "aspects",
      "headline",
      "subtitle",
      "platform",
      "background",
      "phones",
      "perAspect",
    ],
    "composition",
  );
  assert(
    typeof spec.id === "string" && slug.test(spec.id),
    "id: kebab-case required",
  );
  assert(themes.includes(spec.theme), "Unknown theme");
  assert(["ios", "android"].includes(spec.platform), "Unknown platform");
  assert(
    Array.isArray(spec.aspects) &&
      spec.aspects.length > 0 &&
      new Set(spec.aspects).size === spec.aspects.length &&
      spec.aspects.every((a) => Object.hasOwn(ASPECTS, a)),
    "Unknown or duplicate aspect",
  );
  lines(spec.headline, "headline");
  assert(spec.headline.length, "Headline required");
  lines(spec.subtitle, "subtitle");
  keys(spec.background, ["kind", "wallpaperId", "album"], "background");
  assert(
    ["brand", "wallpaper-portal", "theme-pack"].includes(spec.background.kind),
    "Unknown background",
  );
  if (spec.background.kind !== "brand")
    assert(
      Object.hasOwn(wallpapers, spec.background.wallpaperId),
      "Unknown wallpaper",
    );
  const validatePhones = (phones) => {
    assert(
      Array.isArray(phones) && phones.length >= 1 && phones.length <= 5,
      "Expected 1–5 phones",
    );
    for (const p of phones) {
      keys(
        p,
        ["screenshot", "x", "y", "width", "rotate", "depth", "mask", "scaleX"],
        "phone",
      );
      assert(
        screenshots[`${spec.platform}/${p.screenshot}`],
        `Unknown page: ${p.screenshot}`,
      );
      for (const key of ["x", "y", "width", "depth"])
        assert(
          fraction(p[key]) && (key !== "width" || p[key] > 0),
          `phone.${key}: fraction required`,
        );
      assert(
        Number.isFinite(p.rotate) && Math.abs(p.rotate) <= 30,
        "Rotation must be within 30 degrees",
      );
      assert(p.mask === "frame", "Unknown phone mask");
      if (p.scaleX !== undefined)
        assert(fraction(p.scaleX) && p.scaleX >= 0.5, "scaleX must be 0.5–1");
    }
    if (spec.background.kind === "wallpaper-portal") {
      assert(phones.length === 1, "Portal expects one phone");
      const shot = screenshots[`${spec.platform}/${phones[0].screenshot}`];
      assert.equal(
        shot.wallpaperId,
        spec.background.wallpaperId,
        "Portal screenshot wallpaper mismatch",
      );
    }
    if (spec.background.kind === "theme-pack") {
      assert(phones.length >= 3, "Theme pack expects 3–5 phones");
      const ids = phones.map(
        (p) => screenshots[`${spec.platform}/${p.screenshot}`].wallpaperId,
      );
      assert(
        new Set(ids).size === ids.length,
        "Theme pack needs different wallpapers",
      );
      assert(
        ids.every((id) => wallpapers[id]?.album === spec.background.album),
        "Theme pack album mismatch",
      );
      assert.equal(
        wallpapers[spec.background.wallpaperId].album,
        spec.background.album,
        "Hero album mismatch",
      );
    }
  };
  validatePhones(spec.phones);
  if (spec.perAspect !== undefined) {
    keys(spec.perAspect, spec.aspects, "perAspect");
    for (const value of Object.values(spec.perAspect)) {
      keys(value, ["copy", "phones"], "aspect override");
      if (value.copy !== undefined) validateCopy(value.copy);
      if (value.phones !== undefined) validatePhones(value.phones);
    }
  }
  return spec;
}
const relativeSource = (file) => {
  assert(
    typeof file === "string" &&
      /^source\/[a-zA-Z0-9/._-]+$/.test(file) &&
      !file.split("/").includes(".."),
    `Invalid source path: ${file}`,
  );
  return join(FOLDER, file);
};
async function readOptional(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function loadProject() {
  const shotsBytes = await readFile(join(FOLDER, "source/screenshots.json"));
  const wallpapersBytes = await readFile(
    join(FOLDER, "source/wallpapers.json"),
  );
  const screenshots = JSON.parse(shotsBytes),
    wallpapers = JSON.parse(wallpapersBytes);
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
    assert.equal(
      shot.file,
      `source/screenshots/${key}.png`,
      "Screenshot path must follow its key",
    );
  }
  const specs = [];
  for (const file of (await readdir(join(FOLDER, "source/compositions")))
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const bytes = await readFile(join(FOLDER, "source/compositions", file));
    const spec = validateComposition(
      JSON.parse(bytes),
      screenshots,
      wallpapers,
    );
    assert.equal(file, `${spec.id}.json`, "Composition filename must match id");
    specs.push({ spec, sha256: hash(bytes) });
  }
  return {
    screenshots,
    wallpapers,
    specs,
    sourceHashes: {
      screenshots: hash(shotsBytes),
      wallpapers: hash(wallpapersBytes),
    },
  };
}
// Load and authenticate every selected input before writing any output. Missing is
// different from corrupt: --allow-missing never tolerates changed source bytes.
export async function loadInputs(project, specs) {
  const missing = new Set(),
    shots = {},
    wallpapers = {},
    hashes = {};
  const readHashed = async (entry, label) => {
    const bytes = await readOptional(relativeSource(entry.file));
    if (!bytes) {
      missing.add(entry.file);
      return null;
    }
    assert(
      /^[a-f0-9]{64}$/.test(entry.sha256 ?? ""),
      `Missing SHA-256: ${label}`,
    );
    assert.equal(hash(bytes), entry.sha256, `Source hash mismatch: ${label}`);
    hashes[entry.file] = entry.sha256;
    return bytes;
  };
  for (const { spec } of specs) {
    if (spec.background.kind !== "brand") {
      const id = spec.background.wallpaperId;
      wallpapers[id] = await readHashed(project.wallpapers[id], id);
    }
    for (const p of [
      ...spec.phones,
      ...Object.values(spec.perAspect ?? {}).flatMap((a) => a.phones ?? []),
    ]) {
      const key = `${spec.platform}/${p.screenshot}`,
        entry = project.screenshots[key];
      if (!Object.hasOwn(shots, key)) {
        const bytes = await readHashed(entry, key);
        if (bytes)
          assert(
            typeof entry.run === "string" && entry.run.startsWith("run-"),
            `Missing run ID: ${key}`,
          );
        shots[key] = { bytes, uiMask: null };
      }
      if (spec.background.kind === "wallpaper-portal") {
        if (!entry.uiMask)
          missing.add(`UI mask for ${key} (screenshots.json uiMask)`);
        else
          shots[key].uiMask = await readHashed(entry.uiMask, `${key} UI mask`);
      }
    }
  }
  return {
    missing: [...missing].sort(),
    shots,
    wallpapers,
    hashes: Object.fromEntries(Object.entries(hashes).sort()),
  };
}
const uri = (bytes) => `data:image/png;base64,${bytes.toString("base64")}`;
const defs = `<defs>
 <radialGradient id="spot"><stop stop-color="#282828"/><stop offset="1" stop-color="#0e0e0e"/></radialGradient>
 <linearGradient id="rim" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity=".02"/></linearGradient>
 <filter id="shadow" x="-40%" y="-30%" width="180%" height="170%"><feGaussianBlur stdDeviation="16"/><feOffset dx="-14" dy="18"/></filter>
 </defs>`;
export async function renderArtwork(
  spec,
  aspect,
  inputs,
  context,
  size = ASPECTS[aspect],
) {
  const [W, H] = size,
    unit = Math.min(W, H),
    overrides = spec.perAspect?.[aspect] ?? {};
  const phones = overrides.phones ?? spec.phones;
  const c = { x: 0.07, y: 0.2, width: 0.42, ...overrides.copy };
  const headline = c.headline ?? spec.headline,
    subtitle = c.subtitle ?? spec.subtitle;
  let background = '<rect width="100%" height="100%" fill="url(#spot)"/>',
    wallpaper;
  if (inputs.wallpapers[spec.background.wallpaperId]) {
    wallpaper = await sharp(inputs.wallpapers[spec.background.wallpaperId])
      .resize(W, H, { fit: "cover" })
      .png()
      .toBuffer();
    const blurred = await sharp(wallpaper)
      .blur(24)
      .modulate({ brightness: 0.65 })
      .png()
      .toBuffer();
    background = `<image width="${W}" height="${H}" href="${uri(blurred)}"/>`;
  }
  const { ink, logoScale, logoWidth, logoHeight, logo } = await brandLockup(
    context.brand,
    unit * 0.049,
  );
  const copy = [
    `<image x="${c.x * W - ink.x * logoScale}" y="${c.y * H - ink.y * logoScale}" width="${logoWidth}" height="${logoHeight}" href="${uri(logo)}"/>`,
  ];
  const longest = Math.max(
    ...headline.map((line) =>
      context.fonts.ExtraBold.getAdvanceWidth(line, unit * 0.061, {
        kerning: true,
      }),
    ),
  );
  const fontSize = unit * 0.061 * Math.min(1, (c.width * W) / longest);
  let baseline = c.y * H + unit * 0.14;
  for (const line of headline) {
    copy.push(
      text(
        context.fonts,
        line,
        c.x * W,
        baseline,
        fontSize,
        "#fff",
        "ExtraBold",
        c.width * W + 0.01,
      ),
    );
    baseline += fontSize * 1.13;
  }
  baseline += unit * 0.027;
  for (const line of subtitle) {
    copy.push(
      text(
        context.fonts,
        line,
        c.x * W,
        baseline,
        unit * 0.022,
        "#c5c5c5",
        "Medium",
        c.width * W,
      ),
    );
    baseline += unit * 0.03;
  }
  const stack = [],
    missing = [];
  for (const [index, p] of [...phones]
    .sort((a, b) => a.depth - b.depth)
    .entries()) {
    const key = `${spec.platform}/${p.screenshot}`,
      shot = inputs.shots[key];
    const portal = spec.background.kind === "wallpaper-portal";
    const incomplete =
      !shot?.bytes ||
      (spec.background.kind !== "brand" && !wallpaper) ||
      (portal && !shot.uiMask);
    let screenshot = shot?.bytes;
    if (incomplete) {
      missing.push(key);
      screenshot = await sharp({
        create: { width: 360, height: 780, channels: 3, background: "#242424" },
      })
        .png()
        .toBuffer();
    }
    // Undo the phone transform on the wallpaper only. Thus the sharp wallpaper
    // uses exactly the background's canvas crop/scale even for rotated phones.
    const meta = await sharp(screenshot).metadata();
    const trim = trimSystemChrome(spec.platform);
    const w = p.width * W,
      h =
        ((meta.height -
          Math.round(meta.height * trim.top) -
          Math.round(meta.height * trim.bottom)) /
          meta.width) *
        w;
    const underlay =
      portal && !incomplete
        ? `<g clip-path="url(#screen${index})"><g transform="scale(${1 / (p.scaleX ?? 1)} 1) rotate(${-p.rotate} ${w / 2} ${h / 2}) translate(${-p.x * W} ${-p.y * H})"><image width="${W}" height="${H}" href="${uri(wallpaper)}"/></g></g>`
        : "";
    const rendered = await phone({
      ...p,
      screenshot,
      platform: spec.platform,
      x: p.x * W,
      y: p.y * H,
      width: w,
      index,
      underlay,
      uiMask: portal && !incomplete ? shot.uiMask : undefined,
    });
    stack.push(rendered.svg);
  }
  // Draft warning is last so phones cannot cover it; never resembles a capture.
  const warning = missing.length
    ? `<rect y="${H - unit * 0.07}" width="${W}" height="${unit * 0.07}" fill="#9b2929"/>${text(context.fonts, "DRAFT — MISSING INPUTS", unit * 0.035, H - unit * 0.024, unit * 0.026, "#fff", "ExtraBold", W - unit * 0.07)}`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${defs}${background}${copy.join("")}${stack.join("")}${warning}</svg>`;
  const png = await sharp(Buffer.from(svg))
    .flatten({ background: "#0e0e0e" })
    .toColourspace("srgb")
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const metadata = await sharp(png).metadata();
  assert(
    metadata.width === W &&
      metadata.height === H &&
      metadata.channels === 3 &&
      !metadata.hasAlpha,
    "Expected opaque RGB",
  );
  assert(png.length < 15 * 1024 * 1024, "PNG exceeds 15 MB");
  return {
    png,
    record: {
      file: `${spec.id}/${aspect}.png`,
      size: [W, H],
      bytes: png.length,
      sha256: hash(png),
      draft: missing.length > 0,
    },
  };
}
export async function main(args = process.argv.slice(2)) {
  let check = false,
    allowMissing = false,
    skipMissing = false,
    only;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check") check = true;
    else if (args[i] === "--allow-missing") allowMissing = true;
    else if (args[i] === "--skip-missing") skipMissing = true;
    else if (args[i] === "--only") {
      only = args[++i];
      assert(slug.test(only ?? ""), "--only needs an id");
    } else throw new Error(`Unknown argument: ${args[i]}`);
  }
  assert(
    !(allowMissing && skipMissing),
    "Choose --allow-missing or --skip-missing",
  );
  const project = await loadProject();
  const selected = project.specs.filter(
    ({ spec }) => !only || spec.id === only,
  );
  assert(selected.length, `Unknown composition: ${only}`);
  const inputs = await loadInputs(project, selected);
  if (inputs.missing.length) {
    const message = `Missing inputs (${inputs.missing.length}):\n${inputs.missing.map((f) => `  ${f}`).join("\n")}`;
    if (skipMissing) {
      console.log(`Skipped featured artwork: ${message}`);
      return;
    }
    if (!allowMissing)
      throw new Error(
        `${message}\nCapture the marketing suite, retain provenance, then regenerate. Use --allow-missing for visibly marked development drafts.`,
      );
    console.log(message);
  }
  const context = {
    brand: await loadBrandInputs(),
    fonts: await loadFonts(ROOT),
  };
  const rendererFiles = [
    "scripts/featured-artwork.mjs",
    "scripts/lib/marketing-render.mjs",
    "scripts/brand-assets.mjs",
    "app/assets/fonts/MonaSans/MonaSans-ExtraBold.ttf",
    "app/assets/fonts/MonaSans/MonaSans-Medium.ttf",
  ];
  const rendererHashes = {};
  for (const file of rendererFiles)
    rendererHashes[file] = hash(await readFile(join(ROOT, file)));
  const entries = {};
  for (const { spec, sha256 } of selected) {
    const perInputs = await loadInputs(project, [{ spec }]);
    const outputs = [];
    for (const aspect of spec.aspects)
      outputs.push(await renderArtwork(spec, aspect, inputs, context));
    entries[spec.id] = {
      composition: sha256,
      sources: perInputs.hashes,
      provenance: project.sourceHashes,
      missing: perInputs.missing,
      renderer: rendererHashes,
      brand: context.brand.hashes,
      outputs: outputs.map((o) => o.record),
    };
    entries[spec.id]._rendered = outputs;
  }
  const manifestPath = join(FOLDER, "generated/manifest.json");
  const savedBytes = await readOptional(manifestPath);
  const saved = savedBytes
    ? JSON.parse(savedBytes)
    : { version: 1, compositions: {} };
  // --only updates/verifies just one entry; it neither erases nor blesses others.
  const manifest = {
    version: 1,
    compositions: only ? { ...saved.compositions } : {},
  };
  for (const [id, entry] of Object.entries(entries)) {
    const { _rendered, ...record } = entry;
    manifest.compositions[id] = record;
    if (check) {
      assert.deepEqual(saved.compositions[id], record, `Stale manifest: ${id}`);
      for (const output of _rendered)
        assert(
          (
            await readFile(join(FOLDER, "generated", output.record.file))
          ).equals(output.png),
          `Stale artwork: ${output.record.file}`,
        );
    }
  }
  manifest.compositions = Object.fromEntries(
    Object.entries(manifest.compositions).sort(),
  );
  const serialized = JSON.stringify(manifest, null, 2) + "\n";
  if (check && !only)
    assert.equal(savedBytes?.toString(), serialized, "Stale featured manifest");
  if (!check) {
    const staging = join(FOLDER, `.staging-${process.pid}`);
    try {
      await mkdir(staging, { recursive: true });
      for (const [id, entry] of Object.entries(entries)) {
        await mkdir(join(staging, id));
        for (const output of entry._rendered)
          await writeFile(join(staging, output.record.file), output.png);
      }
      await mkdir(join(FOLDER, "generated"), { recursive: true });
      for (const [id, entry] of Object.entries(entries)) {
        await mkdir(join(FOLDER, "generated", id), { recursive: true });
        for (const output of entry._rendered)
          await rename(
            join(staging, output.record.file),
            join(FOLDER, "generated", output.record.file),
          );
      }
      await writeFile(join(staging, "manifest.json"), serialized);
      await rename(join(staging, "manifest.json"), manifestPath);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  console.log(
    `${check ? "Verified" : "Generated"} ${selected.length} featured compositions (opaque RGB PNG, wide/tall/square; ${inputs.missing.length} missing inputs).`,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
