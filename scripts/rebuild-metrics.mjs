#!/usr/bin/env node
/**
 * First-principles rebuild size & dependency ratchet.
 *
 * Usage:
 *   node scripts/rebuild-metrics.mjs           # print current metrics + deltas vs baseline
 *   node scripts/rebuild-metrics.mjs --check   # exit 1 if any ratcheted metric regressed
 *   node scripts/rebuild-metrics.mjs --write   # record current metrics as the baseline
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASELINE_PATH = join(ROOT, "docs/architecture/rebuild-baseline.json");

const IGNORED_DIRS = new Set([
  "node_modules",
  "__tests__",
  "__mocks__",
  "dist",
  ".expo",
  "ios",
  "android",
  "build",
]);

const APP_NON_RUNTIME_DIRS = new Set(["scripts", "codereview", "e2e"]);

function walkRuntimeSource(dir, out = [], extraIgnored = new Set()) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name) || extraIgnored.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRuntimeSource(full, out, extraIgnored);
    } else if (
      /\.(ts|tsx|js|jsx)$/.test(entry.name) &&
      !/\.(test|spec)\./.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

function countLoc(files) {
  let total = 0;
  for (const file of files) {
    total += readFileSync(file, "utf8").split("\n").length;
  }
  return total;
}

function countMatchingFiles(files, pattern) {
  let count = 0;
  for (const file of files) {
    if (pattern.test(readFileSync(file, "utf8"))) count += 1;
  }
  return count;
}

function countFlowGroups() {
  const appRoutes = join(ROOT, "app/app");
  if (!existsSync(appRoutes)) return 0;
  return readdirSync(appRoutes, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && /^\(.+-flow\)$/.test(entry.name),
  ).length;
}

function countDeps(pkgPath) {
  if (!existsSync(pkgPath)) return 0;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return Object.keys(pkg.dependencies ?? {}).length;
}

function collectMetrics() {
  const appFiles = walkRuntimeSource(
    join(ROOT, "app"),
    [],
    APP_NON_RUNTIME_DIRS,
  );
  const walletFiles = walkRuntimeSource(join(ROOT, "wallet/src"));
  const nostrFiles = walkRuntimeSource(join(ROOT, "nostr/src"));
  const routeFiles = walkRuntimeSource(join(ROOT, "app/app"));
  const allRuntime = [...appFiles, ...walletFiles, ...nostrFiles];
  // A provider file is any app file named `*Provider`, wherever it lives, and
  // every component file in `app/runtime/` (the app root, the account scope
  // and the adapters they mount). Moving a provider between folders, or
  // renaming it, never takes it out of the count.
  const providerFiles = appFiles.filter(
    (file) =>
      /Provider\.(ts|tsx)$/.test(file) ||
      /\/app\/runtime\/[^/]+\.tsx$/.test(file),
  );

  const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const appDeps = countDeps(join(ROOT, "app/package.json"));
  const workspaceDeps =
    countDeps(join(ROOT, "package.json")) +
    appDeps +
    countDeps(join(ROOT, "wallet/package.json")) +
    countDeps(join(ROOT, "nostr/package.json")) +
    countDeps(join(ROOT, "copy/package.json"));

  return {
    appRuntimeFiles: appFiles.length,
    appRuntimeLoc: countLoc(appFiles),
    walletRuntimeFiles: walletFiles.length,
    walletRuntimeLoc: countLoc(walletFiles),
    nostrRuntimeFiles: nostrFiles.length,
    nostrRuntimeLoc: countLoc(nostrFiles),
    totalRuntimeLoc: countLoc(allRuntime),
    routeFiles: routeFiles.length,
    flowGroupCount: countFlowGroups(),
    providerFiles: providerFiles.length,
    contextDefinitionFiles: countMatchingFiles(appFiles, /\bcreateContext\b/),
    appDeps,
    workspaceDeps,
    patchedDepsCount: Object.keys(rootPkg.patchedDependencies ?? {}).length,
    ndkImportFiles: countMatchingFiles(
      allRuntime,
      /(?:from\s+|import\s*\(?\s*|require\s*\(\s*)['"]@nostr-dev-kit\/ndk[^'"]*['"]/,
    ),
    herouiImportFiles: countMatchingFiles(
      appFiles,
      /(?:from\s+|import\s*\(?\s*|require\s*\(\s*)['"]heroui-native(?:\/[^'"]*)?['"]/,
    ),
  };
}

const RATCHET_KEYS = [
  "totalRuntimeLoc",
  "appDeps",
  "workspaceDeps",
  "patchedDepsCount",
  "flowGroupCount",
  "providerFiles",
  "contextDefinitionFiles",
  "ndkImportFiles",
  "herouiImportFiles",
];

const args = new Set(process.argv.slice(2));
const current = collectMetrics();

if (args.has("--write")) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Wrote baseline to ${BASELINE_PATH}`);
  console.log(JSON.stringify(current, null, 2));
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  : null;

console.log("Sovran rebuild metrics:");
for (const [key, value] of Object.entries(current)) {
  const base = baseline?.[key];
  const delta = typeof base === "number" ? value - base : null;
  const suffix =
    delta === null
      ? ""
      : delta === 0
        ? " (0)"
        : delta > 0
          ? ` (+${delta})`
          : ` (${delta})`;
  console.log(`  ${key}: ${value}${suffix}`);
}

if (args.has("--check")) {
  if (!baseline || typeof baseline !== "object") {
    console.error(
      `Missing or invalid baseline at ${BASELINE_PATH}; run with --write first.`,
    );
    process.exit(1);
  }
  const regressions = [];
  for (const key of RATCHET_KEYS) {
    if (typeof baseline[key] !== "number" || !Number.isFinite(baseline[key])) {
      regressions.push(`${key}: missing or non-numeric baseline value`);
      continue;
    }
    if (current[key] > baseline[key]) {
      regressions.push(`${key}: ${baseline[key]} -> ${current[key]}`);
    }
  }
  if (regressions.length > 0) {
    console.error("✖ Rebuild ratchet regressed:");
    for (const r of regressions) console.error(`  - ${r}`);
    process.exit(1);
  }
  console.log("✓ Rebuild ratchet passed.");
}
