#!/usr/bin/env node

import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const APP_DIR = resolve(import.meta.dirname, '..');
const REPO_DIR = resolve(APP_DIR, '..');

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing ${name} <path>`);
  return resolve(APP_DIR, process.argv[index + 1]);
}

const exportDirs = { ios: option('--ios'), android: option('--android') };
const outputPath = option('--output');
const bundleBudget = JSON.parse(readFileSync(resolve(APP_DIR, 'bundle-size-budget.json'), 'utf8'));

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function sumBytes(files) {
  return files.reduce((total, file) => total + statSync(file).size, 0);
}

function measure(platform, directory) {
  const files = walk(directory);
  const bundleSegment = `${sep}_expo${sep}static${sep}js${sep}${platform}${sep}`;
  const assetSegment = `${sep}assets${sep}`;
  const bundles = files.filter(
    (file) => file.includes(bundleSegment) && (file.endsWith('.hbc') || file.endsWith('.js'))
  );
  const assets = files.filter((file) => file.includes(assetSegment));

  if (bundles.length === 0)
    throw new Error(`No ${platform} JavaScript/Hermes bundle found in ${directory}`);

  const bundleBytes = sumBytes(bundles);
  const assetBytes = sumBytes(assets);
  const maximum = bundleBudget.platforms[platform].maximumBytes;
  const reference = bundleBudget.platforms[platform].referenceBytes;

  return {
    bundleFiles: bundles.length,
    bundleBytes,
    bundleGzipBytes: bundles.reduce(
      (total, file) => total + gzipSync(readFileSync(file), { level: 9 }).length,
      0
    ),
    assetFiles: assets.length,
    assetBytes,
    totalFiles: files.length,
    totalBytes: sumBytes(files),
    referenceBytes: reference,
    maximumBytes: maximum,
    deltaFromReferenceBytes: {
      bundle: bundleBytes - reference.bundle,
      assets: assetBytes - reference.assets,
    },
    headroomBytes: {
      bundle: maximum.bundle - bundleBytes,
      assets: maximum.assets - assetBytes,
    },
    withinBudget: bundleBytes <= maximum.bundle && assetBytes <= maximum.assets,
  };
}

function sumNumbers(value) {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((total, child) => total + sumNumbers(child), 0);
}

const compilerBaseline = JSON.parse(
  readFileSync(resolve(APP_DIR, 'react-compiler-bailouts.json'), 'utf8')
);
const eslintBaseline = JSON.parse(
  readFileSync(resolve(APP_DIR, 'eslint-suppressions.json'), 'utf8')
);
const stylingBaseline = JSON.parse(readFileSync(resolve(APP_DIR, 'styling-budget.json'), 'utf8'));
const knipConfig = JSON.parse(readFileSync(resolve(REPO_DIR, 'knip.json'), 'utf8'));

const requiredBadges = [
  'ci.yml',
  'lint.yml',
  'type-check.yml',
  'knip.yml',
  'react-compiler.yml',
  'react-doctor.yml',
  'styling.yml',
  'bundle-size.yml',
];
const readmes = [resolve(REPO_DIR, 'README.md'), resolve(APP_DIR, 'README.md')];
const missingBadges = readmes.flatMap((readme) => {
  const contents = readFileSync(readme, 'utf8');
  return requiredBadges
    .filter((workflow) => !contents.includes(`/actions/workflows/${workflow}/badge.svg`))
    .map((workflow) => `${relative(REPO_DIR, readme)}: ${workflow}`);
});

const bundles = Object.fromEntries(
  Object.entries(exportDirs).map(([platform, directory]) => [
    platform,
    measure(platform, directory),
  ])
);
const knipIgnoredIssueCategories = Object.values(knipConfig.ignoreIssues ?? {}).reduce(
  (total, categories) => total + categories.length,
  0
);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? null,
  acceptedDebt: {
    reactCompilerBailoutFiles: Object.keys(compilerBaseline.bailouts ?? {}).length,
    eslintSuppressions: sumNumbers(eslintBaseline),
    stylingSites: sumNumbers(stylingBaseline),
    knipIgnoredIssueCategories,
  },
  zeroDebtTargets: {
    knipFindings: 0,
    typeErrors: 0,
    testFailures: 0,
  },
  bundles,
  readmeBadgeContract: {
    ok: missingBadges.length === 0,
    missing: missingBadges,
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
const signedKib = (bytes) => `${bytes >= 0 ? '+' : ''}${(bytes / 1024).toFixed(1)} KiB`;
const summary = [
  '## Maintenance health',
  '',
  '| Accepted debt | Current | Direction |',
  '| --- | ---: | --- |',
  `| React Compiler bailout files | ${report.acceptedDebt.reactCompilerBailoutFiles} | down |`,
  `| ESLint suppressions | ${report.acceptedDebt.eslintSuppressions} | down |`,
  `| Styling sites | ${report.acceptedDebt.stylingSites} | down |`,
  `| Knip ignored issue categories | ${report.acceptedDebt.knipIgnoredIssueCategories} | down |`,
  '',
  '| Platform | Hermes/JS | vs reference | Assets | vs reference | Budget |',
  '| --- | ---: | ---: | ---: | ---: | --- |',
  ...Object.entries(bundles).map(
    ([platform, metrics]) =>
      `| ${platform} | ${mib(metrics.bundleBytes)} | ${signedKib(metrics.deltaFromReferenceBytes.bundle)} | ${mib(metrics.assetBytes)} | ${signedKib(metrics.deltaFromReferenceBytes.assets)} | ${metrics.withinBudget ? 'pass' : 'FAIL'} |`
  ),
  '',
  'React Doctor is advisory and intentionally excluded from the score. The workflow badges in both READMEs are enforced by this job; full numbers are in the `maintenance-health` artifact.',
  '',
].join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
} else {
  console.log(summary);
}

const failures = [];
if (missingBadges.length > 0) failures.push(`Missing README badges: ${missingBadges.join(', ')}`);
for (const [platform, metrics] of Object.entries(bundles)) {
  if (metrics.bundleBytes > metrics.maximumBytes.bundle) {
    failures.push(
      `${platform} bundle is ${metrics.bundleBytes} bytes; budget is ${metrics.maximumBytes.bundle} bytes`
    );
  }
  if (metrics.assetBytes > metrics.maximumBytes.assets) {
    failures.push(
      `${platform} assets are ${metrics.assetBytes} bytes; budget is ${metrics.maximumBytes.assets} bytes`
    );
  }
}

if (failures.length > 0) {
  console.error('✗ Maintenance health failed:\n');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`✓ Bundle budgets and ${requiredBadges.length} README badge contracts pass.`);
