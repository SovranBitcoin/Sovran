/**
 * Alternative Distribution Package (ADP) helpers.
 *
 * An ADP is the iOS package Apple produces for alternative distribution. The
 * AltStore API exposes its processing status and a (time-limited) download URL.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { ALTSTORE_API_BASE } from '../release.config.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True if `id` looks like a UUID. Pure. */
export function isValidAdpId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Decide whether an ADP is ready to download from its API payload. Pure — no
 * network — so the gate logic is unit-testable.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function classifyAdp(adpData) {
  if (!adpData || typeof adpData !== 'object') {
    return { ok: false, reason: 'No ADP data returned from AltStore API.' };
  }
  if (adpData.status !== 'success') {
    return { ok: false, reason: `ADP is not ready (status: ${adpData.status ?? 'unknown'}).` };
  }
  if (adpData.downloadExpired) {
    return {
      ok: false,
      reason: `ADP download URL expired (${adpData.downloadExpiration ?? 'unknown date'}). Request a new ADP.`,
    };
  }
  if (!adpData.downloadURL) {
    return { ok: false, reason: 'ADP has no download URL (still processing?).' };
  }
  return { ok: true };
}

/** Fetch ADP status from the AltStore API. */
export async function fetchAdpStatus(adpId) {
  const res = await fetch(`${ALTSTORE_API_BASE}/${adpId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch ADP: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Download + extract an ADP zip into <releasesDir>/<adpId>/. Idempotent: skips
 * if a manifest is already present. Returns the release directory path.
 */
export function downloadAndExtract({ downloadUrl, adpId, releasesDir }) {
  const outputDir = path.join(releasesDir, adpId);
  const manifest = path.join(outputDir, 'manifest.json');
  if (fs.existsSync(manifest)) return outputDir;

  const zipPath = path.join(releasesDir, `${adpId}.zip`);
  fs.mkdirSync(outputDir, { recursive: true });
  execSync(`curl -fsSL -o "${zipPath}" "${downloadUrl}"`, { stdio: 'pipe' });
  execSync(`unzip -q -o "${zipPath}" -d "${outputDir}"`, { stdio: 'pipe' });
  fs.unlinkSync(zipPath);
  return outputDir;
}

/** Read version/build/minOS from a release's manifest.json. */
export function parseManifest(releaseDir) {
  const manifestPath = path.join(releaseDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${releaseDir}`);
  }
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return {
    bundleId: m.bundleId,
    version: m.shortVersionString,
    buildVersion: m.bundleVersion,
    minOSVersion: m.minimumSystemVersions?.ios || '15.1',
  };
}

/** Total byte size of a release directory's files (real download size). */
export function releaseSize(releaseDir) {
  let total = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  if (fs.existsSync(releaseDir)) walk(releaseDir);
  return total;
}
