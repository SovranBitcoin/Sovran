import { test, expect, describe } from 'bun:test';

import { selectPruneTargets, pickPrimaryDevice } from '../screenshots.mjs';

describe('selectPruneTargets', () => {
  const base = {
    referencedAdpIds: ['keep-adp'],
    releaseDirs: [
      { name: 'keep-adp', path: '/r/keep-adp' },
      { name: 'stale-adp', path: '/r/stale-adp' },
    ],
    screenshotFiles: [
      { device: 'APP_IPHONE_65', file: 'a.png', path: '/s/65/a.png' },
      { device: 'APP_IPHONE_65', file: 'orphan.png', path: '/s/65/orphan.png' },
    ],
    orderByDevice: { APP_IPHONE_65: ['a.png'] },
    previewFiles: [
      { version: '0.1.0', path: '/p/preview-0.1.0.png' },
      { version: '0.0.1', path: '/p/preview-0.0.1.png' },
    ],
    listedVersions: ['0.1.0'],
  };

  test('removes only unreferenced release dirs', () => {
    expect(selectPruneTargets(base).releaseDirs).toEqual(['/r/stale-adp']);
  });

  test('removes only screenshots not in order.json', () => {
    expect(selectPruneTargets(base).screenshots).toEqual(['/s/65/orphan.png']);
  });

  test('removes only previews for unlisted versions', () => {
    expect(selectPruneTargets(base).previews).toEqual(['/p/preview-0.0.1.png']);
  });

  test('keeps everything when all assets are referenced', () => {
    const kept = selectPruneTargets({
      ...base,
      releaseDirs: [{ name: 'keep-adp', path: '/r/keep-adp' }],
      screenshotFiles: [{ device: 'APP_IPHONE_65', file: 'a.png', path: '/s/65/a.png' }],
      previewFiles: [{ version: '0.1.0', path: '/p/preview-0.1.0.png' }],
    });
    expect(kept.releaseDirs).toEqual([]);
    expect(kept.screenshots).toEqual([]);
    expect(kept.previews).toEqual([]);
  });
});

describe('pickPrimaryDevice', () => {
  test('prefers the highest-preference device present', () => {
    expect(pickPrimaryDevice({ APP_IPHONE_55: [], APP_IPHONE_65: [] })).toBe('APP_IPHONE_65');
  });
  test('returns null when none present', () => {
    expect(pickPrimaryDevice({})).toBeNull();
  });
});
