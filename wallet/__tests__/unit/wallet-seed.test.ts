import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, it, vi } from 'vitest';

import {
  CashuSeedError,
  createCashuSeedGetter,
  deriveStandardCashuSeed,
  generateCashuMnemonic,
  isValidCashuMnemonic,
  normalizeCashuMnemonic,
  tryDeriveStandardCashuSeed,
} from '../../src/wallet-seed';

const VALID_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function testSeed(fill: number): Uint8Array {
  return new Uint8Array(64).fill(fill);
}

describe('wallet seed helpers', () => {
  it('generates a valid 12-word BIP-39 mnemonic by default', () => {
    const mnemonic = generateCashuMnemonic();

    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(isValidCashuMnemonic(mnemonic)).toBe(true);
  });

  it('normalizes whitespace and casing', () => {
    expect(normalizeCashuMnemonic(`  ${VALID_MNEMONIC.toUpperCase()}  `)).toBe(
      VALID_MNEMONIC,
    );
    expect(normalizeCashuMnemonic(' abandon   abandon\tabout\n')).toBe(
      'abandon abandon about',
    );
  });

  it('derives the standard Cashu seed from a normalized mnemonic', () => {
    const seed = deriveStandardCashuSeed(`  ${VALID_MNEMONIC.toUpperCase()}  `);
    const result = tryDeriveStandardCashuSeed(VALID_MNEMONIC);

    expect(seed).toEqual(mnemonicToSeedSync(VALID_MNEMONIC, ''));
    expect(seed).toHaveLength(64);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(seed);
    }
  });

  it('rejects missing and invalid mnemonics before derivation', () => {
    expect(() => deriveStandardCashuSeed('   ')).toThrow(CashuSeedError);
    expect(() => deriveStandardCashuSeed('abandon abandon abandon')).toThrow(
      CashuSeedError,
    );

    const result = tryDeriveStandardCashuSeed('abandon abandon abandon');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('INVALID_MNEMONIC');
    }
  });

  it('loads a cached seed before deriving and memoizes the result', async () => {
    const cachedSeed = testSeed(7);
    const load = vi.fn(async () => cachedSeed);
    const store = vi.fn();
    const deriveSeed = vi.fn(async () => testSeed(9));

    const getSeed = createCashuSeedGetter({
      getMnemonic: () => VALID_MNEMONIC,
      deriveSeed,
      cache: { load, store },
    });

    await expect(getSeed()).resolves.toEqual(cachedSeed);
    await expect(getSeed()).resolves.toEqual(cachedSeed);
    expect(load).toHaveBeenCalledTimes(1);
    expect(deriveSeed).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
  });

  it('derives on cache miss, stores once, and returns defensive copies', async () => {
    const derivedSeed = testSeed(11);
    const load = vi.fn(async () => null);
    const store = vi.fn();
    const deriveSeed = vi.fn(async () => derivedSeed);

    const getSeed = createCashuSeedGetter({
      getMnemonic: () => VALID_MNEMONIC,
      deriveSeed,
      cache: { load, store },
    });

    const first = await getSeed();
    const second = await getSeed();

    expect(first).toEqual(derivedSeed);
    expect(second).toEqual(derivedSeed);
    expect(first).not.toBe(second);
    expect(load).toHaveBeenCalledTimes(1);
    expect(deriveSeed).toHaveBeenCalledTimes(1);
    expect(deriveSeed).toHaveBeenCalledWith(VALID_MNEMONIC);
    expect(store).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledWith(derivedSeed, {
      mnemonic: VALID_MNEMONIC,
    });
  });

  it('supports app-owned custom derivation', async () => {
    const deriveSeed = vi.fn(async (mnemonic: string) => {
      expect(mnemonic).toBe(VALID_MNEMONIC);
      return testSeed(13);
    });

    const getSeed = createCashuSeedGetter({
      getMnemonic: () => ` ${VALID_MNEMONIC.toUpperCase()} `,
      deriveSeed,
    });

    await expect(getSeed()).resolves.toEqual(testSeed(13));
    expect(deriveSeed).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when cache or custom derivation returns the wrong shape', async () => {
    const getCachedSeed = createCashuSeedGetter({
      getMnemonic: () => VALID_MNEMONIC,
      cache: { load: () => new Uint8Array(32) },
    });
    const getDerivedSeed = createCashuSeedGetter({
      getMnemonic: () => VALID_MNEMONIC,
      deriveSeed: () => new Uint8Array(32),
    });

    await expect(getCachedSeed()).rejects.toMatchObject({
      code: 'INVALID_SEED',
    });
    await expect(getDerivedSeed()).rejects.toMatchObject({
      code: 'INVALID_SEED',
    });
  });
});
