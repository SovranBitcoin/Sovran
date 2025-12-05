import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

// Keys for secure storage
const STORAGE_KEYS = {
  USER_MNEMONIC: 'user_mnemonic',
} as const;

// iOS-specific options for enhanced security
const IOS_SECURE_OPTIONS = {
  requireAuthentication: false, // Set to false to avoid biometric requirement in development
  authenticatePrompt: 'Authenticate to access your Sovran wallet',
  // For production, you might want to set requireAuthentication: true
} as const;

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
 * Clears all data from secure storage
 * @returns Promise<boolean> True if cleared successfully, false otherwise
 */
export async function clearAllSecureData(): Promise<boolean> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};

    // Clear all known storage keys
    const keys = Object.values(STORAGE_KEYS);
    const clearPromises = keys.map((key) =>
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
