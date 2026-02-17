#!/usr/bin/env node

/**
 * Sync Screenshots Script
 *
 * Downloads screenshots from App Store Connect and syncs them to sovran.money
 * for use in the AltStore/Freedom Store listing.
 *
 * Usage:
 *   node scripts/sync-screenshots.mjs
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Paths
const SOVRAN_IOS_DIR = path.join(ROOT_DIR, 'sovran.money/public/ios');
const ALTSTORE_SOURCE_PATH = path.join(ROOT_DIR, 'freedomstore/altstore-source.json');
const SCREENSHOTS_TS_PATH = path.join(ROOT_DIR, 'sovran.money/src/screenshots.ts');
const SOVRAN_BUNDLE_ID = 'com.sovranbitcoin';
const PREFERRED_LOCALES = ['en-US', 'en-GB'];

// Load .env file
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

const ISSUER_ID = process.env.ASC_ISSUER_ID;
const KEY_ID = process.env.ASC_KEY_ID;
const PRIVATE_KEY = process.env.ASC_PRIVATE_KEY;
const APP_ID = '6499554529';
const API_BASE = 'https://api.appstoreconnect.apple.com/v1';

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

function generateToken() {
  if (!ISSUER_ID || !KEY_ID || !PRIVATE_KEY) {
    console.error('\n❌ Missing App Store Connect credentials in .env file');
    console.error('   Required: ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY\n');
    process.exit(1);
  }

  return jwt.sign(
    {
      iss: ISSUER_ID,
      aud: 'appstoreconnect-v1',
      exp: Math.floor(Date.now() / 1000) + 15 * 60,
    },
    PRIVATE_KEY,
    { algorithm: 'ES256', header: { kid: KEY_ID } }
  );
}

async function apiRequest(endpoint) {
  const token = generateToken();
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
}

async function getAppVersions() {
  const data = await apiRequest(`/apps/${APP_ID}/appStoreVersions`);
  return data.data;
}

async function getVersionLocalizations(versionId) {
  const data = await apiRequest(`/appStoreVersions/${versionId}/appStoreVersionLocalizations`);
  return data.data;
}

async function getScreenshotSets(localizationId) {
  const data = await apiRequest(
    `/appStoreVersionLocalizations/${localizationId}/appScreenshotSets`
  );
  return data.data;
}

async function getScreenshots(screenshotSetId) {
  const data = await apiRequest(`/appScreenshotSets/${screenshotSetId}/appScreenshots`);
  return data.data;
}

function updateAltstoreScreenshots(screenshotUrls) {
  const fileContent = fs.readFileSync(ALTSTORE_SOURCE_PATH, 'utf-8');
  const sovranPattern =
    /("bundleIdentifier":\s*"com\.sovranbitcoin"[\s\S]*?"screenshots":\s*)\[[\s\S]*?\](\s*,\s*"versions":\s*\[)/;
  const match = fileContent.match(sovranPattern);

  if (!match) {
    throw new Error('Could not find Sovran screenshots array in altstore-source.json');
  }

  const screenshotsBlock =
    '[\n' + screenshotUrls.map((url) => `        "${url}"`).join(',\n') + '\n      ]';

  const newContent = fileContent.replace(sovranPattern, `$1${screenshotsBlock}$2`);
  fs.writeFileSync(ALTSTORE_SOURCE_PATH, newContent);
}

function normalizeDate(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
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

  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function sortVersionsNewestFirst(versions) {
  return [...versions].sort((a, b) => {
    const byVersion = compareVersionStrings(
      b.attributes?.versionString,
      a.attributes?.versionString
    );
    if (byVersion !== 0) {
      return byVersion;
    }

    const dateA = normalizeDate(a.attributes?.releaseDate || a.attributes?.createdDate);
    const dateB = normalizeDate(b.attributes?.releaseDate || b.attributes?.createdDate);
    return dateB - dateA;
  });
}

function sortScreenshotsForListing(screenshots) {
  const hasSortOrder = screenshots.some((shot) => Number.isFinite(shot.attributes?.sortOrder));
  if (!hasSortOrder) {
    return screenshots;
  }

  return [...screenshots].sort(
    (a, b) =>
      (a.attributes?.sortOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.attributes?.sortOrder ?? Number.MAX_SAFE_INTEGER)
  );
}

function generateScreenshotsTs(deviceScreenshots, primaryDevice) {
  const primaryUrls = deviceScreenshots[primaryDevice] || [];

  // Convert full URLs to relative paths
  const toRelativePath = (url) => url.replace('https://sovran.money', '');

  const lines = [
    '/**',
    ' * Screenshot URLs for Sovran',
    ' * ',
    ' * This file is auto-generated by scripts/sync-screenshots.mjs',
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

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           📸 Sovran Screenshot Sync Tool                  ║
╠═══════════════════════════════════════════════════════════╣
║  This tool syncs App Store screenshots to sovran.money    ║
║  and updates the Freedom Store listing.                   ║
╚═══════════════════════════════════════════════════════════╝
`);

  try {
    // Step 1: Fetch available versions
    console.log('📡 Fetching app versions from App Store Connect...\n');
    const versions = sortVersionsNewestFirst(await getAppVersions());

    console.log('Available versions:');
    versions.slice(0, 5).forEach((v, i) => {
      const state = v.attributes.appStoreState;
      const stateIcon = state === 'READY_FOR_SALE' ? '✅' : state.includes('PENDING') ? '⏳' : '📝';
      console.log(`  ${i + 1}. ${v.attributes.versionString} ${stateIcon} (${state})`);
    });
    if (versions.length > 5) {
      console.log(`  ... and ${versions.length - 5} more`);
    }

    // Step 2: Ask which version to sync (or use CLI argument)
    const defaultVersion = versions[0]?.attributes?.versionString;
    if (!defaultVersion) {
      throw new Error('No app versions returned from App Store Connect');
    }
    const cliVersion = process.argv[2];

    let selectedVersionString;
    if (cliVersion) {
      selectedVersionString = cliVersion;
      console.log(`\n📌 Using version from command line: ${cliVersion}`);
    } else {
      const versionInput = await prompt(`\n📌 Which version to sync? [${defaultVersion}]: `);
      selectedVersionString = versionInput || defaultVersion;
    }

    const selectedVersion = versions.find(
      (v) => v.attributes.versionString === selectedVersionString
    );
    if (!selectedVersion) {
      console.error(`\n❌ Version ${selectedVersionString} not found`);
      process.exit(1);
    }

    console.log(`\n✓ Selected version: ${selectedVersionString}`);

    // Step 3: Fetch screenshots
    console.log('\n📥 Fetching screenshots...');
    const localizations = await getVersionLocalizations(selectedVersion.id);

    if (localizations.length === 0) {
      console.error('❌ No localizations found for this version');
      process.exit(1);
    }

    const localization =
      localizations.find((loc) => PREFERRED_LOCALES.includes(loc.attributes.locale)) ||
      localizations[0];
    console.log(`   Locale: ${localization.attributes.locale}`);

    const screenshotSets = await getScreenshotSets(localization.id);

    // Filter to iPhone screenshot sets only
    const iphoneSets = screenshotSets.filter((s) =>
      s.attributes.screenshotDisplayType.startsWith('APP_IPHONE')
    );

    if (iphoneSets.length === 0) {
      console.error('❌ No iPhone screenshot sets found');
      process.exit(1);
    }

    console.log(`   Found ${iphoneSets.length} iPhone screenshot set(s)`);

    // Step 4: Download all screenshots organized by device type
    console.log(`\n📂 Downloading to ${SOVRAN_IOS_DIR}/...\n`);

    let totalScreenshots = 0;
    const deviceScreenshots = {}; // { deviceType: [urls] }

    // Device type display names for nicer output
    const deviceNames = {
      APP_IPHONE_67: 'iPhone 6.7" (14/15/16 Pro Max)',
      APP_IPHONE_65: 'iPhone 6.5" (11/XS Max)',
      APP_IPHONE_55: 'iPhone 5.5" (8 Plus)',
      APP_IPHONE_61: 'iPhone 6.1" (14/15)',
      APP_IPHONE_58: 'iPhone 5.8" (X/XS/11 Pro)',
    };

    for (const screenshotSet of iphoneSets) {
      const deviceType = screenshotSet.attributes.screenshotDisplayType;
      const deviceName = deviceNames[deviceType] || deviceType;

      const screenshots = sortScreenshotsForListing(await getScreenshots(screenshotSet.id));

      if (screenshots.length === 0) {
        continue;
      }

      console.log(`   📱 ${deviceName}: ${screenshots.length} screenshots`);

      // Reset folder so only latest selected-version screenshots are listed
      const deviceDir = path.join(SOVRAN_IOS_DIR, deviceType);
      fs.rmSync(deviceDir, { recursive: true, force: true });
      fs.mkdirSync(deviceDir, { recursive: true });

      deviceScreenshots[deviceType] = [];

      for (const screenshot of screenshots) {
        const imageAsset = screenshot.attributes.imageAsset;

        if (!imageAsset?.templateUrl) {
          console.log(`      ⚠️  Screenshot has no image URL, skipping`);
          continue;
        }

        const width = imageAsset.width;
        const height = imageAsset.height;
        const finalUrl = imageAsset.templateUrl
          .replace('{w}', width)
          .replace('{h}', height)
          .replace('{f}', 'png');

        // Use the screenshot ID as filename (it's Apple's unique identifier)
        const filename = `${screenshot.id}.png`;
        const outputPath = path.join(deviceDir, filename);

        console.log(`      ⬇️  ${filename}`);
        await downloadFile(finalUrl, outputPath);

        const publicUrl = `https://sovran.money/ios/${deviceType}/${filename}`;
        deviceScreenshots[deviceType].push(publicUrl);
        totalScreenshots++;
      }
    }

    // Step 5: Update altstore-source.json and screenshots.ts
    console.log('\n📝 Updating configuration files...');

    const primaryDevice = Object.keys(deviceScreenshots)[0] || null;
    const listingUrls = primaryDevice ? deviceScreenshots[primaryDevice] : [];

    if (listingUrls.length > 0) {
      // Update altstore-source.json
      updateAltstoreScreenshots(listingUrls);
      console.log(
        `   ✓ altstore-source.json updated (${listingUrls.length} ${primaryDevice} screenshots)`
      );

      // Update screenshots.ts
      generateScreenshotsTs(deviceScreenshots, primaryDevice);
      console.log(
        `   ✓ screenshots.ts updated (${Object.keys(deviceScreenshots).length} device types)`
      );
    }

    // Summary
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    ✅ Sync Complete!                      ║
╠═══════════════════════════════════════════════════════════╣
║  Total screenshots: ${String(totalScreenshots).padEnd(36)}║
║  Device types: ${String(Object.keys(deviceScreenshots).length).padEnd(41)}║
║  Source: App Store Connect v${selectedVersionString.padEnd(27)}║
╠═══════════════════════════════════════════════════════════╣
║  📁 Files updated:                                        ║
║  • sovran.money/public/ios/<device>/*.png                 ║
║  • sovran.money/src/screenshots.ts                        ║
║  • freedomstore/altstore-source.json                      ║
╠═══════════════════════════════════════════════════════════╣
║  📋 Next Steps:                                           ║
║  1. Review the screenshots in sovran.money/public/ios/    ║
║  2. Commit and push the changes                           ║
║  3. Run sync-altstore.mjs to add the new app version      ║
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
