import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
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
  // Bookkeeping index of every key written via secureSet. Lets clearAllSecureData
  // delete keys the caller cannot enumerate (orphans from migrations, partial
  // imported-profile writes, pre-release builds). Filled lazily on each write —
  // installs that predate this index are still wiped via the caller-supplied
  // list so behaviour only improves, never regresses.
  KEY_INDEX: 'secure_key_index',
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

// iOS keychain options. `requireAuthentication: false` writes items under the
// `app:no-auth` keychain service alias (expo-secure-store v55) so reads are
// silent. We do NOT want a biometric gate on boot — multiple providers
// (AppGate, NostrKeysProvider, MigrationGate, CocoManager) hit SecureStore in
// parallel and each prompt is per-call, so flipping this to `true` would show
// a cascade of FaceID sheets every cold start.
const IOS_SECURE_OPTIONS = {
  requireAuthentication: false,
} as const;

const secureOptions = (): SecureStore.SecureStoreOptions =>
  Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};

function assertAccountIndex(accountIndex: number): void {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error(`Invalid accountIndex: ${accountIndex}`);
  }
}

const HEX_RE = /^[0-9a-f]+$/i;

// 32-byte schnorr/secp256k1 x-only pubkey serialised as 64 hex chars.
// Use this at any trust boundary that takes a `pubkey` string from
// untrusted input (relay payloads, deep-link params, feed-spec JSON) —
// `value.length === 64` alone passes UTF-8 mojibake and arbitrary
// 64-char strings into NDK/Primal filters (audit 26#F-005).
export function isNostrPubkeyHex(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && HEX_RE.test(value);
}

function assertPubkeyHex(pubkeyHex: string): void {
  if (!isNostrPubkeyHex(pubkeyHex)) {
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
  } catch (error) {
    nostrLog.error(`nostr.secure.${op}_failed`, { error: redactError(error) });
    return false;
  }
  if (key !== STORAGE_KEYS.KEY_INDEX) {
    // Bookkeeping is best-effort; a failure to update the index does not roll
    // back the actual write. clearAllSecureData treats the index as a hint.
    rememberKey(key).catch((error) =>
      nostrLog.warn('nostr.secure.index_remember_failed', { error: redactError(error) })
    );
  }
  return true;
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

// ── secure_key_index ────────────────────────────────────────────
// Serialised RMW chain: concurrent rememberKey calls would otherwise read the
// same baseline and lose entries on the round-trip through SecureStore.
let keyIndexQueue: Promise<void> = Promise.resolve();

async function readKeyIndex(): Promise<string[]> {
  const raw = await secureGet(STORAGE_KEYS.KEY_INDEX, 'index_read');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((k): k is string => typeof k === 'string');
    }
  } catch {
    // Corrupt index — start fresh. Callers still supply their own key list,
    // so the worst case is one cycle of stale residuals.
  }
  return [];
}

async function rememberKey(key: string): Promise<void> {
  const next = keyIndexQueue.then(async () => {
    const existing = await readKeyIndex();
    if (existing.includes(key)) return;
    existing.push(key);
    try {
      await SecureStore.setItemAsync(
        STORAGE_KEYS.KEY_INDEX,
        JSON.stringify(existing),
        secureOptions()
      );
    } catch (error) {
      nostrLog.warn('nostr.secure.index_write_failed', { error: redactError(error) });
    }
  });
  keyIndexQueue = next.catch(() => {});
  return next;
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

/**
 * Reads the dev-only debug mnemonic from `Constants.expoConfig.extra.debugMnemonic`.
 *
 * The value is injected by `app.config.js` exclusively for the `development`
 * EAS build profile (and `expo start`/dev-client launches) from a non-`EXPO_PUBLIC_*`
 * env var. EXPO_PUBLIC_* vars are inlined verbatim into every JS bundle that
 * builds with them set — so any production EAS build kicked from a shell that
 * happened to export the var would ship a known 12-word seed in the bundle
 * (SOV-00 §4.1 D5; audits 04/10/11). Routing through `extra` instead means
 * preview/production bundles never observe the value: app.config.js refuses
 * to write it unless buildProfile is 'development'. The `__DEV__` gate then
 * dead-strips the read in release minification as a second layer.
 */
function getDebugMnemonicOverride(): string | null {
  if (!__DEV__) {
    return null;
  }

  let raw: unknown;
  try {
    const Constants = require('expo-constants').default;
    raw = Constants.expoConfig?.extra?.debugMnemonic;
  } catch {
    // expo-constants not available (e.g. tests or non-Expo RN). The unit
    // test for this function exercises this branch.
    return null;
  }

  if (typeof raw !== 'string') {
    return null;
  }

  const mnemonic = raw.trim();
  if (!mnemonic) {
    return null;
  }

  const words = mnemonic.split(/\s+/);
  if (words.length !== 12) {
    throw new Error('extra.debugMnemonic must be exactly 12 words');
  }

  const normalized = words.join(' ');
  if (!bip39.validateMnemonic(normalized, wordlist)) {
    throw new Error('extra.debugMnemonic failed BIP-39 validation');
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

// Single-flight guard: SecureStore reads with requireAuthentication:true
// (IOS_SECURE_OPTIONS) trigger a FaceID/TouchID prompt per call. Multiple
// concurrent boot-time callers (useMnemonic hydration, NostrKeysProvider
// derivation, AppGate reinstall-detection) must share one prompt, not race
// to issue several. Mirrors `inflightEnsureMnemonic` below.
let inflightRetrieveMnemonic: Promise<string | null> | null = null;

/**
 * Retrieves the user's mnemonic phrase from secure storage. The same BIP-39
 * gate that storeMnemonic enforces on the write side is re-checked here:
 * historical bad writes from prior app versions and rare SecureStore
 * corruption both produce a 12-word string with a bad checksum, and a silent
 * wrong-identity derivation is worse than a loud null. Bad reads are NOT
 * auto-deleted — the user is the only holder of the seed, so a corrupt blob
 * is surfaced to the recovery path instead of being destroyed.
 *
 * Concurrent callers share one in-flight promise so a single FaceID prompt
 * resolves the whole boot wave.
 */
export function retrieveMnemonic(): Promise<string | null> {
  if (inflightRetrieveMnemonic) {
    return inflightRetrieveMnemonic;
  }
  inflightRetrieveMnemonic = retrieveMnemonicInner().finally(() => {
    inflightRetrieveMnemonic = null;
  });
  return inflightRetrieveMnemonic;
}

async function retrieveMnemonicInner(): Promise<string | null> {
  const value = await secureGet(STORAGE_KEYS.USER_MNEMONIC, 'retrieve_mnemonic');
  if (value == null) return null;
  if (!bip39.validateMnemonic(value, wordlist)) {
    nostrLog.warn('nostr.secure.mnemonic_corrupt');
    return null;
  }
  return value;
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

    // retrieveMnemonic returns null for both "no value stored" and
    // "value stored but BIP-39 invalid". Before falling through to
    // generate-and-store (which SecureStore.setItemAsync semantics would
    // overwrite the existing blob), peek at the raw entry. If a value is
    // there but failed validation, refuse to overwrite — the user is the
    // only holder of the seed and a silent identity replacement strands
    // any funds derived from the corrupt mnemonic. Surface a loud failure
    // so the user can reinstall and restore from backup with the
    // correctly-typed mnemonic.
    const rawExisting = await secureGet(STORAGE_KEYS.USER_MNEMONIC, 'check_mnemonic_exists');
    if (rawExisting != null) {
      nostrLog.error('nostr.secure.refusing_overwrite_corrupt_mnemonic');
      return null;
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
    // Only mark for *fresh* seeds. Debug-injected seeds via the
    // `extra.debugMnemonic` override must look like a pre-existing seed so the
    // dev environment can exercise the restore-gate flow on every clean install.
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
 *
 * The caller supplies the indexes/pubkeys it knows about, but expo-secure-store
 * has no listKeys API and profileStore can drift from SecureStore (migrations
 * dropping indexes, partially-written imported_nsec_{pubkey} from a crashed
 * addProfile, pre-release builds with retired indexes). The persistent
 * secure_key_index built up by every prior secureSet call closes that gap so
 * a 'Delete All' actually deletes everything we ever wrote, not just what the
 * current profileStore happens to remember.
 *
 * @param accountIndexes Explicit list of account indexes to clear.
 * @param importedPubkeys Hex pubkeys of imported profiles whose nsec records should be deleted.
 * @returns Promise<boolean> True if cleared successfully, false otherwise
 */
export async function clearAllSecureData(
  accountIndexes: number[],
  importedPubkeys: string[] = []
): Promise<boolean> {
  const callerKeys: string[] = [
    STORAGE_KEYS.USER_MNEMONIC,
    STORAGE_KEYS.MIGRATIONS_COMPLETE_LEGACY,
  ];

  for (const i of accountIndexes) {
    callerKeys.push(
      migrationsCompleteKey(i),
      derivedKeysKey(i),
      cashuMnemonicKey(i),
      cashuSeedKey(i)
    );
  }

  for (const pubkey of importedPubkeys) {
    callerKeys.push(importedNsecKey(pubkey));
  }

  // Union with the bookkeeping index so orphaned keys (drift between
  // profileStore and SecureStore) get deleted alongside the caller-supplied
  // list. Belt-and-braces: if the index is empty (older install) the caller
  // list still wipes the well-known keys.
  const indexed = await readKeyIndex();
  const allKeys = Array.from(new Set([...callerKeys, ...indexed]));

  const results = await Promise.all(allKeys.map((key) => secureDelete(key, 'clear_key')));
  // Drop the index itself last so a partial wipe followed by a retry still
  // sees the un-wiped keys on the second pass.
  await secureDelete(STORAGE_KEYS.KEY_INDEX, 'clear_index');

  const allOk = results.every(Boolean);
  if (allOk) {
    nostrLog.info('nostr.secure.all_data_cleared', { count: allKeys.length });
  } else {
    nostrLog.warn('nostr.secure.all_data_cleared_with_errors', { count: allKeys.length });
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
 * 64-bit truncated SHA-256 of the mnemonic, hex-encoded. Used to bind cached
 * derived-keys / cashu-mnemonic / cashu-seed blobs to a specific mnemonic so a
 * fresh restore (different mnemonic, same SecureStore residue) cannot
 * accidentally serve the prior install's identity from cache.
 *
 * Birthday-bound collisions on the previous 32-bit djb2 fingerprint were
 * ~65K mnemonics — small enough that an Apple family-share install chain
 * could see real wrong-identity cache hits. 64 bits puts the bound at ~4B
 * which is comfortably outside any realistic single-device population. The
 * value is only ever compared for equality, so a mismatch on existing
 * stored blobs triggers a one-shot cache miss + re-derivation on the next
 * cold start — no schema bump or migration is needed.
 */
export function hashMnemonic(mnemonic: string): string {
  return bytesToHex(sha256(utf8ToBytes(mnemonic))).slice(0, 16);
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

// ── Hooks ───────────────────────────────────────────────────────

interface UseMnemonicReturn {
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
      void refresh();
    }
  }, [autoLoad, refresh]);

  return { value, loading, error, refresh };
}
