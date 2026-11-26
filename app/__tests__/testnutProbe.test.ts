/* eslint-disable import/first */
/**
 * @jest-environment node
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockFetchJson = jest.fn();
jest.mock('@/shared/lib/apiClient', () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

import { err } from 'neverthrow';
import { isKnownTestnutHost, probeMintTestnut } from '@/shared/lib/cashu/testnutProbe';
import { isTestnutMint, useMintTestnutStore } from '@/shared/stores/global/mintTestnutStore';

beforeEach(() => {
  mockFetchJson.mockReset();
  useMintTestnutStore.setState({ byMintUrl: {} });
});

describe('isKnownTestnutHost', () => {
  it('recognizes canonical testnut hosts immediately without network calls', () => {
    expect(isKnownTestnutHost('https://testnut.cashu.space')).toBe(true);
    expect(isKnownTestnutHost('https://nofees.testnut.cashu.space/')).toBe(true);
    expect(isKnownTestnutHost('https://mint.minibits.cash/Bitcoin')).toBe(false);
    expect(isTestnutMint('https://testnut.cashu.space')).toBe(true);
    expect(isTestnutMint('https://mint.minibits.cash/Bitcoin')).toBe(false);
  });
});

describe('probeMintTestnut', () => {
  it('returns true immediately for known testnut hosts without fetching', async () => {
    await expect(probeMintTestnut('https://testnut.cashu.space')).resolves.toBe(true);
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('detects a fake-wallet mint whose unpaid quote transitions from UNPAID to PAID', async () => {
    mockFetchJson
      .mockImplementationOnce(async (_url, parse) =>
        parse({
          keysets: [
            { id: '01usd', unit: 'usd', active: true },
            { id: '01sat', unit: 'sat', active: true },
          ],
        })
      )
      .mockImplementationOnce(async (_url, parse) => parse({ quote: 'q-123', state: 'UNPAID' }))
      .mockImplementationOnce(async (_url, parse) => parse({ quote: 'q-123', state: 'PAID' }));

    await expect(
      probeMintTestnut('https://custom-fake.example.com/', { delayMs: 0 })
    ).resolves.toBe(true);
    expect(mockFetchJson).toHaveBeenCalledTimes(3);
    expect(mockFetchJson.mock.calls[1][0]).toBe(
      'https://custom-fake.example.com/v1/mint/quote/bolt11'
    );
    expect(mockFetchJson.mock.calls[2][0]).toBe(
      'https://custom-fake.example.com/v1/mint/quote/bolt11/q-123'
    );
  });

  it('classifies a real mainnet mint whose unpaid quote stays UNPAID as false', async () => {
    mockFetchJson
      .mockImplementationOnce(async (_url, parse) =>
        parse({ keysets: [{ id: '01usd', unit: 'usd', active: true }] })
      )
      .mockImplementationOnce(async (_url, parse) => parse({ quote: 'q-real', state: 'UNPAID' }))
      .mockImplementationOnce(async (_url, parse) => parse({ quote: 'q-real', state: 'UNPAID' }));

    await expect(probeMintTestnut('https://real-usd.example.com', { delayMs: 0 })).resolves.toBe(
      false
    );
    expect(JSON.parse((mockFetchJson.mock.calls[1][3] as { body: string }).body)).toEqual({
      amount: 1,
      unit: 'usd',
    });
  });

  it('returns null when the mint is unreachable so existing verdicts are preserved', async () => {
    mockFetchJson.mockResolvedValue(err(new Error('network down')));
    await expect(
      probeMintTestnut('https://offline.example.com', { delayMs: 0 })
    ).resolves.toBeNull();
  });
});
