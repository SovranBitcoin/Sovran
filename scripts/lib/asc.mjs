/**
 * App Store Connect (ASC) API client.
 *
 * Builds an ES256 JWT from the API key in the environment (no jsonwebtoken
 * dependency — uses Node's crypto) and exposes the screenshot listing for a
 * given app-store version. Pure sort/compare helpers are exported for testing.
 */

import crypto from 'crypto';

import { ASC_API_BASE, APP_ID, PREFERRED_LOCALES, DEVICE_NAMES } from '../release.config.mjs';

/** Compare two dotted/segmented version strings numerically. Pure. */
export function compareVersionStrings(a, b) {
  const split = (v) =>
    String(v ?? '')
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map(Number);
  const left = split(a);
  const right = split(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l - r;
  }
  return 0;
}

/** Newest-version-first ordering for ASC appStoreVersions. Pure. */
export function sortVersionsNewestFirst(versions) {
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

/** Order screenshots within a set by ASC sortOrder when present. Pure. */
export function sortScreenshotsForListing(screenshots) {
  const hasSortOrder = screenshots.some((s) => Number.isFinite(s.attributes?.sortOrder));
  if (!hasSortOrder) return screenshots;
  return [...screenshots].sort(
    (a, b) =>
      (a.attributes?.sortOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.attributes?.sortOrder ?? Number.MAX_SAFE_INTEGER)
  );
}

/** Build the final asset URL from an ASC imageAsset template. Pure. */
export function resolveImageUrl(imageAsset) {
  if (!imageAsset?.templateUrl) return null;
  return imageAsset.templateUrl
    .replace('{w}', imageAsset.width)
    .replace('{h}', imageAsset.height)
    .replace('{f}', 'png');
}

/**
 * Create an ASC client bound to the given credentials. `nowSeconds` is injectable
 * for testing; defaults to the real clock.
 */
export function createAscClient(
  { issuerId, keyId, privateKey },
  nowSeconds = () => Math.floor(Date.now() / 1000)
) {
  if (!issuerId || !keyId || !privateKey) {
    throw new Error(
      'Missing App Store Connect credentials (ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY in sovran-app/.env).'
    );
  }

  const token = () => {
    const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const header = b64url({ alg: 'ES256', kid: keyId, typ: 'JWT' });
    const payload = b64url({
      iss: issuerId,
      aud: 'appstoreconnect-v1',
      exp: nowSeconds() + 15 * 60,
    });
    const signature = crypto
      .sign('SHA256', Buffer.from(`${header}.${payload}`), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      })
      .toString('base64url');
    return `${header}.${payload}.${signature}`;
  };

  const request = async (endpoint) => {
    const url = endpoint.startsWith('http') ? endpoint : `${ASC_API_BASE}${endpoint}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok)
      throw new Error(`ASC request failed: ${res.status} ${res.statusText} (${endpoint})`);
    return res.json();
  };

  /**
   * List iPhone screenshots for an app-store version.
   * @returns {Promise<{ version: string, locale: string, devices: Record<string, {id,url}[]> } | null>}
   */
  const listScreenshots = async (versionString) => {
    const versionsData = await request(`/apps/${APP_ID}/appStoreVersions`);
    const versions = sortVersionsNewestFirst(versionsData.data);
    const target = versionString
      ? versions.find((v) => v.attributes.versionString === versionString)
      : versions[0];
    if (!target) return null;

    const locData = await request(`/appStoreVersions/${target.id}/appStoreVersionLocalizations`);
    const localization =
      locData.data.find((loc) => PREFERRED_LOCALES.includes(loc.attributes.locale)) ||
      locData.data[0];
    if (!localization) return null;

    const setsData = await request(
      `/appStoreVersionLocalizations/${localization.id}/appScreenshotSets`
    );
    const iphoneSets = setsData.data.filter((s) =>
      s.attributes.screenshotDisplayType.startsWith('APP_IPHONE')
    );

    const devices = {};
    for (const set of iphoneSets) {
      const deviceType = set.attributes.screenshotDisplayType;
      const shotsData = await request(`/appScreenshotSets/${set.id}/appScreenshots`);
      const shots = sortScreenshotsForListing(shotsData.data);
      const resolved = shots
        .map((s) => ({ id: s.id, url: resolveImageUrl(s.attributes.imageAsset) }))
        .filter((s) => s.url);
      if (resolved.length) devices[deviceType] = resolved;
    }

    return {
      version: target.attributes.versionString,
      locale: localization.attributes.locale,
      devices,
    };
  };

  return { token, request, listScreenshots, deviceName: (t) => DEVICE_NAMES[t] || t };
}
