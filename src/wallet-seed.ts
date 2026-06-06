import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { err, ok, type Result } from 'neverthrow';

export type CashuSeedErrorCode =
  | 'MISSING_MNEMONIC'
  | 'INVALID_MNEMONIC'
  | 'INVALID_SEED';

export class CashuSeedError extends Error {
  readonly code: CashuSeedErrorCode;

  constructor(code: CashuSeedErrorCode, message: string) {
    super(message);
    this.name = 'CashuSeedError';
    this.code = code;
  }
}

type MaybePromise<T> = T | Promise<T>;

export type CashuSeedResult = Result<Uint8Array, CashuSeedError>;

export interface CashuSeedCacheContext {
  /** Normalized BIP-39 mnemonic. Treat as secret material. */
  mnemonic: string;
}

export interface CashuSeedCache {
  load?: (
    context: CashuSeedCacheContext,
  ) => MaybePromise<Uint8Array | null | undefined>;
  store?: (
    seed: Uint8Array,
    context: CashuSeedCacheContext,
  ) => MaybePromise<void>;
}

export interface CreateCashuSeedGetterConfig {
  getMnemonic: () => MaybePromise<string | null | undefined>;
  deriveSeed?: (mnemonic: string) => MaybePromise<Uint8Array>;
  cache?: CashuSeedCache;
}

export interface GenerateCashuMnemonicOptions {
  strength?: number;
}

export interface DeriveStandardCashuSeedOptions {
  passphrase?: string;
}

export function normalizeCashuMnemonic(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

export function isValidCashuMnemonic(input: string): boolean {
  return validateMnemonic(normalizeCashuMnemonic(input), wordlist);
}

export function generateCashuMnemonic(
  options: GenerateCashuMnemonicOptions = {},
): string {
  return generateMnemonic(wordlist, options.strength ?? 128);
}

export function deriveStandardCashuSeed(
  input: string,
  options: DeriveStandardCashuSeedOptions = {},
): Uint8Array {
  return tryDeriveStandardCashuSeed(input, options).match(
    (seed) => seed,
    (error) => {
      throw error;
    },
  );
}

export function tryDeriveStandardCashuSeed(
  input: string,
  options: DeriveStandardCashuSeedOptions = {},
): CashuSeedResult {
  const mnemonic = normalizeCashuMnemonic(input);
  if (!mnemonic) {
    return err(
      new CashuSeedError('MISSING_MNEMONIC', 'Cashu mnemonic is required'),
    );
  }
  if (!validateMnemonic(mnemonic, wordlist)) {
    return err(
      new CashuSeedError(
        'INVALID_MNEMONIC',
        'Cashu mnemonic is not valid BIP-39',
      ),
    );
  }
  return ok(
    validateCashuSeed(
      mnemonicToSeedSync(mnemonic, options.passphrase ?? ''),
      'derived',
    ),
  );
}

export function createCashuSeedGetter({
  getMnemonic,
  deriveSeed = deriveStandardCashuSeed,
  cache,
}: CreateCashuSeedGetterConfig): () => Promise<Uint8Array> {
  let memoizedSeed: Uint8Array | null = null;

  return async () => {
    if (memoizedSeed) return copySeed(memoizedSeed);

    const mnemonic = normalizeCashuMnemonic((await getMnemonic()) ?? '');
    if (!mnemonic) {
      throw new CashuSeedError(
        'MISSING_MNEMONIC',
        'Cashu mnemonic is required',
      );
    }
    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new CashuSeedError(
        'INVALID_MNEMONIC',
        'Cashu mnemonic is not valid BIP-39',
      );
    }

    const context: CashuSeedCacheContext = { mnemonic };
    const cached = await cache?.load?.(context);
    if (cached) {
      memoizedSeed = validateCashuSeed(cached, 'cached');
      return copySeed(memoizedSeed);
    }

    memoizedSeed = validateCashuSeed(await deriveSeed(mnemonic), 'derived');
    await cache?.store?.(copySeed(memoizedSeed), context);
    return copySeed(memoizedSeed);
  };
}

function validateCashuSeed(
  seed: Uint8Array,
  source: 'cached' | 'derived',
): Uint8Array {
  if (!(seed instanceof Uint8Array) || seed.length !== 64) {
    throw new CashuSeedError(
      'INVALID_SEED',
      `${source} Cashu seed must be a 64-byte Uint8Array`,
    );
  }
  return copySeed(seed);
}

function copySeed(seed: Uint8Array): Uint8Array {
  return new Uint8Array(seed);
}
