// Curated collection exports. Planning is read-only; rendering is opt-in.
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import {
  CANVAS_FORMATS,
  SCENE_PRESETS,
  createScene,
} from "../../scripts/lib/phone-frame.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function loadExportCatalog() {
  const registry = JSON.parse(
    await readFile(
      resolve(root, "press/artwork/source/screenshots.json"),
      "utf8",
    ),
  );
  const catalog = JSON.parse(
    await readFile(
      resolve(root, "press/artwork/source/screenshot-context.json"),
      "utf8",
    ),
  );
  const directory = await realpath(
    resolve(root, "press/artwork/source/screenshots/ios"),
  );
  const captures = {},
    missing = {};
  const keys = new Set([
    ...Object.keys(registry).filter((key) => key.startsWith("ios/")),
    ...catalog.collections.flatMap((collection) => collection.screenshots),
  ]);
  for (const key of keys) {
    const entry = registry[key];
    let reason;
    if (!/^ios\/[a-z0-9-]+$/.test(key))
      reason = "Only reviewed iOS capture keys are accepted";
    else if (entry?.availability === "unavailable")
      reason = entry.unavailableReason ?? "Marked unavailable";
    // Known-wrong content is withdrawn everywhere, matching the site catalog and artwork.
    else if (entry?.freshness === "stale")
      reason = entry.staleReason ?? entry.unavailableReason ?? "Marked stale";
    else if (
      !entry ||
      !/^run-[a-zA-Z0-9-]+$/.test(entry.run ?? "") ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")
    )
      reason = "No reviewed native run and SHA-256";
    else if (entry.file !== `source/screenshots/${key}.png`)
      reason = "Noncanonical capture path";
    else if (!Object.hasOwn(catalog.contexts, entry.context))
      reason = "Missing screenshot context";
    else {
      try {
        // Never follow registry paths or image symlinks outside the retained directory.
        const path = await realpath(resolve(directory, `${key.slice(4)}.png`));
        assert(
          path.startsWith(directory + sep),
          "Capture resolves outside the retained directory",
        );
        const bytes = await readFile(path);
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          entry.sha256,
          "Retained SHA-256 mismatch",
        );
        assert.equal(
          bytes.subarray(0, 8).toString("hex"),
          "89504e470d0a1a0a",
          "Not a PNG",
        );
        const capture = {
          key,
          width: bytes.readUInt32BE(16),
          height: bytes.readUInt32BE(20),
          run: entry.run,
          sha256: entry.sha256,
          context: entry.context,
        };
        createScene([capture]);
        captures[key] = capture;
      } catch (error) {
        reason =
          error.code === "ENOENT"
            ? "Registered image is not retained on disk"
            : error.message;
      }
    }
    if (reason) missing[key] = reason;
  }
  return { captures, missing, collections: catalog.collections };
}

export function planVariants(
  catalog,
  { collection, format, preset, limit } = {},
) {
  const collected = new Set(
    catalog.collections.flatMap((group) => group.screenshots),
  );
  const uncollected = Object.keys(catalog.captures).filter(
    (key) => !collected.has(key),
  );
  const groups = [...catalog.collections];
  if (uncollected.length)
    groups.push({ id: "retained-singles", screenshots: uncollected });
  assert(
    !collection || groups.some((item) => item.id === collection),
    `Unknown collection: ${collection}`,
  );
  assert(
    !format || Object.hasOwn(CANVAS_FORMATS, format),
    `Unknown canvas format: ${format}`,
  );
  assert(
    !preset || Object.hasOwn(SCENE_PRESETS, preset),
    `Unknown scene preset: ${preset}`,
  );
  assert(
    limit === undefined ||
      (Number.isInteger(Number(limit)) &&
        Number(limit) > 0 &&
        Number(limit) <= 1000),
    "--limit must be an integer from 1 to 1000",
  );
  const jobs = [],
    diagnostics = [],
    seen = new Set();
  const formats = {
    1: Object.keys(CANVAS_FORMATS),
    2: ["square", "portrait", "landscape"],
    3: ["square", "wide", "landscape"],
    4: ["wide", "landscape", "portrait"],
  };
  const preferred = {
    1: [
      "single-front",
      "single-left",
      "single-right",
      "single-top",
      "single-bottom",
      "single-diagonal-left",
      "single-diagonal-right",
      "single-flatlay",
      "single-tilt",
    ],
    2: ["duo-front", "duo-mirror", "duo-diagonal", "duo-overlap", "duo-depth"],
    3: ["triple-row", "triple-fan", "triple-steps"],
    4: [
      "quartet-grid",
      "quartet-side-by-side",
      "quartet-stagger",
      "quartet-depth",
    ],
  };
  const selectionIndices = {
    1: new Map(),
    2: new Map(),
    3: new Map(),
    4: new Map(),
  };
  for (const group of groups) {
    assert(slug.test(group.id), "Invalid collection ID");
    const selected = !collection || group.id === collection;
    const keys = [...new Set(group.screenshots)];
    for (const key of keys.filter(
      (key) => selected && !Object.hasOwn(catalog.captures, key),
    ))
      diagnostics.push(
        `${group.id}: skipped ${key}: ${catalog.missing[key] ?? "No verified retained capture"}`,
      );
    const retained = keys.filter((key) => Object.hasOwn(catalog.captures, key));
    // Extend subsets only to the right: all combinations, never permutations or fillers.
    const selections = [[]];
    const maxCount = group.id === "retained-singles" ? 1 : 4;
    for (const key of retained)
      for (const subset of [...selections])
        if (subset.length < maxCount) selections.push([...subset, key]);
    for (const screenshots of selections
      .slice(1)
      .sort((a, b) => a.length - b.length)) {
      const count = screenshots.length;
      const identity = JSON.stringify(screenshots);
      const indices = selectionIndices[count];
      if (!indices.has(identity)) indices.set(identity, indices.size);
      const index = indices.get(identity);
      if (!selected) continue;
      const [base, ...angles] = preferred[count];
      const names =
        preset || format
          ? Object.keys(SCENE_PRESETS).filter(
              (name) =>
                (!preset || name === preset) &&
                SCENE_PRESETS[name].poses.length === count,
            )
          : [
              base,
              angles[index % angles.length],
              ...(count === 1 ? [angles[(index + 1) % angles.length]] : []),
            ];
      for (const name of names) {
        const canvases = format
          ? [format]
          : count === 1 && name !== base && !preset
            ? name === "single-flatlay"
              ? ["native", "square", "wide"]
              : ["native", "portrait", "story"]
            : name === "quartet-grid"
              ? ["square", "portrait", "story"]
              : formats[count];
        for (const canvas of canvases) {
          const identity = JSON.stringify([name, canvas, screenshots]);
          if (seen.has(identity)) continue;
          seen.add(identity);
          jobs.push({
            name: `${group.id}--${screenshots.map((key) => key.slice(4)).join("--")}--${name}-${canvas}`,
            collection: group.id,
            preset: name,
            format: canvas,
            screenshots,
          });
        }
      }
    }
    if (selected && !jobs.some((job) => job.collection === group.id))
      diagnostics.push(
        `${group.id}: no count-correct variants available; collection skipped`,
      );
  }
  return {
    version: 1,
    policy: "collection-order-combinations-curated-rotation",
    jobs: limit === undefined ? jobs : jobs.slice(0, Number(limit)),
    diagnostics,
  };
}

export function parseVariantArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    assert(
      [
        "--plan",
        "--export",
        "--collection",
        "--format",
        "--preset",
        "--limit",
      ].includes(key),
      `Unknown argument: ${key}`,
    );
    assert(!Object.hasOwn(options, key), `Duplicate argument: ${key}`);
    if (key === "--plan") options[key] = true;
    else {
      assert(
        args[i + 1] && !args[i + 1].startsWith("--"),
        `${key} needs a value`,
      );
      options[key] = args[++i];
    }
  }
  assert(
    !(options["--plan"] && options["--export"]),
    "--plan and --export are mutually exclusive",
  );
  return options;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = parseVariantArgs(process.argv.slice(2));
  const plan = planVariants(await loadExportCatalog(), {
    collection: options["--collection"],
    format: options["--format"],
    preset: options["--preset"],
    limit: options["--limit"],
  });
  if (!options["--export"]) {
    for (const diagnostic of plan.diagnostics) console.error(diagnostic);
    console.log(JSON.stringify(plan, null, 2));
  } else {
    if (!plan.jobs.length)
      for (const diagnostic of plan.diagnostics) console.error(diagnostic);
    assert(
      plan.jobs.length,
      "No exportable variants matched; no build or output writes performed",
    );
    // A single invocation owns the build, browser, staging, and overwrite guards.
    // No plan files, arbitrary URLs, shell interpolation, or input paths are accepted.
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("visual.mjs", import.meta.url)),
        "--variants",
        ...process.argv.slice(2),
      ],
      { stdio: "inherit" },
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}
