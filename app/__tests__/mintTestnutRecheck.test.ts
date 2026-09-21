/* eslint-disable import/first */
/**
 * @jest-environment node
 *
 * A mint nagg has not probed must be re-asked soon, not once a day.
 *
 * `applyMintInfos` stamps `checkedAt` even for a row with no `probedAt`, so the
 * row reads as "checked" while its `testnut: false` is a DEFAULT, not a verdict.
 * Re-asking on the answered clock left such a mint counted as real for 24 h, and
 * every account-scoped decision trusted it: a captured session offered
 * "as Onchain" for 1 sat because the only mint that could serve it was an
 * unclassified testnut, then dropped it the moment a discovery call answered.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

import { needsCheck } from '@/shared/lib/mintTestnutRefresh';
import { isTestnutMint, useMintTestnutStore } from '@/shared/stores/global/mintTestnutStore';

const MINT = 'https://mint.example.com';
const HOUR = 60 * 60 * 1000;

beforeEach(() => useMintTestnutStore.setState({ byMintUrl: {} }));

describe('testnut verdict re-check', () => {
  it('re-asks an unprobed mint well inside the answered clock', () => {
    useMintTestnutStore.getState().applyMintInfos([{ mintUrl: MINT, testnut: false }] as never);
    const checkedAt = Date.now();
    expect(needsCheck(MINT, checkedAt + 60_000)).toBe(false); // just asked
    expect(needsCheck(MINT, checkedAt + HOUR)).toBe(true); // an hour on: ask again
  });

  it('holds an answered verdict for the full day', () => {
    useMintTestnutStore
      .getState()
      .applyMintInfos([
        { mintUrl: MINT, testnut: true, probedAt: Math.floor(Date.now() / 1000) },
      ] as never);
    const checkedAt = Date.now();
    expect(needsCheck(MINT, checkedAt + 12 * HOUR)).toBe(false);
    expect(needsCheck(MINT, checkedAt + 25 * HOUR)).toBe(true);
  });

  it('always asks about a mint it has never seen', () => {
    expect(needsCheck('https://unknown.example.com', Date.now())).toBe(true);
  });

  it('keeps the verdict itself untouched by the re-check rule', () => {
    useMintTestnutStore
      .getState()
      .applyMintInfos([
        { mintUrl: MINT, testnut: true, probedAt: Math.floor(Date.now() / 1000) },
      ] as never);
    // An unprobed answer must never clear a verdict already established.
    useMintTestnutStore.getState().applyMintInfos([{ mintUrl: MINT, testnut: false }] as never);
    expect(isTestnutMint(MINT)).toBe(true);
  });
});
