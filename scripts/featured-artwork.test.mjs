import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
  ROOT,
  loadProject,
  loadInputs,
  validateComposition,
  renderArtwork,
  main,
} from "./featured-artwork.mjs";
import { loadFonts, hash, trimSystemChrome } from "./lib/marketing-render.mjs";
import { loadBrandInputs } from "./brand-assets.mjs";

const project = await loadProject();
const spec = project.specs.find(({ spec }) => spec.id === "ai-chat").spec;
const context = {
  fonts: await loadFonts(ROOT),
  brand: await loadBrandInputs(),
};
const inputs = await loadInputs(project, [{ spec }]);
const validate = (value) =>
  validateComposition(value, project.screenshots, project.wallpapers);

test("all 14 compositions validate, with three independently designed aspects", () => {
  assert(project.specs.length >= 14);
  for (const { spec } of project.specs) {
    validate(spec);
    assert.equal(spec.aspects.length, 3);
  }
});

test("validator rejects unknown pages, fields, unsafe IDs, fractions, masks and incomplete overrides", () => {
  for (const change of [
    { id: "../bad" },
    { id: undefined },
    { aspects: ["toString"] },
    { perAspect: null },
    { perAspect: { tall: { copy: { headline: null } } } },
    { theme: "unknown" },
    { aspects: ["panorama"] },
    { extra: true },
    { headline: [] },
    { perAspect: { tall: { copy: { x: 2 } } } },
    { perAspect: { square: { phones: [] } } },
  ]) {
    assert.throws(() => validate({ ...spec, ...change }));
  }
  for (const change of [
    { screenshot: "unknown" },
    { width: 0 },
    { x: -0.1 },
    { y: 1.1 },
    { depth: NaN },
    { rotate: 45 },
    { mask: "other" },
    { scaleX: 0.1 },
  ]) {
    assert.throws(() =>
      validate({ ...spec, phones: [{ ...spec.phones[0], ...change }] }),
    );
  }
});

test("portal and theme packs enforce wallpaper provenance and album membership", () => {
  const portal = project.specs.find(
    ({ spec }) => spec.id === "portal-wallet",
  ).spec;
  assert.throws(
    () => validate({ ...portal, phones: spec.phones }),
    /wallpaper mismatch/,
  );
  const pack = project.specs.find(
    ({ spec }) => spec.id === "theme-pack-colors",
  ).spec;
  assert.throws(
    () =>
      validate({
        ...pack,
        phones: [pack.phones[0], pack.phones[0], pack.phones[0]],
      }),
    /different wallpapers/,
  );
  assert.throws(
    () =>
      validate({ ...pack, background: { ...pack.background, album: "other" } }),
    /album mismatch/,
  );
});

test("two real-screenshot renders have identical PNG and manifest hashes for each aspect", async () => {
  for (const [aspect, size] of Object.entries({
    wide: [320, 180],
    tall: [180, 320],
    square: [180, 180],
  })) {
    const first = await renderArtwork(spec, aspect, inputs, context, size);
    const second = await renderArtwork(spec, aspect, inputs, context, size);
    assert.deepEqual(first.record, second.record);
    assert(first.png.equals(second.png));
    const meta = await sharp(first.png).metadata();
    assert.equal(meta.channels, 3);
    assert.equal(meta.hasAlpha, false);
    assert.equal(first.record.draft, false);
    assert(first.record.bytes < 15 * 1024 * 1024);
  }
});

test("missing sources fail strict checks; dev drafts cannot masquerade as complete", async () => {
  await assert.rejects(
    () => main(["--check", "--only", "social-thread"]),
    /Missing inputs/,
  );
  const draft = await renderArtwork(
    spec,
    "wide",
    { ...inputs, shots: {} },
    context,
    [320, 180],
  );
  assert.equal(draft.record.draft, true);
  assert.notEqual(
    draft.record.sha256,
    (await renderArtwork(spec, "wide", inputs, context, [320, 180])).record
      .sha256,
  );
});

test("source corruption is never tolerated as a missing input", async () => {
  const screenshots = structuredClone(project.screenshots);
  screenshots["ios/ai"].sha256 = "0".repeat(64);
  await assert.rejects(
    () => loadInputs({ ...project, screenshots }, [{ spec }]),
    /hash mismatch/,
  );
});

test("retained screenshots preserve the original native store bytes and run IDs", async () => {
  const original = JSON.parse(
    await readFile(
      join(ROOT, "marketing/feature-graphic/source/composition.json"),
    ),
  );
  for (const [platform, data] of Object.entries(original.platforms)) {
    for (const source of data.screenshots) {
      const page = source.file
        .split("/")
        .at(-1)
        .replace(".png", "")
        .replace("ai-chat", "ai");
      const retained = project.screenshots[`${platform}/${page}`];
      assert.equal(retained.run, data.run);
      assert.equal(
        hash(await readFile(join(ROOT, "marketing/featured", retained.file))),
        source.sha256,
      );
    }
  }
  assert.deepEqual(trimSystemChrome("ios"), { top: 0.054, bottom: 0.018 });
  assert.throws(() => trimSystemChrome("other"));
});

test("portal reveals the same sharp canvas wallpaper through the rotated screen mask", async () => {
  const portal = project.specs.find(
    ({ spec }) => spec.id === "portal-wallet",
  ).spec;
  const wallpaper = await readFile(
    join(ROOT, "marketing/featured/source/wallpapers/navy.svg"),
  );
  const screenshot = inputs.shots["ios/ai"].bytes;
  const meta = await sharp(screenshot).metadata();
  const uiMask = await sharp({
    create: {
      width: meta.width,
      height: meta.height,
      channels: 3,
      background: "#000",
    },
  })
    .png()
    .toBuffer();
  const changed = {
    ...portal,
    phones: [
      {
        ...portal.phones[0],
        x: 0.6,
        y: 0.15,
        width: 0.25,
        rotate: 8,
        scaleX: 0.9,
      },
    ],
  };
  const rendered = await renderArtwork(
    changed,
    "wide",
    {
      shots: { "ios/wallet-navy": { bytes: screenshot, uiMask } },
      wallpapers: { navy: wallpaper },
    },
    context,
    [640, 360],
  );
  assert.equal(rendered.record.draft, false);
  const canvas = await sharp(wallpaper)
    .resize(640, 360, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const pixels = await sharp(rendered.png).raw().toBuffer();
  // Well inside the phone, away from copy, clipped edges and rim.
  for (const [x, y] of [
    [450, 150],
    [460, 180],
    [445, 220],
  ]) {
    const i = (y * 640 + x) * 3;
    for (let c = 0; c < 3; c++)
      assert(
        Math.abs(pixels[i + c] - canvas[i + c]) <= 1,
        `Portal drift at ${x},${y},${c}: ${pixels[i + c]} != ${canvas[i + c]}`,
      );
  }
});
