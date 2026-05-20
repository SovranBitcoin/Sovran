#!/usr/bin/env node

/**
 * Sync AltStore Script
 *
 * Downloads an Alternative Distribution Package (ADP) from AltStore's API
 * and updates the Freedom Store listing with the new version.
 * Optionally syncs screenshots from App Store Connect.
 *
 * Usage:
 *   node scripts/sync-altstore.mjs <ADP_ID>
 *   node scripts/sync-altstore.mjs <ADP_ID> --screenshots
 */

import crypto from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Paths
const RELEASES_DIR = path.join(ROOT_DIR, '../sovran.money/public/ios/releases');
const SOVRAN_IOS_DIR = path.join(ROOT_DIR, '../sovran.money/public/ios');
const ALTSTORE_SOURCE_PATH = path.join(ROOT_DIR, '../freedomstore/altstore-source.json');
const SCREENSHOTS_TS_PATH = path.join(ROOT_DIR, '../sovran.money/src/screenshots.ts');
const SOVRAN_BUNDLE_ID = 'com.sovranbitcoin';
const ALTSTORE_API_BASE = 'https://api.altstore.io/adps';
const APP_ID = '6499554529';
const ASC_API_BASE = 'https://api.appstoreconnect.apple.com/v1';
const PREFERRED_LOCALES = ['en-US', 'en-GB'];

// Parse args
const args = process.argv.slice(2);
const flagIdx = args.findIndex((a) => a.startsWith('--'));
const positional = flagIdx === -1 ? args : args.slice(0, flagIdx);
const flags = new Set(flagIdx === -1 ? [] : args.slice(flagIdx));
const SYNC_SCREENSHOTS = !flags.has('--no-screenshots');
const DOWNLOAD_ONLY = flags.has('--download-only');

// Load .env for ASC credentials
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      value = value.replace(/\\n/g, '\n');
      process.env[key] = value;
    }
  }
}

// Readline interface for prompts
let rl;

function prompt(question) {
  return new Promise((resolve) => {
    if (!rl) {
      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function closeReadline() {
  if (rl) rl.close();
}

// ─── ADP helpers ─────────────────────────────────────────────────────────────

async function fetchAdpStatus(adpId) {
  const url = `${ALTSTORE_API_BASE}/${adpId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ADP: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function downloadAndExtract(downloadUrl, adpId) {
  const outputDir = path.join(RELEASES_DIR, adpId);
  const zipPath = path.join(RELEASES_DIR, `${adpId}.zip`);

  fs.mkdirSync(RELEASES_DIR, { recursive: true });

  if (fs.existsSync(outputDir) && fs.existsSync(path.join(outputDir, 'manifest.json'))) {
    console.log(`\n   ✓ Release already downloaded, skipping download.`);
    return outputDir;
  }

  console.log(`\n   ⬇️  Downloading ADP package...`);
  execSync(`curl -sL -o "${zipPath}" "${downloadUrl}"`, { stdio: 'pipe' });

  console.log(`   📦 Extracting...`);
  fs.mkdirSync(outputDir, { recursive: true });
  execSync(`unzip -q -o "${zipPath}" -d "${outputDir}"`, { stdio: 'pipe' });

  fs.unlinkSync(zipPath);
  console.log(`   ✓ Extracted to releases/${adpId}/`);

  return outputDir;
}

function parseManifest(releaseDir) {
  const manifestPath = path.join(releaseDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in release`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return {
    bundleId: manifest.bundleId,
    version: manifest.shortVersionString,
    buildVersion: manifest.bundleVersion,
    minOSVersion: manifest.minimumSystemVersions?.ios || '15.1',
  };
}

// ─── Surgical JSON helpers ───────────────────────────────────────────────────

function indent(json, depth) {
  const pad = ' '.repeat(depth);
  return json
    .split('\n')
    .map((line, i) => (i === 0 ? line : pad + line))
    .join('\n');
}

function updateAltstoreSource(adpId, manifestData) {
  let content = fs.readFileSync(ALTSTORE_SOURCE_PATH, 'utf-8');
  const source = JSON.parse(content);

  const newVersion = {
    downloadURL: `https://sovran.money/ios/releases/${adpId}/`,
    size: 10000000,
    version: manifestData.version,
    buildVersion: manifestData.buildVersion,
    date: new Date().toISOString().split('T')[0],
    localizedDescription: null,
    minOSVersion: manifestData.minOSVersion,
  };

  const sovranApp = source.apps.find((app) => app.bundleIdentifier === SOVRAN_BUNDLE_ID);

  if (!sovranApp) {
    // Surgically insert a new app entry before the closing ] of the apps array
    console.log(`   Sovran entry not found — creating it...`);
    const appEntry = {
      name: 'Sovran',
      bundleIdentifier: SOVRAN_BUNDLE_ID,
      marketplaceID: APP_ID,
      developerName: 'Sovran',
      website: 'https://sovran.money',
      localizedDescription:
        'Sovran is an ecash and Lightning wallet with Nostr identity, NFC payments, and privacy-first design.',
      iconURL: 'https://sovran.money/ios/logo.png',
      tintColor: '#000000',
      category: 'other',
      screenshots: [],
      beta: true,
      versions: [newVersion],
    };
    const appJson = indent(JSON.stringify(appEntry, null, 2), 4);

    // Find the closing ] of the apps array (sits before "news")
    const appsClose = /\n(\s*)\],\s*\n\s*"news"/;
    const match = content.match(appsClose);
    if (!match) {
      throw new Error('Could not find end of apps array for surgical insert');
    }
    const bracketPos = content.indexOf(match[0]) + 1 + match[1].length;
    content =
      content.slice(0, bracketPos) + ',\n    ' + appJson + '\n  ]' + content.slice(bracketPos + 1);

    fs.writeFileSync(ALTSTORE_SOURCE_PATH, content);
    console.log(`   ✓ Added Sovran with version to altstore-source.json`);
    return newVersion;
  }

  // Check for existing version
  const existingIdx = sovranApp.versions.findIndex(
    (v) => v.version === manifestData.version && v.buildVersion === manifestData.buildVersion
  );

  if (existingIdx !== -1) {
    // Surgically replace just the downloadURL and date for this version
    console.log(`   ⚠️  Version ${manifestData.version} already exists, updating...`);
    const url = `https://sovran.money/ios/releases/${adpId}/`;
    const today = new Date().toISOString().split('T')[0];

    content = content.replace(
      new RegExp(
        `("bundleIdentifier":\\s*"com\\.sovranbitcoin"[\\s\\S]*?"version":\\s*"${manifestData.version}"[\\s\\S]*?"downloadURL":\\s*)"[^"]*"`
      ),
      `$1"${url}"`
    );
    content = content.replace(
      new RegExp(
        `("bundleIdentifier":\\s*"com\\.sovranbitcoin"[\\s\\S]*?"version":\\s*"${manifestData.version}"[\\s\\S]*?"date":\\s*)"[^"]*"`
      ),
      `$1"${today}"`
    );

    fs.writeFileSync(ALTSTORE_SOURCE_PATH, content);
    console.log(`   ✓ Updated version in altstore-source.json`);
    return newVersion;
  }

  // Surgically prepend new version into the versions array
  const sovranPattern = /"bundleIdentifier":\s*"com\.sovranbitcoin"[\s\S]*?"versions":\s*\[/;
  const match = content.match(sovranPattern);

  if (!match) {
    throw new Error('Could not find Sovran versions array');
  }

  const insertPosition = match.index + match[0].length;
  const versionJson = indent(JSON.stringify(newVersion, null, 2), 8);

  content =
    content.slice(0, insertPosition) +
    '\n        ' +
    versionJson +
    ',' +
    content.slice(insertPosition);

  fs.writeFileSync(ALTSTORE_SOURCE_PATH, content);
  console.log(`   ✓ Added new version to altstore-source.json`);
  return newVersion;
}

function updateAltstoreScreenshots(screenshotUrls) {
  let content = fs.readFileSync(ALTSTORE_SOURCE_PATH, 'utf-8');
  const sovranPattern =
    /("bundleIdentifier":\s*"com\.sovranbitcoin"[\s\S]*?"screenshots":\s*)\[[\s\S]*?\](\s*,\s*"(?:versions|beta)")/;
  const match = content.match(sovranPattern);

  if (!match) {
    throw new Error('Could not find Sovran screenshots array in altstore-source.json');
  }

  const screenshotsBlock =
    '[\n' + screenshotUrls.map((url) => `        "${url}"`).join(',\n') + '\n      ]';

  content = content.replace(sovranPattern, `$1${screenshotsBlock}$2`);
  fs.writeFileSync(ALTSTORE_SOURCE_PATH, content);
}

// ─── Screenshot helpers (App Store Connect) ──────────────────────────────────

let _ascToken = null;

function getAscToken() {
  if (_ascToken) return _ascToken;

  const issuerId = process.env.ASC_ISSUER_ID;
  const keyId = process.env.ASC_KEY_ID;
  const privateKey = process.env.ASC_PRIVATE_KEY;

  if (!issuerId || !keyId || !privateKey) {
    throw new Error(
      'Missing App Store Connect credentials in .env (ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY)'
    );
  }

  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

  const header = b64url({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const payload = b64url({
    iss: issuerId,
    aud: 'appstoreconnect-v1',
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
  });

  const signature = crypto
    .sign('SHA256', Buffer.from(`${header}.${payload}`), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    })
    .toString('base64url');

  _ascToken = `${header}.${payload}.${signature}`;
  return _ascToken;
}

async function ascRequest(endpoint) {
  const token = getAscToken();
  const url = endpoint.startsWith('http') ? endpoint : `${ASC_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`ASC API request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
}

function sortScreenshotsForListing(screenshots) {
  const hasSortOrder = screenshots.some((shot) => Number.isFinite(shot.attributes?.sortOrder));
  if (!hasSortOrder) return screenshots;
  return [...screenshots].sort(
    (a, b) =>
      (a.attributes?.sortOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.attributes?.sortOrder ?? Number.MAX_SAFE_INTEGER)
  );
}

function compareVersionStrings(a, b) {
  const split = (v) =>
    String(v ?? '')
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((n) => Number(n));
  const left = split(a);
  const right = split(b);
  const maxLength = Math.max(left.length, right.length);
  for (let i = 0; i < maxLength; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l - r;
  }
  return 0;
}

function sortVersionsNewestFirst(versions) {
  return [...versions].sort((a, b) => {
    const byVersion = compareVersionStrings(
      b.attributes?.versionString,
      a.attributes?.versionString
    );
    if (byVersion !== 0) return byVersion;
    const dateA = Date.parse(a.attributes?.releaseDate || a.attributes?.createdDate || '') || 0;
    const dateB = Date.parse(b.attributes?.releaseDate || b.attributes?.createdDate || '') || 0;
    return dateB - dateA;
  });
}

function generateScreenshotsTs(deviceScreenshots, primaryDevice) {
  const primaryUrls = deviceScreenshots[primaryDevice] || [];
  const toRelativePath = (url) => url.replace('https://sovran.money', '');

  const lines = [
    '/**',
    ' * Screenshot URLs for Sovran',
    ' * ',
    ' * This file is auto-generated by scripts/sync-altstore.mjs --screenshots',
    ' * Do not edit manually - run the sync script to update.',
    ' */',
    '',
    'export const screenshots = {',
    `  // Primary screenshots for the website (uses ${primaryDevice})`,
    '  primary: [',
  ];

  for (const url of primaryUrls) {
    lines.push(`    "${toRelativePath(url)}",`);
  }
  lines.push('  ],');
  lines.push('');
  lines.push('  // All device types available');
  lines.push('  devices: {');

  for (const [device, urls] of Object.entries(deviceScreenshots)) {
    lines.push(`    "${device}": [`);
    for (const url of urls) {
      lines.push(`      "${toRelativePath(url)}",`);
    }
    lines.push('    ],');
  }

  lines.push('  },');
  lines.push('};');
  lines.push('');
  lines.push('// Helper to get screenshot by index (0-based)');
  lines.push('export const getScreenshot = (index: number): string => {');
  lines.push('  return screenshots.primary[index] || screenshots.primary[0];');
  lines.push('};');
  lines.push('');
  lines.push('// Semantic aliases for specific use cases');
  lines.push('export const heroScreenshot = screenshots.primary[0];');
  lines.push('export const walletScreenshot = screenshots.primary[0];');
  lines.push('export const socialScreenshot = screenshots.primary[2] || screenshots.primary[0];');
  lines.push('');
  lines.push('export default screenshots;');
  lines.push('');

  fs.writeFileSync(SCREENSHOTS_TS_PATH, lines.join('\n'));
}

async function syncScreenshots(versionString) {
  console.log('\n📸 Syncing screenshots from App Store Connect...');

  const versionsData = await ascRequest(`/apps/${APP_ID}/appStoreVersions`);
  const versions = sortVersionsNewestFirst(versionsData.data);

  // Pick the matching version, or latest
  const targetVersion = versionString
    ? versions.find((v) => v.attributes.versionString === versionString)
    : versions[0];

  if (!targetVersion) {
    console.log(
      `   ⚠️  Version ${versionString} not found in App Store Connect, skipping screenshots.`
    );
    return;
  }

  console.log(`   Version: ${targetVersion.attributes.versionString}`);

  const locData = await ascRequest(
    `/appStoreVersions/${targetVersion.id}/appStoreVersionLocalizations`
  );
  const localizations = locData.data;
  const localization =
    localizations.find((loc) => PREFERRED_LOCALES.includes(loc.attributes.locale)) ||
    localizations[0];

  if (!localization) {
    console.log('   ⚠️  No localizations found, skipping screenshots.');
    return;
  }

  console.log(`   Locale: ${localization.attributes.locale}`);

  const setsData = await ascRequest(
    `/appStoreVersionLocalizations/${localization.id}/appScreenshotSets`
  );
  const iphoneSets = setsData.data.filter((s) =>
    s.attributes.screenshotDisplayType.startsWith('APP_IPHONE')
  );

  if (iphoneSets.length === 0) {
    console.log('   ⚠️  No iPhone screenshot sets found, skipping.');
    return;
  }

  const deviceNames = {
    APP_IPHONE_67: 'iPhone 6.7"',
    APP_IPHONE_65: 'iPhone 6.5"',
    APP_IPHONE_55: 'iPhone 5.5"',
    APP_IPHONE_61: 'iPhone 6.1"',
    APP_IPHONE_58: 'iPhone 5.8"',
  };

  let totalScreenshots = 0;
  const deviceScreenshots = {};

  for (const screenshotSet of iphoneSets) {
    const deviceType = screenshotSet.attributes.screenshotDisplayType;
    const deviceName = deviceNames[deviceType] || deviceType;

    const shotsData = await ascRequest(`/appScreenshotSets/${screenshotSet.id}/appScreenshots`);
    const screenshots = sortScreenshotsForListing(shotsData.data);

    if (screenshots.length === 0) continue;

    console.log(`   📱 ${deviceName}: ${screenshots.length} screenshots`);

    const deviceDir = path.join(SOVRAN_IOS_DIR, deviceType);
    fs.mkdirSync(deviceDir, { recursive: true });

    // If order.json exists, use it as an allowlist — only download tracked files
    const orderPath = path.join(deviceDir, 'order.json');
    const existingOrder = fs.existsSync(orderPath)
      ? new Set(JSON.parse(fs.readFileSync(orderPath, 'utf-8')))
      : null;

    deviceScreenshots[deviceType] = [];
    const orderedFiles = [];

    for (const screenshot of screenshots) {
      const imageAsset = screenshot.attributes.imageAsset;
      if (!imageAsset?.templateUrl) continue;

      const filename = `${screenshot.id}.png`;

      // Skip files not in the existing allowlist
      if (existingOrder && !existingOrder.has(filename)) {
        continue;
      }

      const outputPath = path.join(deviceDir, filename);

      // Skip files already on disk
      if (fs.existsSync(outputPath)) {
        console.log(`      ✓  ${filename} (exists)`);
      } else {
        const finalUrl = imageAsset.templateUrl
          .replace('{w}', imageAsset.width)
          .replace('{h}', imageAsset.height)
          .replace('{f}', 'png');

        console.log(`      ⬇️  ${filename}`);
        await downloadFile(finalUrl, outputPath);
      }

      orderedFiles.push(filename);
      deviceScreenshots[deviceType].push(`https://sovran.money/ios/${deviceType}/${filename}`);
      totalScreenshots++;
    }

    // Only create order.json on first run (no existing allowlist)
    if (!existingOrder) {
      fs.writeFileSync(orderPath, JSON.stringify(orderedFiles, null, 2) + '\n');
    }
  }

  if (totalScreenshots === 0) {
    console.log('   ⚠️  No screenshots downloaded.');
    return;
  }

  // Update altstore-source.json screenshots
  const primaryDevice = Object.keys(deviceScreenshots)[0];
  const listingUrls = deviceScreenshots[primaryDevice];
  updateAltstoreScreenshots(listingUrls);
  console.log(`   ✓ altstore-source.json screenshots updated (${listingUrls.length} images)`);

  // Update screenshots.ts
  generateScreenshotsTs(deviceScreenshots, primaryDevice);
  console.log(
    `   ✓ screenshots.ts updated (${Object.keys(deviceScreenshots).length} device types)`
  );

  console.log(`   ✓ ${totalScreenshots} screenshots synced total`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           📦 Sovran AltStore Sync Tool                    ║
╠═══════════════════════════════════════════════════════════╣
║  This tool downloads your ADP from AltStore and updates   ║
║  the Freedom Store listing with the new version.          ║
╚═══════════════════════════════════════════════════════════╝
`);

  console.log(`📋 To find your ADP ID:`);
  console.log(
    `   1. Go to: https://appstoreconnect.apple.com/apps/${APP_ID}/distribution/activity/ios/versions`
  );
  console.log(`   2. Click on the version you want to distribute`);
  console.log(`   3. Find the "Alternative Distribution Package ID" in the details`);
  console.log(`   4. Copy the UUID (e.g., 955b20d5-8417-4a3d-88f6-05d72eec18aa)\n`);

  try {
    // Step 1: Get ADP ID (or use CLI argument)
    let adpId = positional[0];

    if (adpId) {
      console.log(`📌 Using ADP ID from command line: ${adpId}`);
    } else {
      adpId = await prompt('🔑 Enter your ADP ID (UUID format): ');
    }

    // Validate format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(adpId)) {
      console.error('\n❌ Invalid ADP ID format. Expected a UUID like:');
      console.error('   955b20d5-8417-4a3d-88f6-05d72eec18aa');
      process.exit(1);
    }

    // Step 2: Fetch ADP status
    console.log('\n📡 Checking ADP status...');
    const adpData = await fetchAdpStatus(adpId);

    console.log(`   Status: ${adpData.status}`);
    console.log(`   Created: ${adpData.created}`);

    if (adpData.status !== 'success') {
      console.error(`\n❌ ADP is not ready yet. Current status: ${adpData.status}`);
      console.error('   Please wait for processing to complete and try again.');
      process.exit(1);
    }

    if (!adpData.downloadURL) {
      console.error('\n❌ No download URL available. The ADP may still be processing.');
      process.exit(1);
    }

    if (adpData.downloadExpired) {
      console.error('\n❌ Download URL has expired.');
      console.error(`   Expiration was: ${adpData.downloadExpiration}`);
      console.error('   Please request a new ADP from App Store Connect.');
      process.exit(1);
    }

    console.log(`   Download expires: ${adpData.downloadExpiration}`);

    // Step 3: Download and extract
    const releaseDir = await downloadAndExtract(adpData.downloadURL, adpId);

    // Step 4: Parse manifest
    console.log('\n📋 Reading version info...');
    const manifestData = parseManifest(releaseDir);
    console.log(`   Version: ${manifestData.version}`);
    console.log(`   Build: ${manifestData.buildVersion}`);
    console.log(`   Min iOS: ${manifestData.minOSVersion}`);

    if (!DOWNLOAD_ONLY) {
      // Step 5: Update altstore-source.json
      console.log('\n📝 Updating Freedom Store listing...');
      updateAltstoreSource(adpId, manifestData);

      // Step 6: Sync screenshots (optional)
      if (SYNC_SCREENSHOTS) {
        await syncScreenshots(manifestData.version);
      }
    }

    // Summary
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    ✅ ${DOWNLOAD_ONLY ? 'Download' : 'Sync'} Complete!${DOWNLOAD_ONLY ? ' '.repeat(23) : ' '.repeat(26)}║
╠═══════════════════════════════════════════════════════════╣
║  Version: ${(manifestData.version + ' (build ' + manifestData.buildVersion + ')').padEnd(45)}║
║  ADP ID: ${adpId.padEnd(46)}║
║  Download URL: sovran.money/ios/releases/${adpId.slice(0, 8)}...  ║${!DOWNLOAD_ONLY && SYNC_SCREENSHOTS ? '\n║  Screenshots: synced from App Store Connect' + ' '.repeat(12) + '║' : ''}
╠═══════════════════════════════════════════════════════════╣
║  📋 Next Steps:                                           ║
║  1. Commit all changes                                    ║
║  2. Push to deploy sovran.money and freedomstore          ║
║  3. Your app will be available on Freedom Store!          ║
╚═══════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  } finally {
    closeReadline();
  }
}

main();
