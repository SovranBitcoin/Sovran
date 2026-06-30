/**
 * checkBlobExists: the BUD-01 HEAD existence probe used to verify a deletion
 * and disambiguate Primal's 404. 2xx→true, 404/410→false, anything else→null.
 */
/* eslint-disable import/first */

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({ __esModule: true, NDKEvent: class {} }), {
  virtual: true,
});
jest.mock('@/shared/lib/logger', () => ({
  __esModule: true,
  nostrLog: { info: jest.fn(), warn: jest.fn() },
}));

import { checkBlobExists } from '@/shared/lib/nostr/media/blossomClient';

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  // eslint-disable-next-line no-restricted-properties -- test stub for the HEAD probe
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe('checkBlobExists', () => {
  it('returns true when the blob is present (2xx)', async () => {
    mockFetch.mockResolvedValue({ status: 200 });
    expect(await checkBlobExists('https://b/x')).toBe(true);
  });

  it('returns false when gone (404)', async () => {
    mockFetch.mockResolvedValue({ status: 404 });
    expect(await checkBlobExists('https://b/x')).toBe(false);
  });

  it('returns null when indeterminate (5xx)', async () => {
    mockFetch.mockResolvedValue({ status: 500 });
    expect(await checkBlobExists('https://b/x')).toBeNull();
  });

  it('returns null on a network throw', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    expect(await checkBlobExists('https://b/x')).toBeNull();
  });
});
