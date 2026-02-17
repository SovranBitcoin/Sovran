#!/usr/bin/env node

/**
 * Sync AltStore Script
 *
 * Downloads an Alternative Distribution Package (ADP) from AltStore's API
 * and updates the Freedom Store listing with the new version.
 *
 * Usage:
 *   node scripts/sync-altstore.mjs
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Paths
const RELEASES_DIR = path.join(ROOT_DIR, 'sovran.money/public/ios/releases');
const ALTSTORE_SOURCE_PATH = path.join(ROOT_DIR, 'freedomstore/altstore-source.json');
const SOVRAN_BUNDLE_ID = 'com.sovranbitcoin';
const ALTSTORE_API_BASE = 'https://api.altstore.io/adps';

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
    console.log(`\n   📁 Release already exists, overwriting...`);
    fs.rmSync(outputDir, { recursive: true });
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

function updateAltstoreSource(adpId, manifestData) {
  const fileContent = fs.readFileSync(ALTSTORE_SOURCE_PATH, 'utf-8');
  const source = JSON.parse(fileContent);

  const sovranApp = source.apps.find((app) => app.bundleIdentifier === SOVRAN_BUNDLE_ID);
  if (!sovranApp) {
    throw new Error('Could not find Sovran in altstore-source.json');
  }

  // Check for existing version
  const existingIdx = sovranApp.versions.findIndex(
    (v) => v.version === manifestData.version && v.buildVersion === manifestData.buildVersion
  );

  if (existingIdx !== -1) {
    console.log(`   ⚠️  Version ${manifestData.version} already exists, updating...`);
    sovranApp.versions[existingIdx].downloadURL = `https://sovran.money/ios/releases/${adpId}/`;
    sovranApp.versions[existingIdx].date = new Date().toISOString().split('T')[0];
  } else {
    // Use surgical insert to avoid reformatting other apps
    const sovranPattern = /"bundleIdentifier":\s*"com\.sovranbitcoin"[\s\S]*?"versions":\s*\[/;
    const match = fileContent.match(sovranPattern);

    if (!match) {
      throw new Error('Could not find Sovran versions array');
    }

    const newVersion = {
      downloadURL: `https://sovran.money/ios/releases/${adpId}/`,
      size: 10000000,
      version: manifestData.version,
      buildVersion: manifestData.buildVersion,
      date: new Date().toISOString().split('T')[0],
      localizedDescription: null,
      minOSVersion: manifestData.minOSVersion,
    };

    const insertPosition = match.index + match[0].length;
    const versionJson = JSON.stringify(newVersion, null, 2)
      .split('\n')
      .map((line, i) => (i === 0 ? line : '        ' + line))
      .join('\n');

    const newContent =
      fileContent.slice(0, insertPosition) +
      '\n        ' +
      versionJson +
      ',' +
      fileContent.slice(insertPosition);

    fs.writeFileSync(ALTSTORE_SOURCE_PATH, newContent);
    console.log(`   ✓ Added new version to altstore-source.json`);
    return newVersion;
  }

  fs.writeFileSync(ALTSTORE_SOURCE_PATH, JSON.stringify(source, null, 2) + '\n');
  return sovranApp.versions[existingIdx];
}

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
    `   1. Go to: https://appstoreconnect.apple.com/apps/6499554529/distribution/activity/ios/versions`
  );
  console.log(`   2. Click on the version you want to distribute`);
  console.log(`   3. Find the "Alternative Distribution Package ID" in the details`);
  console.log(`   4. Copy the UUID (e.g., 955b20d5-8417-4a3d-88f6-05d72eec18aa)\n`);

  try {
    // Step 1: Get ADP ID (or use CLI argument)
    let adpId = process.argv[2];

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

    // Step 5: Update altstore-source.json
    console.log('\n📝 Updating Freedom Store listing...');
    const versionEntry = updateAltstoreSource(adpId, manifestData);

    // Summary
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    ✅ Sync Complete!                      ║
╠═══════════════════════════════════════════════════════════╣
║  Version: ${(manifestData.version + ' (build ' + manifestData.buildVersion + ')').padEnd(45)}║
║  ADP ID: ${adpId.padEnd(46)}║
║  Download URL: sovran.money/ios/releases/${adpId.slice(0, 8)}...  ║
╠═══════════════════════════════════════════════════════════╣
║  📋 Next Steps:                                           ║
║  1. Run sync-screenshots.mjs if you haven't already       ║
║  2. Commit all changes                                    ║
║  3. Push to deploy sovran.money and freedomstore          ║
║  4. Your app will be available on Freedom Store!          ║
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
