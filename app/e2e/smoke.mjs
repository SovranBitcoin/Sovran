#!/usr/bin/env node
/**
 * Lean iOS & Android visual-parity and smoke capture runner.
 *
 * Replaces the old 65k-line custom harness with a single, zero-dependency script
 * that opens the core wallet screens on a booted iOS Simulator or Android
 * Emulator via deep links, captures light/dark screenshots, and builds a
 * side-by-side HTML parity sheet.
 *
 * Usage:
 *   node e2e/smoke.mjs --plan
 *   node e2e/smoke.mjs --platform ios --mode both
 *   node e2e/smoke.mjs --platform android --mode both
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE_WALLET_SCREENS = [
  { page: 'wallet', label: 'Wallet Home', url: 'sovran://' },
  { page: 'receive', label: 'Receive Hub', url: 'sovran://receive' },
  { page: 'send', label: 'Send Hub', url: 'sovran://send' },
  { page: 'mint-add', label: 'Add / Discover Mints', url: 'sovran://add' },
  { page: 'contacts', label: 'Contacts', url: 'sovran://contacts' },
  { page: 'transactions', label: 'Transactions', url: 'sovran://transactions' },
  { page: 'settings', label: 'Settings', url: 'sovran://settings' },
];

const DEFAULT_OUT = resolve(fileURLToPath(new URL('.', import.meta.url)), '.artifacts');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseArgs(argv) {
  const args = { platform: 'ios', mode: 'both', out: DEFAULT_OUT, plan: false, delayMs: 1200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan') args.plan = true;
    else if (a === '--platform' && argv[i + 1]) args.platform = argv[++i];
    else if (a === '--mode' && argv[i + 1]) args.mode = argv[++i];
    else if (a === '--out' && argv[i + 1]) args.out = resolve(argv[++i]);
    else if (a === '--delay' && argv[i + 1]) args.delayMs = Number(argv[++i]);
  }
  if (!['ios', 'android'].includes(args.platform)) {
    throw new Error(`Unsupported --platform "${args.platform}" (expected ios or android)`);
  }
  if (!['light', 'dark', 'both'].includes(args.mode)) {
    throw new Error(`Unsupported --mode "${args.mode}" (expected light, dark, or both)`);
  }
  return args;
}

function setAppearance(platform, appearance) {
  if (platform === 'ios') {
    execFileSync('xcrun', ['simctl', 'ui', 'booted', 'appearance', appearance], { stdio: 'inherit' });
  } else {
    const night = appearance === 'dark' ? 'yes' : 'no';
    execFileSync('adb', ['shell', 'cmd', 'uimode', 'night', night], { stdio: 'inherit' });
  }
}

function openUrl(platform, url) {
  if (platform === 'ios') {
    execFileSync('xcrun', ['simctl', 'openurl', 'booted', url], { stdio: 'inherit' });
  } else {
    execFileSync('adb', ['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url], {
      stdio: 'inherit',
    });
  }
}

function screenshot(platform, destPath) {
  if (platform === 'ios') {
    execFileSync('xcrun', ['simctl', 'io', 'booted', 'screenshot', destPath], { stdio: 'inherit' });
  } else {
    const png = execFileSync('adb', ['exec-out', 'screencap', '-p']);
    writeFileSync(destPath, png);
  }
}

export function buildParityHtml(outDir) {
  const modes = ['light', 'dark'];
  const rows = CORE_WALLET_SCREENS.flatMap(({ page, label }) =>
    modes.map((mode) => {
      const iosRel = `ios/${mode}/${page}.png`;
      const androidRel = `android/${mode}/${page}.png`;
      const cell = (rel, name) =>
        existsSync(resolve(outDir, rel))
          ? `<figure><img src="${rel}" alt="${name}" loading="lazy"><figcaption>${name}</figcaption></figure>`
          : `<div class="missing">${name}: not captured</div>`;
      return `<section><h2>${label} <span>(${mode})</span></h2><div class="pair">${cell(iosRel, 'iOS')}${cell(androidRel, 'Android')}</div></section>`;
    })
  ).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sovran iOS vs Android Visual Parity</title>
<style>
  body { font-family: system-ui, sans-serif; background: #111; color: #eee; margin: 24px; }
  h2 { font-size: 16px; margin: 24px 0 8px; } h2 span { color: #888; font-weight: 400; }
  .pair { display: grid; grid-template-columns: repeat(2, minmax(220px, 340px)); gap: 16px; }
  figure { margin: 0; background: #1c1c1e; padding: 8px; border-radius: 12px; }
  img { width: 100%; border-radius: 8px; display: block; }
  figcaption { text-align: center; font-size: 12px; color: #aaa; margin-top: 6px; }
  .missing { background: #1c1c1e; color: #666; display: grid; place-items: center; min-height: 200px; border-radius: 12px; }
</style></head><body><h1>Sovran Visual Parity</h1>${rows}</body></html>\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const appearances = args.mode === 'both' ? ['light', 'dark'] : [args.mode];

  if (args.plan) {
    console.log(JSON.stringify({ platform: args.platform, appearances, screens: CORE_WALLET_SCREENS }, null, 2));
    process.exit(0);
  }

  for (const appearance of appearances) {
    const dir = resolve(args.out, args.platform, appearance);
    mkdirSync(dir, { recursive: true });
    setAppearance(args.platform, appearance);
    sleep(400);
    for (const screen of CORE_WALLET_SCREENS) {
      openUrl(args.platform, screen.url);
      sleep(args.delayMs);
      const dest = resolve(dir, `${screen.page}.png`);
      screenshot(args.platform, dest);
      console.log(`Captured ${args.platform}/${appearance}/${screen.page}.png`);
    }
  }

  const htmlPath = resolve(args.out, 'parity.html');
  writeFileSync(htmlPath, buildParityHtml(args.out));
  console.log(`Parity sheet written to ${htmlPath}`);
}
