import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

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
  nsec: string;
  pubkey: string;
  privateKeyHex: string;
  mnemonicHash: string;
}

// iOS-specific options for enhanced security
const IOS_SECURE_OPTIONS = {
  requireAuthentication: false, // Set to false to avoid biometric requirement in development
  authenticatePrompt: 'Authenticate to access your Sovran wallet',
  // For production, you might want to set requireAuthentication: true
} as const;

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

  return words.join(' ');
}

/**
 * Securely stores the user's mnemonic phrase
 * @param mnemonic The 12-word mnemonic phrase to store
 * @returns Promise<boolean> True if stored successfully, false otherwise
 */
export async function storeMnemonic(mnemonic: string): Promise<boolean> {
  try {
    if (!mnemonic || typeof mnemonic !== 'string') {
      throw new Error('Invalid mnemonic provided');
    }

    // Validate it's a 12-word mnemonic
    const words = mnemonic.trim().split(' ');
    if (words.length !== 12) {
      throw new Error('Mnemonic must be exactly 12 words');
    }

    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};

    await SecureStore.setItemAsync(STORAGE_KEYS.USER_MNEMONIC, mnemonic, options);

    return true;
  } catch (error) {
    nostrLog.error('nostr.secure.store_mnemonic_failed', { error: redactError(error) });
    return false;
  }
}

/**
 * Retrieves the user's mnemonic phrase from secure storage
 * @returns Promise<string | null> The mnemonic phrase or null if not found/error
 */
export async function retrieveMnemonic(): Promise<string | null> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};

    const mnemonic = await SecureStore.getItemAsync(STORAGE_KEYS.USER_MNEMONIC, options);

    return mnemonic;
  } catch (error) {
    nostrLog.error('nostr.secure.retrieve_mnemonic_failed', { error: redactError(error) });
    return null;
  }
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

/**
 * Generates and stores a new mnemonic if none exists
 * @returns Promise<string | null> The mnemonic (existing or newly generated), or null if failed
 */
export async function ensureMnemonicExists(): Promise<string | null> {
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

    // Store the new mnemonic
    const stored = await storeMnemonic(generated.mnemonic);
    if (!stored) {
      nostrLog.error('nostr.secure.store_new_mnemonic_failed');
      return null;
    }

    nostrLog.info('nostr.secure.mnemonic_stored', { source: generated.source });

    // Only mark seedCreatedAt for *fresh* seeds (real user fresh-install path).
    // Debug-injected seeds via EXPO_PUBLIC_DEBUG_MNEMONIC must look like a
    // pre-existing seed so the dev environment can exercise the restore-gate
    // flow on every clean install — same code path a production user hits
    // after reinstall / iCloud restore / profile reset.
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
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};

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

    const clearPromises = keysToDelete.map((key) =>
      SecureStore.deleteItemAsync(key, options).catch((error) => {
        nostrLog.warn('nostr.secure.clear_key_failed', { key, error: redactError(error) });
        return false;
      })
    );

    await Promise.all(clearPromises);

    nostrLog.info('nostr.secure.all_data_cleared');
    return true;
  } catch (error) {
    nostrLog.error('nostr.secure.clear_all_failed', { error: redactError(error) });
    return false;
  }
}

// ── Derived Keys Cache ──────────────────────────────────────────

function derivedKeysKey(accountIndex: number): string {
  return `${STORAGE_KEYS.DERIVED_KEYS_PREFIX}${accountIndex}`;
}

function cashuMnemonicKey(accountIndex: number): string {
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

export async function storeDerivedKeys(
  accountIndex: number,
  keys: CachedDerivedKeys
): Promise<boolean> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    await SecureStore.setItemAsync(derivedKeysKey(accountIndex), JSON.stringify(keys), options);
    return true;
  } catch (error) {
    nostrLog.error('nostr.secure.store_keys_failed', { error: redactError(error) });
    return false;
  }
}

export async function retrieveDerivedKeys(accountIndex: number): Promise<CachedDerivedKeys | null> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    const raw = await SecureStore.getItemAsync(derivedKeysKey(accountIndex), options);
    if (!raw) return null;
    return JSON.parse(raw) as CachedDerivedKeys;
  } catch (error) {
    nostrLog.error('nostr.secure.retrieve_keys_failed', { error: redactError(error) });
    return null;
  }
}

export async function storeCashuMnemonic(
  accountIndex: number,
  cashuMnemonicValue: string,
  mnemonicHash: string
): Promise<boolean> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    const payload = JSON.stringify({ value: cashuMnemonicValue, mnemonicHash });
    await SecureStore.setItemAsync(cashuMnemonicKey(accountIndex), payload, options);
    return true;
  } catch (error) {
    nostrLog.error('nostr.secure.store_cashu_mnemonic_failed', { error: redactError(error) });
    return false;
  }
}

export async function retrieveCashuMnemonic(
  accountIndex: number
): Promise<{ value: string; mnemonicHash: string } | null> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    const raw = await SecureStore.getItemAsync(cashuMnemonicKey(accountIndex), options);
    if (!raw) return null;
    return JSON.parse(raw) as { value: string; mnemonicHash: string };
  } catch (error) {
    nostrLog.error('nostr.secure.retrieve_cashu_mnemonic_failed', { error: redactError(error) });
    return null;
  }
}

// ── Cashu Seed Cache ────────────────────────────────────────────
// Caches the 64-byte PBKDF2-derived seed so we skip the ~5s derivation on warm starts.

function cashuSeedKey(accountIndex: number): string {
  return `${STORAGE_KEYS.CASHU_SEED_PREFIX}${accountIndex}`;
}

export async function storeCashuSeed(
  accountIndex: number,
  seed: Uint8Array,
  mnemonicHash: string
): Promise<boolean> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    const hex = Array.from(seed)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const payload = JSON.stringify({ hex, mnemonicHash });
    await SecureStore.setItemAsync(cashuSeedKey(accountIndex), payload, options);
    return true;
  } catch (error) {
    nostrLog.error('nostr.secure.store_cashu_seed_failed', { error: redactError(error) });
    return false;
  }
}

export async function retrieveCashuSeed(
  accountIndex: number
): Promise<{ seed: Uint8Array; mnemonicHash: string } | null> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    const raw = await SecureStore.getItemAsync(cashuSeedKey(accountIndex), options);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { hex: string; mnemonicHash: string };
    const bytes = new Uint8Array(parsed.hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(parsed.hex.substring(i * 2, i * 2 + 2), 16);
    }
    return { seed: bytes, mnemonicHash: parsed.mnemonicHash };
  } catch (error) {
    nostrLog.error('nostr.secure.retrieve_cashu_seed_failed', { error: redactError(error) });
    return null;
  }
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
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    // Check per-account key first
    const perAccount = await SecureStore.getItemAsync(migrationsCompleteKey(accountIndex), options);
    if (perAccount === 'true') return true;

    // Backward compat: check legacy global key (only trust it for account 0)
    if (accountIndex === 0) {
      const legacy = await SecureStore.getItemAsync(
        STORAGE_KEYS.MIGRATIONS_COMPLETE_LEGACY,
        options
      );
      if (legacy === 'true') {
        // Promote to per-account key so we don't check legacy again
        await SecureStore.setItemAsync(migrationsCompleteKey(0), 'true', options);
        return true;
      }
    }

    return false;
  } catch (error) {
    nostrLog.error('nostr.secure.check_migration_flag_failed', { error: redactError(error) });
    return false;
  }
}

export async function setMigrationsComplete(accountIndex: number = 0): Promise<boolean> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    await SecureStore.setItemAsync(migrationsCompleteKey(accountIndex), 'true', options);
    return true;
  } catch (error) {
    nostrLog.error('nostr.secure.set_migration_flag_failed', { error: redactError(error) });
    return false;
  }
}

// ── Imported Nsec Storage ───────────────────────────────────────

function importedNsecKey(pubkeyHex: string): string {
  return `${STORAGE_KEYS.IMPORTED_NSEC_PREFIX}${pubkeyHex}`;
}

export async function storeImportedNsec(pubkeyHex: string, nsecValue: string): Promise<boolean> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    await SecureStore.setItemAsync(importedNsecKey(pubkeyHex), nsecValue, options);
    return true;
  } catch (error) {
    nostrLog.error('nostr.secure.store_nsec_failed', { error: redactError(error) });
    return false;
  }
}

export async function retrieveImportedNsec(pubkeyHex: string): Promise<string | null> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    return await SecureStore.getItemAsync(importedNsecKey(pubkeyHex), options);
  } catch (error) {
    nostrLog.error('nostr.secure.retrieve_nsec_failed', { error: redactError(error) });
    return null;
  }
}

export async function deleteImportedNsec(pubkeyHex: string): Promise<boolean> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    await SecureStore.deleteItemAsync(importedNsecKey(pubkeyHex), options);
    return true;
  } catch (error) {
    nostrLog.error('nostr.secure.delete_nsec_failed', { error: redactError(error) });
    return false;
  }
}
