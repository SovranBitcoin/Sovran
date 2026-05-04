import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { useCallback, useEffect, useState } from 'react';

import { nostrLog, redactError } from '../logger';

// Keys for secure storage
const STORAGE_KEYS = {
  USER_MNEMONIC: 'user_mnemonic',
  MIGRATIONS_COMPLETE_PREFIX: 'migrations_complete_',
  // Legacy key (pre per-account migration) — still checked for backward compat
  MIGRATIONS_COMPLETE_LEGACY: 'migrations_complete',
  DERIVED_KEYS_PREFIX: 'derived_keys_',
  CASHU_MNEMONIC_PREFIX: 'cashu_mnemonic_',
  CASHU_SEED_PREFIX: 'cashu_seed_',
  IMPORTED_NSEC_PREFIX: 'imported_nsec_',
} as const;

export interface CachedDerivedKeys {
  npub: string;
  /** @SECRET nsec — never log or surface in error payloads */
  nsec: string;
  pubkey: string;
  /** @SECRET raw private key hex — never log or surface in error payloads */
  privateKeyHex: string;
  mnemonicHash: string;
}

// iOS-specific options for enhanced security
const IOS_SECURE_OPTIONS = {
  requireAuthentication: true,
  authenticatePrompt: 'Authenticate to access your Sovran wallet',
} as const;

const secureOptions = (): SecureStore.SecureStoreOptions =>
  Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};

function assertAccountIndex(accountIndex: number): void {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error(`Invalid accountIndex: ${accountIndex}`);
  }
}

const HEX_RE = /^[0-9a-f]+$/i;

function assertPubkeyHex(pubkeyHex: string): void {
  // 32-byte schnorr/secp256k1 x-only pubkey serialised as 64 lowercase hex chars
  if (typeof pubkeyHex !== 'string' || pubkeyHex.length !== 64 || !HEX_RE.test(pubkeyHex)) {
    throw new Error('Invalid pubkeyHex: expected 64 hex chars');
  }
}

async function secureGet(key: string, op: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, secureOptions());
  } catch (error) {
    nostrLog.error(`nostr.secure.${op}_failed`, { error: redactError(error) });
    return null;
  }
}

async function secureSet(key: string, value: string, op: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(key, value, secureOptions());
    return true;
  } catch (error) {
    nostrLog.error(`nostr.secure.${op}_failed`, { error: redactError(error) });
    return false;
  }
}

async function secureDelete(key: string, op: string): Promise<boolean> {
  try {
    await SecureStore.deleteItemAsync(key, secureOptions());
    return true;
  } catch (error) {
    nostrLog.error(`nostr.secure.${op}_failed`, { error: redactError(error) });
    return false;
  }
}

/**
 * Wraps a parser of a SecureStore blob with self-heal: on parse failure or
 * invariant violation, the corrupt blob is deleted so the next session falls
 * through to the slow rederivation path exactly once instead of every boot.
 */
async function parseOrSelfHeal<T>(
  raw: string,
  key: string,
  op: string,
  parse: (raw: string) => T
): Promise<T | null> {
  try {
    return parse(raw);
  } catch (error) {
    nostrLog.error(`nostr.secure.${op}_failed`, { error: redactError(error) });
    await secureDelete(key, `${op}_self_heal`);
    return null;
  }
}

function getDebugMnemonicOverride(): string | null {
  if (!__DEV__) {
    return null;
  }

  const mnemonic = process.env.EXPO_PUBLIC_DEBUG_MNEMONIC?.trim();
  if (!mnemonic) {
    return null;
  }

  const words = mnemonic.split(/\s+/);
  if (words.length !== 12) {
    throw new Error('EXPO_PUBLIC_DEBUG_MNEMONIC must be exactly 12 words');
  }

  const normalized = words.join(' ');
  if (!bip39.validateMnemonic(normalized, wordlist)) {
    throw new Error('EXPO_PUBLIC_DEBUG_MNEMONIC failed BIP-39 validation');
  }

  return normalized;
}

/**
 * Securely stores the user's mnemonic phrase
 * @param mnemonic The 12-word mnemonic phrase to store
 * @returns Promise<boolean> True if stored successfully, false otherwise
 */
export async function storeMnemonic(mnemonic: string): Promise<boolean> {
  if (!mnemonic || typeof mnemonic !== 'string') {
    nostrLog.error('nostr.secure.store_mnemonic_failed', {
      error: 'Invalid mnemonic provided',
    });
    return false;
  }
  const words = mnemonic.trim().split(' ');
  if (words.length !== 12) {
    nostrLog.error('nostr.secure.store_mnemonic_failed', {
      error: 'Mnemonic must be exactly 12 words',
    });
    return false;
  }
  // Reject mnemonics that fail the BIP-39 wordlist or checksum: a single
  // mistyped word on restore otherwise persists, derives a wrong identity,
  // and silently strands the user's funds against the correct mnemonic.
  if (!bip39.validateMnemonic(mnemonic, wordlist)) {
    nostrLog.error('nostr.secure.store_mnemonic_failed', {
      error: 'Mnemonic failed BIP-39 validation',
    });
    return false;
  }

  return secureSet(STORAGE_KEYS.USER_MNEMONIC, mnemonic, 'store_mnemonic');
}

/**
 * Retrieves the user's mnemonic phrase from secure storage
 * @returns Promise<string | null> The mnemonic phrase or null if not found/error
 */
export function retrieveMnemonic(): Promise<string | null> {
  return secureGet(STORAGE_KEYS.USER_MNEMONIC, 'retrieve_mnemonic');
}

/**
 * Source of a generated mnemonic — used by ensureMnemonicExists to decide
 * whether the seed was actually created by this app installation (`fresh`)
 * or injected from outside (`debug`, simulating an existing user).
 */
type GeneratedMnemonic = { mnemonic: string; source: 'fresh' | 'debug' };

/**
 * Generates a new 12-word mnemonic phrase
 * @returns Promise<GeneratedMnemonic> The generated mnemonic and its source
 */
async function generateMnemonic(): Promise<GeneratedMnemonic> {
  try {
    const debugMnemonic = getDebugMnemonicOverride();
    if (debugMnemonic) {
      nostrLog.debug('nostr.secure.using_debug_mnemonic');
      return { mnemonic: debugMnemonic, source: 'debug' };
    }

    // Generate 128 bits of entropy (16 bytes) for a 12-word mnemonic
    const entropy = new Uint8Array(16);
    crypto.getRandomValues(entropy);

    // Generate mnemonic from entropy
    const mnemonic = bip39.entropyToMnemonic(entropy, wordlist);

    nostrLog.info('nostr.secure.mnemonic_generated');
    return { mnemonic, source: 'fresh' };
  } catch (error) {
    nostrLog.error('nostr.secure.generate_mnemonic_failed', { error: redactError(error) });
    throw new Error('Failed to generate mnemonic');
  }
}

// Single-flight guard: concurrent callers (boot races, legacy-bootstrap,
// React StrictMode double-invoke) all observe the same generate+store
// outcome instead of each generating a fresh mnemonic and racing to overwrite.
let inflightEnsureMnemonic: Promise<string | null> | null = null;

/**
 * Generates and stores a new mnemonic if none exists
 * @returns Promise<string | null> The mnemonic (existing or newly generated), or null if failed
 */
export function ensureMnemonicExists(): Promise<string | null> {
  if (inflightEnsureMnemonic) {
    return inflightEnsureMnemonic;
  }
  inflightEnsureMnemonic = ensureMnemonicExistsInner().finally(() => {
    inflightEnsureMnemonic = null;
  });
  return inflightEnsureMnemonic;
}

async function ensureMnemonicExistsInner(): Promise<string | null> {
  try {
    // Check if mnemonic already exists
    const existingMnemonic = await retrieveMnemonic();
    if (existingMnemonic) {
      nostrLog.debug('nostr.secure.mnemonic_exists');
      return existingMnemonic;
    }

    // Generate new mnemonic
    nostrLog.info('nostr.secure.generating_mnemonic');
    const generated = await generateMnemonic();

    // Mark seedCreatedAt BEFORE storing the mnemonic so a crash in the narrow
    // window between mark and store still leaves a recoverable invariant: the
    // next boot sees no mnemonic, regenerates, and remarks. Marking after the
    // store would risk a crash window where retrieveMnemonic succeeds but
    // seedCreatedAt is null forever — a genuine fresh install indistinguishable
    // from a restore.
    //
    // Only mark for *fresh* seeds. Debug-injected seeds via
    // EXPO_PUBLIC_DEBUG_MNEMONIC must look like a pre-existing seed so the dev
    // environment can exercise the restore-gate flow on every clean install.
    if (generated.source === 'fresh') {
      try {
        const { useWalletLifecycleStore } =
          await import('@/shared/stores/global/walletLifecycleStore');
        useWalletLifecycleStore.getState().markSeedCreatedNow();
      } catch (markError) {
        nostrLog.warn('nostr.secure.mark_seed_created_failed', { error: redactError(markError) });
      }
    } else {
      nostrLog.info('nostr.secure.skip_mark_seed_created', {
        reason: 'debug_mnemonic_treated_as_pre_existing',
      });
    }

    // Store the new mnemonic
    const stored = await storeMnemonic(generated.mnemonic);
    if (!stored) {
      nostrLog.error('nostr.secure.store_new_mnemonic_failed');
      return null;
    }

    nostrLog.info('nostr.secure.mnemonic_stored', { source: generated.source });
    return generated.mnemonic;
  } catch (error) {
    nostrLog.error('nostr.secure.ensure_mnemonic_failed', { error: redactError(error) });
    return null;
  }
}

/**
 * Clears all data from secure storage including per-account keys.
 * @param accountIndexes Explicit list of account indexes to clear.
 * @param importedPubkeys Hex pubkeys of imported profiles whose nsec records should be deleted.
 * @returns Promise<boolean> True if cleared successfully, false otherwise
 */
export async function clearAllSecureData(
  accountIndexes: number[],
  importedPubkeys: string[] = []
): Promise<boolean> {
  const keysToDelete: string[] = [
    STORAGE_KEYS.USER_MNEMONIC,
    STORAGE_KEYS.MIGRATIONS_COMPLETE_LEGACY,
  ];

  for (const i of accountIndexes) {
    keysToDelete.push(migrationsCompleteKey(i), derivedKeysKey(i), cashuMnemonicKey(i));
  }

  for (const pubkey of importedPubkeys) {
    keysToDelete.push(importedNsecKey(pubkey));
  }

  const results = await Promise.all(keysToDelete.map((key) => secureDelete(key, 'clear_key')));
  const allOk = results.every(Boolean);
  if (allOk) {
    nostrLog.info('nostr.secure.all_data_cleared');
  } else {
    nostrLog.warn('nostr.secure.all_data_cleared_with_errors');
  }
  return allOk;
}

// ── Derived Keys Cache ──────────────────────────────────────────

function derivedKeysKey(accountIndex: number): string {
  assertAccountIndex(accountIndex);
  return `${STORAGE_KEYS.DERIVED_KEYS_PREFIX}${accountIndex}`;
}

function cashuMnemonicKey(accountIndex: number): string {
  assertAccountIndex(accountIndex);
  return `${STORAGE_KEYS.CASHU_MNEMONIC_PREFIX}${accountIndex}`;
}

/**
 * Simple hash of a mnemonic string used to detect if the mnemonic changed.
 * Not cryptographic — just a fast fingerprint for cache invalidation.
 */
export function hashMnemonic(mnemonic: string): string {
  let hash = 0;
  for (let i = 0; i < mnemonic.length; i++) {
    hash = (hash * 31 + mnemonic.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export function storeDerivedKeys(accountIndex: number, keys: CachedDerivedKeys): Promise<boolean> {
  return secureSet(derivedKeysKey(accountIndex), JSON.stringify(keys), 'store_keys');
}

export async function retrieveDerivedKeys(accountIndex: number): Promise<CachedDerivedKeys | null> {
  const key = derivedKeysKey(accountIndex);
  const raw = await secureGet(key, 'retrieve_keys');
  if (!raw) return null;
  return parseOrSelfHeal(raw, key, 'retrieve_keys', (s) => JSON.parse(s) as CachedDerivedKeys);
}

export function storeCashuMnemonic(
  accountIndex: number,
  cashuMnemonicValue: string,
  mnemonicHash: string
): Promise<boolean> {
  const payload = JSON.stringify({ value: cashuMnemonicValue, mnemonicHash });
  return secureSet(cashuMnemonicKey(accountIndex), payload, 'store_cashu_mnemonic');
}

export async function retrieveCashuMnemonic(
  accountIndex: number
): Promise<{ value: string; mnemonicHash: string } | null> {
  const key = cashuMnemonicKey(accountIndex);
  const raw = await secureGet(key, 'retrieve_cashu_mnemonic');
  if (!raw) return null;
  return parseOrSelfHeal(
    raw,
    key,
    'retrieve_cashu_mnemonic',
    (s) => JSON.parse(s) as { value: string; mnemonicHash: string }
  );
}

// ── Cashu Seed Cache ────────────────────────────────────────────
// Caches the 64-byte PBKDF2-derived seed so we skip the ~5s derivation on warm starts.

function cashuSeedKey(accountIndex: number): string {
  assertAccountIndex(accountIndex);
  return `${STORAGE_KEYS.CASHU_SEED_PREFIX}${accountIndex}`;
}

export function storeCashuSeed(
  accountIndex: number,
  seed: Uint8Array,
  mnemonicHash: string
): Promise<boolean> {
  const payload = JSON.stringify({ hex: bytesToHex(seed), mnemonicHash });
  return secureSet(cashuSeedKey(accountIndex), payload, 'store_cashu_seed');
}

export async function retrieveCashuSeed(
  accountIndex: number
): Promise<{ seed: Uint8Array; mnemonicHash: string } | null> {
  const key = cashuSeedKey(accountIndex);
  const raw = await secureGet(key, 'retrieve_cashu_seed');
  if (!raw) return null;
  return parseOrSelfHeal(raw, key, 'retrieve_cashu_seed', (s) => {
    const parsed = JSON.parse(s) as { hex: string; mnemonicHash: string };
    const seed = hexToBytes(parsed.hex);
    // Cashu BIP39 seed is exactly 64 bytes; anything else is a corrupt blob.
    // Treating short/long buffers as cache-hit would derive a plausible-but-
    // wrong seed and strand deterministic proof counters.
    if (seed.length !== 64) {
      throw new Error(`cashu seed wrong length: ${seed.length}`);
    }
    return { seed, mnemonicHash: parsed.mnemonicHash };
  });
}

// ── Migrations Complete Flag (per-account) ──────────────────────

function migrationsCompleteKey(accountIndex: number): string {
  return `${STORAGE_KEYS.MIGRATIONS_COMPLETE_PREFIX}${accountIndex}`;
}

/**
 * Check whether Redux migrations have already completed for the given account.
 * Falls back to the legacy global key for accounts that migrated before the
 * per-account key was introduced.
 */
export async function isMigrationsComplete(accountIndex: number = 0): Promise<boolean> {
  // Check per-account key first
  const perAccount = await secureGet(migrationsCompleteKey(accountIndex), 'check_migration_flag');
  if (perAccount === 'true') return true;

  // Backward compat: check legacy global key (only trust it for account 0)
  if (accountIndex === 0) {
    const legacy = await secureGet(STORAGE_KEYS.MIGRATIONS_COMPLETE_LEGACY, 'check_migration_flag');
    if (legacy === 'true') {
      // Promote to per-account key so we don't check legacy again
      await secureSet(migrationsCompleteKey(0), 'true', 'set_migration_flag');
      return true;
    }
  }

  return false;
}

export function setMigrationsComplete(accountIndex: number = 0): Promise<boolean> {
  return secureSet(migrationsCompleteKey(accountIndex), 'true', 'set_migration_flag');
}

// ── Imported Nsec Storage ───────────────────────────────────────

function importedNsecKey(pubkeyHex: string): string {
  assertPubkeyHex(pubkeyHex);
  return `${STORAGE_KEYS.IMPORTED_NSEC_PREFIX}${pubkeyHex}`;
}

export function storeImportedNsec(pubkeyHex: string, nsecValue: string): Promise<boolean> {
  return secureSet(importedNsecKey(pubkeyHex), nsecValue, 'store_nsec');
}

export function retrieveImportedNsec(pubkeyHex: string): Promise<string | null> {
  return secureGet(importedNsecKey(pubkeyHex), 'retrieve_nsec');
}

export function deleteImportedNsec(pubkeyHex: string): Promise<boolean> {
  return secureDelete(importedNsecKey(pubkeyHex), 'delete_nsec');
}

// ── Hooks ───────────────────────────────────────────────────────

export interface UseMnemonicReturn {
  value: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * React hook over `retrieveMnemonic`. Auto-loads on mount when `autoLoad` is
 * true (default). The mnemonic is the only key consumed via a hook today; if
 * other keys grow consumers, generalize then.
 */
export function useMnemonic(autoLoad: boolean = true): UseMnemonicReturn {
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(autoLoad);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const stored = await retrieveMnemonic();
    setValue(stored);
    if (stored === null) {
      // `retrieveMnemonic` swallows errors and returns null on either
      // not-found or genuine failure; the hook exposes a generic message
      // for the failure-shaped UI but does not distinguish — callers that
      // need that distinction read SecureStore directly.
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (autoLoad) {
      refresh();
    }
  }, [autoLoad, refresh]);

  return { value, loading, error, refresh };
}
