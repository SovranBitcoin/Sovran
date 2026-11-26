/**
 * @jest-environment node
 */

import {
  buildModalProfileHref,
  buildProfileHref,
  isSheetEntry,
} from '@/shared/lib/nav/profileRoutes';

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
}));

describe('profile route helpers', () => {
  it('opens a profile as a pushed page by default', () => {
    expect(buildProfileHref('profile', { pubkey: 'a'.repeat(64) })).toEqual({
      pathname: '/profile',
      params: { pubkey: 'a'.repeat(64) },
    });
    expect(isSheetEntry({ pubkey: 'a'.repeat(64) })).toBe(false);
  });

  it('keeps a profile opened from a sheet a sheet, page after page', () => {
    const href = buildProfileHref('profile', { npub: 'npub1abc' }, 'sheet');
    expect(href).toEqual({ pathname: '/profile', params: { npub: 'npub1abc', entry: 'sheet' } });
    expect(isSheetEntry(href.params)).toBe(true);
  });

  it('builds sheet-entry profile hrefs for scanner and modal contexts', () => {
    expect(buildModalProfileHref({ npub: 'npub1abc' })).toEqual({
      pathname: '/profile',
      params: { npub: 'npub1abc', entry: 'sheet' },
    });
  });

  it('reads only the exact sheet marker', () => {
    for (const params of [undefined, null, 'sheet', { entry: 'page' }, { entry: ['sheet'] }]) {
      expect(isSheetEntry(params)).toBe(false);
    }
  });
});
