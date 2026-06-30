/**
 * altstore-source.json reader/mutator.
 *
 * The previous implementation edited this file with regexes, which silently
 * corrupted a sibling version's downloadURL on re-runs (because `downloadURL`
 * precedes `version` in each object). Here we treat the file as data: parse,
 * mutate the object, and re-serialize. The mutation helpers are pure.
 */

import fs from 'fs';

import { BUNDLE_ID, APP_ID, APP_DEFAULTS, SOVRAN_MONEY_BASE } from '../release.config.mjs';

/** Canonical download URL for an ADP. Pure. */
export function downloadUrlFor(adpId) {
  return `${SOVRAN_MONEY_BASE}/ios/releases/${adpId}/`;
}

/** Find the app entry for a bundle id. Pure. */
export function findApp(data, bundleId = BUNDLE_ID) {
  return (data.apps ?? []).find((a) => a.bundleIdentifier === bundleId) ?? null;
}

/** Ensure the Sovran app entry exists, creating a minimal one if absent. Pure. */
export function ensureApp(data, bundleId = BUNDLE_ID) {
  let app = findApp(data, bundleId);
  if (app) return app;
  app = {
    ...APP_DEFAULTS,
    bundleIdentifier: bundleId,
    marketplaceID: APP_ID,
    developerName: APP_DEFAULTS.name,
    screenshots: [],
    versions: [],
  };
  data.apps = data.apps ?? [];
  data.apps.push(app);
  return app;
}

/**
 * Insert or update a version on the Sovran app, keyed by version+build.
 *
 * - Existing version+build → update downloadURL/date/size/minOSVersion in place
 *   (this is the case the old regex broke).
 * - New version → prepend so newest is first.
 *
 * Mutates and returns `data`. Pure (no IO).
 */
export function upsertVersion(data, { adpId, version, buildVersion, date, minOSVersion, size }) {
  const app = ensureApp(data);
  const entry = {
    downloadURL: downloadUrlFor(adpId),
    size,
    version,
    buildVersion,
    date,
    localizedDescription: null,
    minOSVersion,
  };

  app.versions = app.versions ?? [];
  const idx = app.versions.findIndex(
    (v) => v.version === version && String(v.buildVersion) === String(buildVersion)
  );

  if (idx !== -1) {
    const existing = app.versions[idx];
    existing.downloadURL = entry.downloadURL;
    existing.date = date;
    existing.minOSVersion = minOSVersion;
    if (size != null) existing.size = size;
  } else {
    app.versions.unshift(entry);
  }
  return data;
}

/** Replace the Sovran app's screenshots array. Mutates and returns `data`. Pure. */
export function setScreenshots(data, urls) {
  const app = ensureApp(data);
  app.screenshots = [...urls];
  return data;
}

/** Every ADP id referenced by any Sovran version downloadURL. Pure. */
export function referencedAdpIds(data) {
  const app = findApp(data);
  if (!app) return [];
  return (app.versions ?? [])
    .map((v) => /\/releases\/([^/]+)\//.exec(v.downloadURL || '')?.[1])
    .filter(Boolean);
}

/** Serialize to the canonical on-disk form (2-space, trailing newline). Pure. */
export function serialize(data) {
  return JSON.stringify(data, null, 2) + '\n';
}

export function readSource(sourcePath) {
  return JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
}

export function writeSource(sourcePath, data) {
  fs.writeFileSync(sourcePath, serialize(data));
}
