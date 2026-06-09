import { test, expect, describe } from 'bun:test';

import {
  upsertVersion,
  setScreenshots,
  referencedAdpIds,
  downloadUrlFor,
  serialize,
  ensureApp,
} from '../altstore-json.mjs';

const sovran = (versions = []) => ({
  apps: [
    { name: 'Other', bundleIdentifier: 'it.other', versions: [], screenshots: [] },
    { name: 'Sovran', bundleIdentifier: 'com.sovranbitcoin', versions, screenshots: [] },
  ],
});

describe('upsertVersion', () => {
  test('prepends a new version newest-first', () => {
    const data = sovran([
      {
        downloadURL: downloadUrlFor('old-adp'),
        version: '0.0.62',
        buildVersion: '121',
        date: '2026-04-12',
      },
    ]);
    upsertVersion(data, {
      adpId: 'new-adp',
      version: '0.1.0',
      buildVersion: '169',
      date: '2026-06-09',
      minOSVersion: '16.4',
      size: 42,
    });
    const v = data.apps[1].versions;
    expect(v[0].version).toBe('0.1.0');
    expect(v[0].downloadURL).toBe(downloadUrlFor('new-adp'));
    expect(v[0].size).toBe(42);
    expect(v.length).toBe(2);
  });

  // Direct regression for the regex bug that overwrote 0.0.62's downloadURL.
  test('updating an existing version does NOT touch sibling versions', () => {
    const data = sovran([
      {
        downloadURL: downloadUrlFor('adp-0.1.0'),
        size: 1,
        version: '0.1.0',
        buildVersion: '169',
        date: '2026-06-09',
        minOSVersion: '16.4',
      },
      {
        downloadURL: downloadUrlFor('adp-0.0.62'),
        size: 1,
        version: '0.0.62',
        buildVersion: '121',
        date: '2026-04-12',
        minOSVersion: '15.1',
      },
    ]);
    // Re-run for 0.1.0 with a corrected ADP — the screenshot-refresh scenario.
    upsertVersion(data, {
      adpId: 'adp-0.1.0-fixed',
      version: '0.1.0',
      buildVersion: '169',
      date: '2026-06-10',
      minOSVersion: '16.4',
      size: 99,
    });
    const [a, b] = data.apps[1].versions;
    expect(a.version).toBe('0.1.0');
    expect(a.downloadURL).toBe(downloadUrlFor('adp-0.1.0-fixed'));
    expect(a.size).toBe(99);
    // The sibling must be untouched.
    expect(b.version).toBe('0.0.62');
    expect(b.downloadURL).toBe(downloadUrlFor('adp-0.0.62'));
    expect(data.apps[1].versions.length).toBe(2);
  });

  test('matches on version AND build (same version, new build prepends)', () => {
    const data = sovran([
      { downloadURL: downloadUrlFor('a'), version: '0.1.0', buildVersion: '169', date: 'x' },
    ]);
    upsertVersion(data, {
      adpId: 'b',
      version: '0.1.0',
      buildVersion: '170',
      date: 'y',
      minOSVersion: '16.4',
      size: 1,
    });
    expect(data.apps[1].versions.length).toBe(2);
    expect(data.apps[1].versions[0].buildVersion).toBe('170');
  });

  test('creates the Sovran app entry when missing', () => {
    const data = {
      apps: [{ name: 'Other', bundleIdentifier: 'it.other', versions: [], screenshots: [] }],
    };
    upsertVersion(data, {
      adpId: 'a',
      version: '0.1.0',
      buildVersion: '1',
      date: 'd',
      minOSVersion: '16.4',
      size: 1,
    });
    const app = data.apps.find((x) => x.bundleIdentifier === 'com.sovranbitcoin');
    expect(app).toBeTruthy();
    expect(app.versions[0].version).toBe('0.1.0');
  });
});

describe('setScreenshots / referencedAdpIds / serialize', () => {
  test('setScreenshots replaces the array', () => {
    const data = sovran();
    setScreenshots(data, ['u1', 'u2']);
    expect(data.apps[1].screenshots).toEqual(['u1', 'u2']);
  });

  test('referencedAdpIds extracts distinct ids', () => {
    const data = sovran([
      { downloadURL: downloadUrlFor('id-a'), version: '2', buildVersion: '2' },
      { downloadURL: downloadUrlFor('id-b'), version: '1', buildVersion: '1' },
    ]);
    expect(referencedAdpIds(data)).toEqual(['id-a', 'id-b']);
  });

  test('serialize round-trips to an equal object with trailing newline', () => {
    const data = sovran([{ downloadURL: downloadUrlFor('a'), version: '1', buildVersion: '1' }]);
    const text = serialize(data);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(data);
  });

  test('ensureApp is idempotent', () => {
    const data = sovran();
    const first = ensureApp(data);
    const second = ensureApp(data);
    expect(first).toBe(second);
    expect(data.apps.filter((a) => a.bundleIdentifier === 'com.sovranbitcoin').length).toBe(1);
  });
});
