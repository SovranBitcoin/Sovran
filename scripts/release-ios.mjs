#!/usr/bin/env node
/**
 * One-command iOS release to Freedom Store (AltStore).
 *
 *   bun run release:ios <ADP_ID> [flags]
 *
 * Given an App Store Connect "Alternative Distribution Package ID", this:
 *   1. Preflight checks (gh auth, ASC creds, tools, clean trees, ADP ready)
 *   2. Syncs the freedomstore fork's main to upstream
 *   3. Downloads + extracts the ADP into sovran.money
 *   4. Refreshes screenshots from App Store Connect
 *   5. Updates altstore-source.json (parse → mutate → serialize)
 *   6. Prunes stale release/screenshot assets
 *   7. Commits + pushes sovran.money (triggers deploy)
 *   8. Waits for the deploy and verifies the URLs are really live
 *   9. Opens/updates the freedomstore PR (CI passes because URLs are live)
 *  10. Stops at a green PR — or with --merge, squash-merges to production
 *
 * Flags: --dry-run, --no-screenshots, --keep-screenshots, --no-prune, --merge,
 *        --allow-dirty, --help
 */

import fs from 'fs';
import path from 'path';

import * as cfg from './release.config.mjs';
import { loadEnv } from './lib/env.mjs';
import {
  isValidAdpId,
  classifyAdp,
  fetchAdpStatus,
  downloadAndExtract,
  parseManifest,
  releaseSize,
} from './lib/adp.mjs';
import { createAscClient } from './lib/asc.mjs';
import * as altstore from './lib/altstore-json.mjs';
import {
  syncScreenshots,
  writeScreenshotsTs,
  generateComposite,
  selectPruneTargets,
} from './lib/screenshots.mjs';
import * as g from './lib/git.mjs';
import { waitForDeploy } from './lib/deploy-gate.mjs';

// ─── CLI plumbing ────────────────────────────────────────────────────────────

const log = {
  phase: (n, t) => console.log(`\n\x1b[1m[${n}] ${t}\x1b[0m`),
  ok: (m) => console.log(`   \x1b[32m✓\x1b[0m ${m}`),
  info: (m) => console.log(`   ${m}`),
  warn: (m) => console.log(`   \x1b[33m⚠\x1b[0m  ${m}`),
};

function fail(msg) {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

function usage() {
  console.log(`Usage: bun run release:ios <ADP_ID> [flags]

  ADP_ID              Alternative Distribution Package ID (UUID from App Store Connect)
                      https://appstoreconnect.apple.com/apps/${cfg.APP_ID}/distribution/activity/ios/versions

  --dry-run           Do everything locally; push nothing, open no PR
  --no-screenshots    Skip App Store Connect screenshot sync
  --keep-screenshots  Reuse existing screenshots (don't pull from ASC)
  --no-prune          Don't remove stale release/screenshot assets
  --merge             After CI passes, squash-merge the PR (ships to production)
  --allow-dirty       Proceed even if working trees have unrelated changes
  --help`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.length === 0) usage();
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const adpId = argv.find((a) => !a.startsWith('--'));
const opt = {
  dryRun: flags.has('--dry-run'),
  noScreenshots: flags.has('--no-screenshots'),
  keepScreenshots: flags.has('--keep-screenshots'),
  noPrune: flags.has('--no-prune'),
  merge: flags.has('--merge'),
  allowDirty: flags.has('--allow-dirty'),
};

const today = () => new Date().toISOString().split('T')[0];
const downloadFile = async (url, outPath) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
};

// ─── Phase 1: preflight ──────────────────────────────────────────────────────

async function preflight() {
  log.phase(1, 'Preflight');

  if (!isValidAdpId(adpId)) fail(`Invalid ADP ID: ${adpId ?? '(none)'} — expected a UUID.`);
  for (const dir of [cfg.SOVRAN_MONEY_DIR, cfg.FREEDOMSTORE_DIR]) {
    if (!fs.existsSync(path.join(dir, '.git'))) fail(`Not a git repo: ${dir}`);
  }
  if (!g.ghAuthOk()) fail('gh is not authenticated. Run: gh auth login -h github.com');

  loadEnv(path.join(cfg.APP_DIR, '.env'));
  const ascCreds = {
    issuerId: process.env.ASC_ISSUER_ID,
    keyId: process.env.ASC_KEY_ID,
    privateKey: process.env.ASC_PRIVATE_KEY,
  };
  const needsAsc = !opt.noScreenshots && !opt.keepScreenshots;
  if (needsAsc && (!ascCreds.issuerId || !ascCreds.keyId || !ascCreds.privateKey)) {
    fail(
      'Missing ASC creds in sovran-app/.env (ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY). Use --no-screenshots to skip.'
    );
  }

  for (const dir of [cfg.SOVRAN_MONEY_DIR, cfg.FREEDOMSTORE_DIR]) {
    if (g.isDirty(g.statusPorcelain(dir))) {
      if (opt.allowDirty)
        log.warn(`${path.basename(dir)} has uncommitted changes (--allow-dirty).`);
      else
        fail(
          `${path.basename(dir)} has uncommitted changes. Commit/stash them or pass --allow-dirty.\n${g.statusPorcelain(dir)}`
        );
    }
  }

  log.info('Checking ADP status…');
  const adpData = await fetchAdpStatus(adpId);
  const verdict = classifyAdp(adpData);
  if (!verdict.ok) fail(verdict.reason);
  log.ok(`ADP ready (expires ${adpData.downloadExpiration}).`);
  return { adpData, ascCreds, needsAsc };
}

// ─── Phase 2: sync fork ──────────────────────────────────────────────────────

function syncFork() {
  log.phase(2, 'Sync fork with upstream');
  const dir = cfg.FREEDOMSTORE_DIR;
  g.fetch(cfg.UPSTREAM_REMOTE, cfg.BASE_BRANCH, dir);
  g.fetch(cfg.ORIGIN_REMOTE, cfg.BASE_BRANCH, dir);

  const localSha = g.revParse(`${cfg.ORIGIN_REMOTE}/${cfg.BASE_BRANCH}`, dir);
  const upstreamSha = g.revParse(`${cfg.UPSTREAM_REMOTE}/${cfg.BASE_BRANCH}`, dir);
  const mergeBaseSha = g.mergeBase(localSha, upstreamSha, dir);
  const { action } = g.classifyForkSync({ localSha, upstreamSha, mergeBaseSha });

  if (action === 'up-to-date') return log.ok('Fork already up to date with upstream.');
  if (action === 'diverged') {
    fail('Fork main has diverged from upstream/main. Resolve manually before releasing.');
  }
  if (opt.dryRun)
    return log.warn('Fork is behind upstream — would fast-forward (skipped in --dry-run).');

  g.git(['checkout', cfg.BASE_BRANCH], dir);
  g.git(['merge', '--ff-only', `${cfg.UPSTREAM_REMOTE}/${cfg.BASE_BRANCH}`], dir);
  g.git(['push', cfg.ORIGIN_REMOTE, cfg.BASE_BRANCH], dir);
  log.ok('Fast-forwarded fork main → upstream and pushed.');
}

// ─── Phases 3–5: download, screenshots, JSON ─────────────────────────────────

async function buildRelease({ adpData, ascCreds, needsAsc }) {
  log.phase(3, 'Download ADP');
  const releaseDir = downloadAndExtract({
    downloadUrl: adpData.downloadURL,
    adpId,
    releasesDir: cfg.RELEASES_DIR,
  });
  const manifest = parseManifest(releaseDir);
  const size = releaseSize(releaseDir);
  log.ok(
    `v${manifest.version} (build ${manifest.buildVersion}), minOS ${manifest.minOSVersion}, ${(size / 1e6).toFixed(1)} MB`
  );

  // Cut the freedomstore release branch now (off fresh origin/main, with a clean
  // tree per preflight) so the altstore-source.json edit in phase 5 lands on it.
  const branch = `sovran-release-${manifest.version}`;
  if (!opt.dryRun) {
    g.git(
      ['checkout', '-B', branch, `${cfg.ORIGIN_REMOTE}/${cfg.BASE_BRANCH}`],
      cfg.FREEDOMSTORE_DIR
    );
  }

  log.phase(4, 'Screenshots');
  let screenshotResult = { deviceScreenshots: {}, primaryDevice: null };
  if (opt.noScreenshots) {
    log.info('Skipped (--no-screenshots).');
  } else if (opt.keepScreenshots) {
    log.info('Reusing existing screenshots (--keep-screenshots).');
  } else {
    const asc = createAscClient(ascCreds);
    screenshotResult = await syncScreenshots({
      ascClient: asc,
      version: manifest.version,
      iosPublicDir: cfg.IOS_PUBLIC_DIR,
      downloadFile,
    });
    if (screenshotResult.missing) {
      log.warn(
        `App Store Connect has no version ${manifest.version} — keeping existing screenshots.`
      );
    } else {
      const counts = Object.entries(screenshotResult.deviceScreenshots)
        .map(([d, u]) => `${d.replace('APP_IPHONE_', '')}:${u.length}`)
        .join(' ');
      log.ok(`Synced screenshots (${counts}), primary ${screenshotResult.primaryDevice}.`);
    }
  }

  log.phase(5, 'Update altstore-source.json');
  const data = altstore.readSource(cfg.ALTSTORE_SOURCE_PATH);
  altstore.upsertVersion(data, {
    adpId,
    version: manifest.version,
    buildVersion: manifest.buildVersion,
    date: today(),
    minOSVersion: manifest.minOSVersion,
    size,
  });
  if (!needsAsc || screenshotResult.missing) {
    log.info('Screenshots array left unchanged.');
  } else if (screenshotResult.primaryDevice) {
    const urls = screenshotResult.deviceScreenshots[screenshotResult.primaryDevice];
    altstore.setScreenshots(data, urls);
    writeScreenshotsTs(
      cfg.SCREENSHOTS_TS_PATH,
      screenshotResult.deviceScreenshots,
      screenshotResult.primaryDevice
    );
    log.ok(`Listing screenshots set to ${urls.length} ${screenshotResult.primaryDevice} images.`);
  }
  altstore.writeSource(cfg.ALTSTORE_SOURCE_PATH, data);

  // Verify every version maps to a distinct ADP (regression guard for the old bug).
  const ids = altstore.referencedAdpIds(data);
  if (new Set(ids).size !== ids.length) fail(`Duplicate ADP across versions: ${ids.join(', ')}`);
  log.ok('JSON written; all version downloadURLs map to distinct ADPs.');

  log.phase(6, 'Prune stale assets');
  if (opt.noPrune) log.info('Skipped (--no-prune).');
  else prune(data);

  // Composite preview from the primary device dir.
  let previewName = null;
  const primary = screenshotResult.primaryDevice || pickExistingPrimary();
  if (primary) {
    previewName = `screenshots-preview-${manifest.version}.png`;
    const dims = await generateComposite({
      deviceDir: path.join(cfg.IOS_PUBLIC_DIR, primary),
      outPath: path.join(cfg.IOS_PUBLIC_DIR, previewName),
    });
    if (dims) log.ok(`Preview ${previewName} (${dims.width}×${dims.height}).`);
    else previewName = null;
  }

  return { manifest, size, previewName, branch };
}

function pickExistingPrimary() {
  return cfg.DEVICE_PREFERENCE.find((d) => {
    const dir = path.join(cfg.IOS_PUBLIC_DIR, d);
    return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.png'));
  });
}

function prune(data) {
  const referenced = altstore.referencedAdpIds(data);
  const listedVersions = (altstore.findApp(data)?.versions ?? []).map((v) => v.version);

  const releaseDirs = fs.existsSync(cfg.RELEASES_DIR)
    ? fs
        .readdirSync(cfg.RELEASES_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, path: path.join(cfg.RELEASES_DIR, e.name) }))
    : [];

  // Only consider a device's screenshots for pruning when it has a non-empty
  // order.json — without an explicit keep-list we can't tell which files are in
  // use, so we leave that device untouched rather than risk deleting live shots.
  const screenshotFiles = [];
  const orderByDevice = {};
  for (const device of cfg.DEVICE_PREFERENCE) {
    const dir = path.join(cfg.IOS_PUBLIC_DIR, device);
    const orderPath = path.join(dir, 'order.json');
    if (!fs.existsSync(dir) || !fs.existsSync(orderPath)) continue;
    const order = JSON.parse(fs.readFileSync(orderPath, 'utf-8'));
    if (!order.length) continue;
    orderByDevice[device] = order;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.png')) screenshotFiles.push({ device, file: f, path: path.join(dir, f) });
    }
  }

  const previewFiles = fs
    .readdirSync(cfg.IOS_PUBLIC_DIR)
    .filter((f) => /^screenshots-preview-(.+)\.png$/.test(f))
    .map((f) => ({
      version: /^screenshots-preview-(.+)\.png$/.exec(f)[1],
      path: path.join(cfg.IOS_PUBLIC_DIR, f),
    }));

  const targets = selectPruneTargets({
    referencedAdpIds: referenced,
    releaseDirs,
    screenshotFiles,
    orderByDevice,
    previewFiles,
    listedVersions,
  });

  const all = [...targets.releaseDirs, ...targets.screenshots, ...targets.previews];
  if (!all.length) return log.info('Nothing to prune.');
  for (const p of all) {
    log.info(
      `${opt.dryRun ? 'would remove' : 'removing'} ${path.relative(cfg.SOVRAN_MONEY_DIR, p)}`
    );
    if (!opt.dryRun) fs.rmSync(p, { recursive: true, force: true });
  }
  log.ok(`${opt.dryRun ? 'Would prune' : 'Pruned'} ${all.length} item(s).`);
}

// ─── Phase 7: commit + push sovran.money ─────────────────────────────────────

function publishSovranMoney({ manifest }) {
  log.phase(7, 'Commit + push sovran.money');
  const dir = cfg.SOVRAN_MONEY_DIR;
  g.git(['add', 'public/ios', 'src/screenshots.ts'], dir);
  if (
    !g
      .statusPorcelain(dir)
      .split('\n')
      .some((l) => l.trim())
  )
    return log.info('No changes to commit.');
  g.git(['commit', '-m', `Sovran release ${manifest.version} iOS assets (ADP ${adpId})`], dir);
  g.git(['push', cfg.ORIGIN_REMOTE, cfg.BASE_BRANCH], dir);
  log.ok('Pushed sovran.money → deploy triggered.');
}

// ─── Phase 8: deploy gate ────────────────────────────────────────────────────

async function deployGate({ previewName }) {
  log.phase(8, 'Wait for deploy');
  const data = altstore.readSource(cfg.ALTSTORE_SOURCE_PATH);
  const app = altstore.findApp(data);
  const manifestPath = path.join(cfg.RELEASES_DIR, adpId, 'manifest.json');
  const targets = [
    {
      url: `${altstore.downloadUrlFor(adpId)}manifest.json`,
      kind: 'json',
      expectedBytes: fs.statSync(manifestPath).size,
      label: 'manifest',
    },
  ];
  if (app.screenshots?.[0])
    targets.push({ url: app.screenshots[0], kind: 'image', label: 'screenshot' });
  if (previewName)
    targets.push({
      url: `${cfg.SOVRAN_MONEY_BASE}/ios/${previewName}`,
      kind: 'image',
      label: 'preview',
    });

  const ready = await waitForDeploy(targets, {
    onTick: (results) =>
      log.info(results.map((r) => `${r.t.label}:${r.ready ? '✓' : '…'}`).join(' ')),
  });
  if (!ready)
    fail('Deploy did not go live within the timeout. Check the sovran.money deploy, then re-run.');
  log.ok('All release URLs are live.');
}

// ─── Phase 9–10: PR + optional merge ─────────────────────────────────────────

function openPr({ manifest, previewName, branch }) {
  log.phase(9, 'Open freedomstore PR');
  const dir = cfg.FREEDOMSTORE_DIR;
  const title = `Sovran release ${manifest.version}`;

  // The release branch was created in buildRelease and the JSON edit already
  // landed on it; just stage and commit it here.
  g.git(['add', 'altstore-source.json'], dir);
  if (
    g
      .statusPorcelain(dir)
      .split('\n')
      .some((l) => l.includes('altstore-source.json'))
  ) {
    g.git(['commit', '-m', title], dir);
  }
  g.git(['push', '-u', cfg.ORIGIN_REMOTE, branch, '--force-with-lease'], dir);

  const login = g.ghLogin();
  const head = `${login}:${branch}`;
  const previewBlock = previewName
    ? `\n\n## Screenshots\n\n![Sovran ${manifest.version} screenshots](${cfg.SOVRAN_MONEY_BASE}/ios/${previewName})`
    : '';
  const body = `- Version: ${manifest.version} (build ${manifest.buildVersion})
- ADP ID: \`${adpId}\`${previewBlock}

---
*Generated by scripts/release-ios.mjs.*`;

  const existing = g.openPrUrl({ repo: cfg.PR_TARGET_REPO, head, base: cfg.BASE_BRANCH });
  let prUrl;
  if (existing) {
    g.editPrBody({ repo: cfg.PR_TARGET_REPO, prUrl: existing, body });
    prUrl = existing;
    log.ok(`Updated existing PR: ${prUrl}`);
  } else {
    prUrl = g.createPr({ repo: cfg.PR_TARGET_REPO, base: cfg.BASE_BRANCH, head, title, body });
    log.ok(`Created PR: ${prUrl}`);
  }
  return prUrl;
}

async function maybeMerge(prUrl) {
  if (!opt.merge) {
    log.info('Stopping at open PR (pass --merge to ship to production).');
    return;
  }
  log.phase(10, 'Merge PR');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) {
    const state = g.prCheckState({ repo: cfg.PR_TARGET_REPO, prUrl, name: 'check-urls' });
    if (state === 'pass') break;
    if (state === 'fail') fail('CI check-urls failed — not merging.');
    await sleep(cfg.DEPLOY_POLL_INTERVAL_MS);
  }
  g.squashMerge({ repo: cfg.PR_TARGET_REPO, prUrl });
  log.ok('Squash-merged — Freedom Store source deploys from main.');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const pre = await preflight();
  syncFork();
  const built = await buildRelease(pre);

  if (opt.dryRun) {
    log.phase('—', 'Dry run complete');
    console.log('\nsovran.money changes:');
    console.log(g.statusPorcelain(cfg.SOVRAN_MONEY_DIR) || '   (none)');
    console.log('\nfreedomstore altstore-source.json diff:');
    console.log(
      g.git(['--no-pager', 'diff', '--', 'altstore-source.json'], cfg.FREEDOMSTORE_DIR) ||
        '   (none)'
    );
    console.log('\nPushed nothing. Re-run without --dry-run to publish.');
    return;
  }

  publishSovranMoney(built);
  await deployGate(built);
  const prUrl = openPr(built);
  await maybeMerge(prUrl);

  log.phase('✓', 'Release complete');
  log.info(`Version ${built.manifest.version} (build ${built.manifest.buildVersion})`);
  log.info(`PR: ${prUrl}`);
  if (!opt.merge) log.info('Merge the PR when ready to publish to Freedom Store.');
}

main().catch((e) => fail(e.stack || e.message));
