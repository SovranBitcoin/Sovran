import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { err, ok, type Result } from 'neverthrow';

import { errField, logger } from './logger';

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
  logger.info('walletSeed.mnemonic.generate', {
    strength: options.strength ?? 128,
  });
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
  logger.debug('walletSeed.deriveStandard.start', {
    inputLength: input.length,
    wordCount: mnemonic ? mnemonic.split(' ').length : 0,
    passphraseProvided: !!options.passphrase,
  });
  if (!mnemonic) {
    logger.warn('walletSeed.deriveStandard.failed', {
      reason: 'missing_mnemonic',
    });
    return err(
      new CashuSeedError('MISSING_MNEMONIC', 'Cashu mnemonic is required'),
    );
  }
  if (!validateMnemonic(mnemonic, wordlist)) {
    logger.warn('walletSeed.deriveStandard.failed', {
      reason: 'invalid_mnemonic',
      wordCount: mnemonic.split(' ').length,
    });
    return err(
      new CashuSeedError(
        'INVALID_MNEMONIC',
        'Cashu mnemonic is not valid BIP-39',
      ),
    );
  }
  try {
    const seed = validateCashuSeed(
      mnemonicToSeedSync(mnemonic, options.passphrase ?? ''),
      'derived',
    );
    logger.info('walletSeed.deriveStandard.done', {
      seedByteLength: seed.length,
      passphraseProvided: !!options.passphrase,
    });
    return ok(seed);
  } catch (error) {
    logger.warn('walletSeed.deriveStandard.failed', {
      reason: 'invalid_seed',
      error: errField(error),
    });
    return err(
      error instanceof CashuSeedError
        ? error
        : new CashuSeedError('INVALID_SEED', 'Derived Cashu seed is invalid'),
    );
  }
}

export function createCashuSeedGetter({
  getMnemonic,
  deriveSeed = deriveStandardCashuSeed,
  cache,
}: CreateCashuSeedGetterConfig): () => Promise<Uint8Array> {
  let memoizedSeed: Uint8Array | null = null;
  logger.info('walletSeed.getter.create', {
    hasCustomDeriveSeed: deriveSeed !== deriveStandardCashuSeed,
    hasCacheLoad: !!cache?.load,
    hasCacheStore: !!cache?.store,
  });

  return async () => {
    logger.debug('walletSeed.getter.start', {
      hasMemoizedSeed: !!memoizedSeed,
      hasCacheLoad: !!cache?.load,
      hasCacheStore: !!cache?.store,
    });
    if (memoizedSeed) {
      logger.debug('walletSeed.getter.memoized', {
        seedByteLength: memoizedSeed.length,
      });
      return copySeed(memoizedSeed);
    }

    const mnemonic = normalizeCashuMnemonic((await getMnemonic()) ?? '');
    if (!mnemonic) {
      logger.warn('walletSeed.getter.failed', {
        reason: 'missing_mnemonic',
      });
      throw new CashuSeedError(
        'MISSING_MNEMONIC',
        'Cashu mnemonic is required',
      );
    }
    if (!validateMnemonic(mnemonic, wordlist)) {
      logger.warn('walletSeed.getter.failed', {
        reason: 'invalid_mnemonic',
        wordCount: mnemonic.split(' ').length,
      });
      throw new CashuSeedError(
        'INVALID_MNEMONIC',
        'Cashu mnemonic is not valid BIP-39',
      );
    }

    const context: CashuSeedCacheContext = { mnemonic };
    logger.debug('walletSeed.getter.cache.load.start', {
      enabled: !!cache?.load,
      wordCount: mnemonic.split(' ').length,
    });
    let cached: Uint8Array | null | undefined;
    try {
      cached = await cache?.load?.(context);
    } catch (error) {
      logger.warn('walletSeed.getter.cache.load.failed', {
        error: errField(error),
      });
      throw error;
    }
    if (cached) {
      memoizedSeed = validateCashuSeed(cached, 'cached');
      logger.info('walletSeed.getter.cache.hit', {
        seedByteLength: memoizedSeed.length,
      });
      return copySeed(memoizedSeed);
    }
    logger.debug('walletSeed.getter.cache.miss', {
      enabled: !!cache?.load,
    });

    try {
      memoizedSeed = validateCashuSeed(await deriveSeed(mnemonic), 'derived');
    } catch (error) {
      logger.warn('walletSeed.getter.derive.failed', {
        error: errField(error),
      });
      throw error;
    }
    logger.info('walletSeed.getter.derive.done', {
      seedByteLength: memoizedSeed.length,
    });
    if (cache?.store) {
      logger.debug('walletSeed.getter.cache.store.start', {
        seedByteLength: memoizedSeed.length,
      });
      try {
        await cache.store(copySeed(memoizedSeed), context);
        logger.info('walletSeed.getter.cache.store.done');
      } catch (error) {
        logger.warn('walletSeed.getter.cache.store.failed', {
          error: errField(error),
        });
        throw error;
      }
    }
    return copySeed(memoizedSeed);
  };
}

function validateCashuSeed(
  seed: Uint8Array,
  source: 'cached' | 'derived',
): Uint8Array {
  if (!(seed instanceof Uint8Array) || seed.length !== 64) {
    logger.warn('walletSeed.validate.failed', {
      source,
      receivedType: seed instanceof Uint8Array ? 'Uint8Array' : typeof seed,
      byteLength: seed instanceof Uint8Array ? seed.length : null,
    });
    throw new CashuSeedError(
      'INVALID_SEED',
      `${source} Cashu seed must be a 64-byte Uint8Array`,
    );
  }
  logger.debug('walletSeed.validate.done', {
    source,
    byteLength: seed.length,
  });
  return copySeed(seed);
}

function copySeed(seed: Uint8Array): Uint8Array {
  return new Uint8Array(seed);
}
