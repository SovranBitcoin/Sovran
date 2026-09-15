import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  CANVAS_FORMATS,
  SCENE_PRESETS,
  createScene,
} from "../../scripts/lib/phone-frame.mjs";
import {
  loadExportCatalog,
  parseVariantArgs,
  planVariants,
} from "../scripts/variants.mjs";

const site = fileURLToPath(new URL("../", import.meta.url));

test("canvas export contract includes native and exact named sizes", () => {
  assert.deepEqual(CANVAS_FORMATS, {
    native: null,
    square: { width: 1080, height: 1080 },
    portrait: { width: 1080, height: 1350 },
    story: { width: 1080, height: 1920 },
    wide: { width: 1920, height: 1080 },
    landscape: { width: 1200, height: 630 },
  });
});

test("real catalog excludes missing P2PK and authenticates retained native inputs", async () => {
  const catalog = await loadExportCatalog();
  assert(Object.keys(catalog.captures).length > 20);
  for (const capture of Object.values(catalog.captures)) {
    assert.match(capture.key, /^ios\/[a-z0-9-]+$/);
    assert.match(capture.run, /^run-/);
    assert.match(capture.sha256, /^[a-f0-9]{64}$/);
    assert(capture.context);
    assert(capture.height > capture.width);
  }
  for (const key of [
    "ios/settings-keyring",
    "ios/receive-qr-p2pk",
    "ios/thread",
  ]) {
    assert(!Object.hasOwn(catalog.captures, key));
    assert(catalog.missing[key]);
  }
});

test("default plan is bounded, deterministic, collection-ordered, and free of repeated fillers", async () => {
  const catalog = await loadExportCatalog();
  const plan = planVariants(catalog);
  assert.deepEqual(planVariants(catalog), plan);
  // The exact set is derived from available captures below; withdrawn captures
  // shrink it, so only the manageability ceiling is a fixed number.
  assert(
    plan.jobs.length > 0 && plan.jobs.length <= 600,
    `${plan.jobs.length} variants should remain manageable`,
  );
  const expectedMulti = new Set();
  for (const group of catalog.collections) {
    const keys = [...new Set(group.screenshots)].filter(
      (key) => catalog.captures[key],
    );
    for (let mask = 1; mask < 2 ** keys.length; mask++) {
      const subset = keys.filter((_, index) => mask & (2 ** index));
      if (subset.length >= 2 && subset.length <= 4)
        expectedMulti.add(JSON.stringify(subset));
    }
  }
  assert.deepEqual(
    new Set(
      plan.jobs
        .filter((job) => job.screenshots.length > 1)
        .map((job) => JSON.stringify(job.screenshots)),
    ),
    expectedMulti,
  );
  // Each capture gets six front formats plus two angles in three formats.
  // Every multi-phone subset gets a base and a rotated preset in three formats.
  assert.equal(
    plan.jobs.length,
    Object.keys(catalog.captures).length * 12 + expectedMulti.size * 6,
  );
  for (const key of Object.keys(catalog.captures)) {
    const singles = plan.jobs.filter(
      (job) => job.screenshots.length === 1 && job.screenshots[0] === key,
    );
    assert.deepEqual(
      singles
        .filter((job) => job.preset === "single-front")
        .map((job) => job.format)
        .sort(),
      Object.keys(CANVAS_FORMATS).sort(),
      `${key} needs front coverage in every format`,
    );
    assert.equal(new Set(singles.map((job) => job.preset)).size, 3);
  }
  assert.equal(
    new Set(plan.jobs.map((job) => job.name)).size,
    plan.jobs.length,
  );
  assert.equal(
    new Set(
      plan.jobs.map((job) =>
        JSON.stringify([job.preset, job.format, job.screenshots]),
      ),
    ).size,
    plan.jobs.length,
  );
  assert.deepEqual(
    [...new Set(plan.jobs.map((job) => job.screenshots.length))].sort(),
    // Phone counts follow the collections that can actually be formed.
    [1, ...new Set([...expectedMulti].map((subset) => JSON.parse(subset).length))].sort(),
  );
  assert.deepEqual(
    [...new Set(plan.jobs.map((job) => job.format))].sort(),
    Object.keys(CANVAS_FORMATS).sort(),
  );
  assert.deepEqual(
    [
      ...new Set(
        plan.jobs
          .filter((job) => job.preset === "single-flatlay")
          .map((job) => job.format),
      ),
    ].sort(),
    ["native", "square", "wide"],
  );
  for (const job of plan.jobs) {
    assert.match(job.name, /^[a-z0-9-]+$/);
    assert.equal(
      job.screenshots.length,
      SCENE_PRESETS[job.preset].poses.length,
    );
    assert.equal(new Set(job.screenshots).size, job.screenshots.length);
    const collection = catalog.collections.find(
      (group) => group.id === job.collection,
    );
    assert(
      job.screenshots.every((key) => Object.hasOwn(catalog.captures, key)),
    );
    if (collection) {
      assert.deepEqual(
        job.screenshots,
        [...new Set(collection.screenshots)].filter((key) =>
          job.screenshots.includes(key),
        ),
      );
    } else {
      assert.equal(job.collection, "retained-singles");
      assert.equal(job.screenshots.length, 1);
      assert(
        !catalog.collections.some((group) =>
          group.screenshots.includes(job.screenshots[0]),
        ),
      );
    }
    const scene = createScene(
      job.screenshots.map((key) => catalog.captures[key]),
      { preset: job.preset },
    );
    assert(scene.width > 0 && scene.height > 0);
  }
  assert(!plan.jobs.some((job) => job.collection === "p2pk-receive"));
  assert(
    plan.diagnostics.some(
      (message) =>
        message.includes("p2pk-receive") &&
        message.includes("collection skipped"),
    ),
  );
  assert(
    plan.diagnostics.some((message) => message.includes("ios/receive-qr-p2pk")),
  );
});

test("filters select real combinations without padding undersized collections", async () => {
  const catalog = await loadExportCatalog();
  // Synthetic collections built from captures that exist, so a withdrawn or
  // recaptured screenshot cannot flip the test: one full quartet, one trio.
  const keys = Object.keys(catalog.captures).sort();
  assert(keys.length >= 4, "at least four authenticated captures");
  const quartet = keys.slice(0, 4);
  const withTest = {
    ...catalog,
    collections: [
      ...catalog.collections,
      { id: "test-quartet", title: "Quartet", description: "Four captures.", screenshots: quartet },
      { id: "test-trio", title: "Trio", description: "Three captures.", screenshots: quartet.slice(0, 3) },
    ],
  };
  const selection = {
    collection: "test-quartet",
    format: "story",
    preset: "quartet-depth",
  };
  const plan = planVariants(withTest, selection);
  assert.equal(plan.jobs.length, 1);
  assert.deepEqual(plan.jobs[0], {
    name: ["test-quartet", ...quartet.map((key) => key.split("/")[1]), "quartet-depth-story"].join("--"),
    ...selection,
    screenshots: quartet,
  });
  assert.equal(
    planVariants(withTest, { collection: "test-trio", preset: "quartet-depth" }).jobs.length,
    0,
  );
  assert.deepEqual(
    planVariants(catalog, { limit: "3" }).jobs,
    planVariants(catalog).jobs.slice(0, 3),
  );
  for (const options of [
    { collection: "../../private" },
    { format: "__proto__" },
    { preset: "constructor" },
    { preset: "custom" },
    { limit: 0 },
    { limit: -1 },
    { limit: 1.5 },
    { limit: "Infinity" },
    { limit: 1001 },
  ])
    assert.throws(() => planVariants(catalog, options));
});

test("duplicate collection members and cross-collection combinations cannot duplicate outputs", () => {
  const catalog = {
    captures: { "ios/wallet": {}, "ios/send": {} },
    missing: { "ios/absent": "Not retained" },
    collections: [
      {
        id: "one",
        screenshots: ["ios/wallet", "ios/wallet", "ios/send", "ios/absent"],
      },
      { id: "two", screenshots: ["ios/wallet", "ios/send"] },
    ],
  };
  const plan = planVariants(catalog, { format: "wide" });
  assert.equal(
    plan.jobs.length,
    Object.values(SCENE_PRESETS).reduce(
      (total, preset) =>
        total +
        (preset.poses.length === 1 ? 2 : preset.poses.length === 2 ? 1 : 0),
      0,
    ),
  );
  assert(
    plan.jobs.every(
      (job) => job.screenshots.length <= 2 && job.collection === "one",
    ),
  );
  assert(plan.diagnostics.some((message) => message.includes("ios/absent")));
  assert.deepEqual(
    planVariants(catalog).jobs,
    planVariants({ ...catalog, collections: catalog.collections.slice(0, 1) })
      .jobs,
  );
});

test("explicit filters enumerate every ordered subset through four phones with collision-free names", () => {
  const keys = ["ios/a-b", "ios/c", "ios/a", "ios/b-c", "ios/end"];
  const catalog = {
    captures: Object.fromEntries(keys.map((key) => [key, {}])),
    missing: { "ios/absent": "Not retained" },
    collections: [
      {
        id: "all",
        screenshots: [...keys.slice(0, 2), "ios/absent", ...keys.slice(2)],
      },
    ],
  };
  const expectedCounts = { 1: 5, 2: 10, 3: 10, 4: 5 };
  const all = planVariants(catalog, { format: "story" });
  assert.equal(new Set(all.jobs.map((job) => job.name)).size, all.jobs.length);
  for (const [preset, definition] of Object.entries(SCENE_PRESETS)) {
    const count = definition.poses.length;
    const selected = planVariants(catalog, {
      collection: "all",
      preset,
      format: "story",
    });
    assert.equal(selected.jobs.length, expectedCounts[count]);
    assert.deepEqual(
      selected.jobs,
      all.jobs.filter((job) => job.preset === preset),
    );
    assert.equal(
      new Set(selected.jobs.map((job) => JSON.stringify(job.screenshots))).size,
      expectedCounts[count],
    );
    for (const job of selected.jobs)
      assert.deepEqual(
        job.screenshots,
        keys.filter((key) => job.screenshots.includes(key)),
      );
    const presetOnly = planVariants(catalog, { preset });
    assert.equal(
      presetOnly.jobs.length,
      expectedCounts[count] * (count === 1 ? 6 : 3),
    );
  }
  const defaults = planVariants(catalog);
  for (const count of [1, 2, 3, 4])
    assert.equal(
      defaults.jobs.filter((job) => job.screenshots.length === count).length,
      expectedCounts[count] * (count === 1 ? 12 : 6),
    );
  assert(
    defaults.diagnostics.some((message) => message.includes("ios/absent")),
  );
});

test("bulk CLI defaults to read-only planning and accepts no manifest or arbitrary input paths", async () => {
  assert.deepEqual(parseVariantArgs([]), {});
  assert.deepEqual(parseVariantArgs(["--plan", "--limit", "2"]), {
    "--plan": true,
    "--limit": "2",
  });
  assert.deepEqual(parseVariantArgs(["--export", "/tmp/space in path"]), {
    "--export": "/tmp/space in path",
  });
  for (const args of [
    ["--export"],
    ["--plan", "--export", "out"],
    ["--plan", "--plan"],
    ["--format", "--preset", "single-front"],
    ["--manifest", "/etc/passwd"],
    ["--screenshots", "../../private"],
    ["--variants", "plan.json"],
    ["--unknown"],
  ])
    assert.throws(() => parseVariantArgs(args));
  const result = spawnSync(
    process.execPath,
    ["scripts/variants.mjs", "--plan", "--limit", "2"],
    { cwd: site, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.jobs.length, 2);
  assert.match(result.stderr, /p2pk-receive/);
});

test("exporter retains staging guards and fingerprints new format, metadata, and generator inputs", async () => {
  const source = await readFile(
    new URL("../scripts/visual.mjs", import.meta.url),
    "utf8",
  );
  for (const input of [
    "scripts/lib/phone-frame.mjs",
    "site/scripts/variants.mjs",
    "site/src/lib/phoneGeometry.ts",
    "press/artwork/source/screenshot-context.json",
    "site/src/styles/dev.css",
    "site/src/layouts/Dev.astro",
  ])
    assert(source.includes(`"${input}"`));
  assert(
    source.includes("Scene inputs changed during export; rebuild and retry"),
  );
  assert(
    source.includes("Refusing to overwrite an unrecognized or edited output"),
  );
  assert(
    source.includes("Other scenes in this destination would become stale"),
  );
  assert(
    source.indexOf("await checkPhones()") < source.indexOf("await copyFile("),
  );
  assert(source.includes("exact PNG dimensions"));
  assert(source.includes("format: job.format"));
  assert(source.includes("exports: { ...previous?.exports, ...records }"));
});

test("visual CLI rejects invalid selections before building or writing exports", async () => {
  const output = join(tmpdir(), `sovran-rejected-export-${randomUUID()}`);
  for (const [args, error] of [
    [["--format", "wide"], /requires a non-OG export/],
    [
      [
        "--export",
        "/unused-export",
        "--preset",
        "single-front",
        "--format",
        "file:\/\/private",
      ],
      /Unknown canvas format/,
    ],
    [
      ["--export", "/unused-export", "--screenshots", "../../private"],
      /Unreviewed iOS screenshot/,
    ],
    [
      ["--export", "/unused-export", "--screenshots", "ios/receive-qr-p2pk"],
      /Unreviewed iOS screenshot/,
    ],
    [
      [
        "--export",
        "/unused-export",
        "--screenshots",
        "ios/wallet",
        "--poses",
        "null",
      ],
      /must be a JSON array/,
    ],
    [
      [
        "--export",
        "/unused-export",
        "--variants",
        "--collection",
        "p2pk-receive",
      ],
      /No exportable variants matched/,
    ],
    [
      [
        "--export",
        "/unused-export",
        "--variants",
        "--screenshots",
        "ios/wallet",
      ],
      /cannot select screenshots/,
    ],
    [["--export", "/unused-export", "--frames"], /--frames cannot export/],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/visual.mjs",
        ...args.map((arg) => (arg === "/unused-export" ? output : arg)),
      ],
      { cwd: site, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert(!result.stdout.includes("Staged"));
    await assert.rejects(stat(output), { code: "ENOENT" });
  }
});
