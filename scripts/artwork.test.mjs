import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
  ROOT,
  FOLDER,
  ASPECTS,
  loadProject,
  loadInputs,
  validateLayouts,
  validateSelection,
  applicability,
  renderArtwork,
  assertNoCollision,
  restoreCentre,
  portalCanvas,
  main,
} from "./artwork.mjs";
import { loadFonts, hash, phone } from "./lib/marketing-render.mjs";
import { loadBrandInputs } from "./brand-assets.mjs";

const project = await loadProject();
const context = {
  fonts: await loadFonts(ROOT),
  brand: await loadBrandInputs(),
};
const spec = project.specs.find((s) => s.id === "ai-chat");
const layout = project.layouts.layouts.find((l) => l.id === "spotlight");
const inputs = await loadInputs(project, [spec]);

test("19 concepts share all eight described layouts and three exact aspect ratios", () => {
  assert.equal(project.specs.length, 19);
  validateLayouts(project.layouts);
  for (const s of project.specs) assert.equal(s.layouts.length, 8);
  assert.deepEqual(ASPECTS.wide, [2048, 1000]);
  assert.equal(project.selection.featureGraphic, "app-overview");
});

test("layout catalog rejects duplicate IDs, wrong counts, unknown copy blocks and missing aspects", () => {
  for (const mutate of [
    (c) => c.layouts.push(c.layouts[0]),
    (c) => (c.layouts[0].id = "unknown"),
    (c) => (c.layouts[0].phones.min = 1),
    (c) => (c.layouts[1].description = ""),
    (c) => (c.layouts[1].copyBlock.wide = "behind phone"),
    (c) => delete c.layouts[1].copyBlock.tall,
    (c) => (c.aspects.wide = [1920, 1080]),
  ]) {
    const catalog = structuredClone(project.layouts);
    mutate(catalog);
    assert.throws(() => validateLayouts(catalog));
  }
});

test("selection rejects unknown concepts/layouts, missing aspects and inapplicable choices", () => {
  validateSelection(project);
  for (const mutate of [
    (s) => (s.featureGraphic = "unknown"),
    (s) => (s.wallet.wide = "unknown"),
    (s) => (s.wallet.wide = "pack"),
    (s) => (s.wallet.wide = "portal"),
    (s) => delete s.wallet.tall,
    (s) => (s.extra = s.wallet),
  ]) {
    const selection = structuredClone(project.selection);
    mutate(selection);
    assert.throws(() => validateSelection({ ...project, selection }));
  }
});

test("packs require distinct same-album wallpaper captures; missing bytes stay applicable drafts", () => {
  const pack = project.layouts.layouts.find((l) => l.id === "pack");
  const artemis = project.specs.find((s) => s.id === "themes-artemis");
  assert.equal(applicability(artemis, pack, project), null);
  assert.match(applicability(spec, pack, project), /Needs 3 phones/);
  assert.match(
    applicability(
      { ...artemis, screenshots: Array(3).fill("wallet-in-eclipse") },
      pack,
      project,
    ),
    /different wallpapers/,
  );
  assert.match(
    applicability(
      { ...artemis, background: { ...artemis.background, album: "wrong" } },
      pack,
      project,
    ),
    /one album/,
  );
});

test("two real-screenshot renders have identical bytes and records in every aspect", async () => {
  for (const [aspect, size] of Object.entries({
    wide: [512, 250],
    tall: [270, 480],
    square: [270, 270],
  })) {
    const a = await renderArtwork(
      spec,
      layout,
      aspect,
      inputs,
      project,
      context,
      size,
    );
    const b = await renderArtwork(
      spec,
      layout,
      aspect,
      inputs,
      project,
      context,
      size,
    );
    assert(a.png.equals(b.png));
    assert.deepEqual(a.record, b.record);
    assert.equal(a.record.draft, false);
    const meta = await sharp(a.png).metadata();
    assert.equal(meta.channels, 3);
    assert.equal(meta.hasAlpha, false);
    assert.equal(meta.width, size[0]);
    assert.equal(meta.height, size[1]);
  }
});

test("copy collision guard includes the rotated bezel, not only the unrotated screen", () => {
  const copy = { x: 0, y: 0, width: 90, height: 200 };
  const p = { x: 120, y: 0, width: 100, height: 240, rotate: 0 };
  assertNoCollision(copy, [p]);
  assert.throws(
    () => assertNoCollision(copy, [{ ...p, rotate: 30 }]),
    /collides/,
  );
});

test("missing sources fail strict checks, including missing masks on unselected portal variants", async () => {
  await assert.rejects(
    () => main(["--check", "--only", "social-thread"]),
    /Missing inputs/,
  );
  await assert.rejects(
    () => main(["--check", "--only", "themes-colors"]),
    /UI mask/,
  );
  const draft = await renderArtwork(
    spec,
    layout,
    "wide",
    { ...inputs, shots: {} },
    project,
    context,
    [512, 250],
  );
  assert.equal(draft.record.draft, true);
  assert(draft.record.missing.includes("ios/ai"));
  assert.notEqual(
    draft.record.sha256,
    (
      await renderArtwork(
        spec,
        layout,
        "wide",
        inputs,
        project,
        context,
        [512, 250],
      )
    ).record.sha256,
  );
});

test("source corruption is never tolerated as a missing input", async () => {
  const screenshots = structuredClone(project.screenshots);
  screenshots["ios/ai"].sha256 = "0".repeat(64);
  await assert.rejects(
    () => loadInputs({ ...project, screenshots }, [spec]),
    /hash mismatch/,
  );
  screenshots["ios/ai"].sha256 = project.screenshots["ios/ai"].sha256;
  screenshots["ios/ai"].run = null;
  await assert.rejects(
    () => loadInputs({ ...project, screenshots }, [spec]),
    /Missing run ID/,
  );
});

test("retained screenshots preserve the eight original native store bytes and run IDs", async () => {
  const pins = JSON.parse(
    await readFile(join(ROOT, "scripts/fixtures/artwork-store-pins.json")),
  );
  let count = 0;
  for (const [platform, data] of Object.entries(pins))
    for (const source of data.screenshots) {
      const key = source.file
        .split("/")
        .at(-1)
        .replace(".png", "")
        .replace("ai-chat", "ai");
      const retained = project.screenshots[`${platform}/${key}`];
      assert.equal(retained.run, data.run);
      assert.equal(retained.sha256, source.sha256);
      assert.equal(
        hash(await readFile(join(FOLDER, retained.file))),
        source.sha256,
      );
      count++;
    }
  assert.equal(count, 8);
});

test("phone embeds the full original native capture and keeps status-bar/home-indicator geometry", async () => {
  for (const platform of ["ios", "android"]) {
    const bytes = await readFile(
      join(FOLDER, project.screenshots[`${platform}/wallet`].file),
    );
    const meta = await sharp(bytes).metadata();
    const rendered = await phone({
      screenshot: bytes,
      platform,
      x: 0,
      y: 0,
      width: 320,
    });
    assert.equal(rendered.height, (meta.height / meta.width) * 320);
    const embedded = rendered.svg.match(/base64,([^\"]+)/)[1];
    assert(Buffer.from(embedded, "base64").equals(bytes));
  }
});

test("all 13 portraits and supplied panoramas authenticate against the retained provenance", async () => {
  assert.equal(project.catalog.wallpapers.length, 13);
  for (const entry of project.catalog.wallpapers) {
    const portrait = await readFile(
      join(FOLDER, `source/wallpapers/${entry.themeName}.jpg`),
    );
    const panorama = await readFile(
      join(FOLDER, `source/wallpapers-wide/${entry.themeName}.jpg`),
    );
    assert.equal(hash(portrait), entry.sha256);
    assert.equal(hash(panorama), project.wide[entry.themeName].sha256);
    const meta = await sharp(panorama).metadata();
    assert.equal(meta.width / meta.height, 2);
    assert.equal(meta.width, project.wide[entry.themeName].width);
    assert.equal(meta.height, project.wide[entry.themeName].height);
  }
});

test("restored wide centre strips match original portraits below 2/255 mean error at 128 px", async () => {
  for (const entry of project.catalog.wallpapers) {
    const portrait = await readFile(
      join(FOLDER, `source/wallpapers/${entry.themeName}.jpg`),
    );
    const wide = await readFile(
      join(FOLDER, `source/wallpapers-wide/${entry.themeName}.jpg`),
    );
    const meta = await sharp(wide).metadata();
    const p = await sharp(portrait).metadata();
    const width = Math.round((p.width / p.height) * meta.height);
    const restored = await restoreCentre(portrait, wide);
    const actual = await sharp(restored)
      .extract({
        left: Math.round((meta.width - width) / 2),
        top: 0,
        width,
        height: meta.height,
      })
      .resize({ width: 128 })
      .removeAlpha()
      .raw()
      .toBuffer();
    const expected = await sharp(portrait)
      .resize({ height: meta.height })
      .resize({ width: 128 })
      .removeAlpha()
      .raw()
      .toBuffer();
    assert.equal(actual.length, expected.length);
    const error =
      actual.reduce((sum, v, i) => sum + Math.abs(v - expected[i]), 0) /
      actual.length /
      255;
    assert(error < 2 / 255, `${entry.themeName}: mean error ${error}`);
  }
});

test("portal preserves sharp canvas alignment through the full-size UI mask", async () => {
  const portal = project.specs.find((s) => s.id === "portal-artemis");
  const portalLayout = project.layouts.layouts.find((l) => l.id === "portal");
  const source = await loadInputs(project, [portal]);
  const bytes = inputs.shots["ios/ai"].bytes;
  const meta = await sharp(bytes).metadata();
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
  const controlled = {
    ...source,
    shots: { "ios/wallet-in-eclipse": { bytes, uiMask } },
  };
  const rendered = await renderArtwork(
    portal,
    portalLayout,
    "wide",
    controlled,
    project,
    context,
    [512, 250],
  );
  assert.equal(rendered.record.draft, false);
  assert.equal(rendered.record.centreRestored, true);
  const restored = await restoreCentre(
    source.wallpapers["in-eclipse"],
    source.wide["in-eclipse"],
  );
  const bounds = rendered.record.phoneBounds[0];
  // Portal has no rotation; remove the shared bezel from its frame bounds.
  const screenWidth = bounds.width / 1.06;
  const position = {
    x: bounds.x + (bounds.width - screenWidth) / 2,
    width: screenWidth,
  };
  assert(position.x >= rendered.record.centreStrip.x - 1);
  assert(
    position.x + position.width <=
      rendered.record.centreStrip.x + rendered.record.centreStrip.width + 1,
  );
  const canvas = await portalCanvas(
    restored,
    source.wallpapers["in-eclipse"],
    [512, 250],
    position,
  );
  const expected = await sharp(canvas.png).removeAlpha().raw().toBuffer();
  const actual = await sharp(rendered.png).raw().toBuffer();
  const b = rendered.record.phoneBounds[0];
  for (const fraction of [0.35, 0.5, 0.65]) {
    const x = Math.round(b.x + b.width / 2),
      y = Math.round(b.y + b.height * fraction),
      i = (y * 512 + x) * 3;
    for (let c = 0; c < 3; c++)
      assert(
        Math.abs(actual[i + c] - expected[i + c]) <= 1,
        `Portal drift at ${x},${y}`,
      );
  }
  const tall = await renderArtwork(
    portal,
    portalLayout,
    "tall",
    controlled,
    project,
    context,
    [270, 480],
  );
  assert.equal(tall.record.centreRestored, false);
});

test("feature graphic is a plain Lanczos downscale of the selected platform wide render", async () => {
  const overview = project.specs.find(
    (s) => s.id === project.selection.featureGraphic,
  );
  const selected = project.layouts.layouts.find(
    (l) => l.id === project.selection[overview.id].wide,
  );
  for (const platform of ["ios", "android"]) {
    const s = { ...overview, platform };
    const source = await loadInputs(project, [s]);
    const wide = await renderArtwork(
      s,
      selected,
      "wide",
      source,
      project,
      context,
    );
    const downscaled = await sharp(wide.png)
      .resize(1024, 500, { kernel: "lanczos3" })
      .removeAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    assert(
      (
        await readFile(
          join(FOLDER, `generated/feature-graphic/${platform}/1024x500.png`),
        )
      ).equals(downscaled),
    );
  }
});
