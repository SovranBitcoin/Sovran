import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

// Keys for secure storage
const STORAGE_KEYS = {
  USER_MNEMONIC: 'user_mnemonic',
  MIGRATIONS_COMPLETE_PREFIX: 'migrations_complete_',
  // Legacy key (pre per-account migration) — still checked for backward compat
  MIGRATIONS_COMPLETE_LEGACY: 'migrations_complete',
  DERIVED_KEYS_PREFIX: 'derived_keys_',
  CASHU_MNEMONIC_PREFIX: 'cashu_mnemonic_',
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
    console.error('Failed to store mnemonic:', error);
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
    console.error('Failed to retrieve mnemonic:', error);
    return null;
  }
}

/**
 * Generates a new 12-word mnemonic phrase
 * @returns Promise<string> The generated mnemonic phrase
 */
async function generateMnemonic(): Promise<string> {
  try {
    const debugMnemonic = getDebugMnemonicOverride();
    if (debugMnemonic) {
      console.log('Using debug mnemonic from EXPO_PUBLIC_DEBUG_MNEMONIC');
      return debugMnemonic;
    }

    // Generate 128 bits of entropy (16 bytes) for a 12-word mnemonic
    const entropy = new Uint8Array(16);
    crypto.getRandomValues(entropy);

    // Generate mnemonic from entropy
    const mnemonic = bip39.entropyToMnemonic(entropy, wordlist);

    console.log('Generated new mnemonic');
    return mnemonic;
  } catch (error) {
    console.error('Failed to generate mnemonic:', error);
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
      console.log('Mnemonic already exists');
      return existingMnemonic;
    }

    // Generate new mnemonic
    console.log('No mnemonic found, generating new one...');
    const newMnemonic = await generateMnemonic();

    // Store the new mnemonic
    const stored = await storeMnemonic(newMnemonic);
    if (!stored) {
      console.error('Failed to store newly generated mnemonic');
      return null;
    }

    console.log('New mnemonic generated and stored successfully');
    return newMnemonic;
  } catch (error) {
    console.error('Failed to ensure mnemonic exists:', error);
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
        console.warn(`Failed to clear ${key}:`, error);
        return false;
      })
    );

    await Promise.all(clearPromises);

    console.log('All secure storage data cleared successfully');
    return true;
  } catch (error) {
    console.error('Failed to clear secure storage:', error);
    return false;
  }
}

/**
 * Clears ONLY per-profile secure data for the given account indexes.
 * Does NOT delete the root mnemonic or the legacy migrations flag.
 * Use this when removing a single profile while keeping others alive.
 */
export async function clearPerProfileSecureData(
  accountIndexes: number[],
  importedPubkeys: string[] = []
): Promise<boolean> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};

    const keysToDelete: string[] = [];

    for (const i of accountIndexes) {
      keysToDelete.push(migrationsCompleteKey(i), derivedKeysKey(i), cashuMnemonicKey(i));
    }

    for (const pubkey of importedPubkeys) {
      keysToDelete.push(importedNsecKey(pubkey));
    }

    await Promise.all(
      keysToDelete.map((key) =>
        SecureStore.deleteItemAsync(key, options).catch((error) => {
          console.warn(`Failed to clear ${key}:`, error);
        })
      )
    );

    console.log('Per-profile secure data cleared successfully');
    return true;
  } catch (error) {
    console.error('Failed to clear per-profile secure storage:', error);
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
    console.error('Failed to store derived keys:', error);
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
    console.error('Failed to retrieve derived keys:', error);
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
    console.error('Failed to store cashu mnemonic:', error);
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
    console.error('Failed to retrieve cashu mnemonic:', error);
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
    console.error('Failed to check migrations complete flag:', error);
    return false;
  }
}

export async function setMigrationsComplete(accountIndex: number = 0): Promise<boolean> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    await SecureStore.setItemAsync(migrationsCompleteKey(accountIndex), 'true', options);
    return true;
  } catch (error) {
    console.error('Failed to set migrations complete flag:', error);
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
    console.error('Failed to store imported nsec:', error);
    return false;
  }
}

export async function retrieveImportedNsec(pubkeyHex: string): Promise<string | null> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    return await SecureStore.getItemAsync(importedNsecKey(pubkeyHex), options);
  } catch (error) {
    console.error('Failed to retrieve imported nsec:', error);
    return null;
  }
}

export async function deleteImportedNsec(pubkeyHex: string): Promise<boolean> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};
    await SecureStore.deleteItemAsync(importedNsecKey(pubkeyHex), options);
    return true;
  } catch (error) {
    console.error('Failed to delete imported nsec:', error);
    return false;
  }
}
