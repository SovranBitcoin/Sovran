import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Keys for secure storage
const STORAGE_KEYS = {
  USER_MNEMONIC: 'user_mnemonic',
  USER_PROFILE_DATA: 'user_profile_data',
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

    console.log('Mnemonic stored securely');
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
    console.log('mnemonic', mnemonic);
    if (mnemonic) {
      console.log('Mnemonic retrieved successfully');
    }

    return mnemonic;
  } catch (error) {
    console.error('Failed to retrieve mnemonic:', error);
    return null;
  }
}

export async function clearMnemonic(): Promise<boolean> {
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.USER_MNEMONIC);
    return true;
  } catch (error) {
    console.error('Failed to clear mnemonic:', error);
    return false;
  }
}

/**
 * Checks if a mnemonic is stored in secure storage
 * @returns Promise<boolean> True if mnemonic exists, false otherwise
 */
export async function hasMnemonic(): Promise<boolean> {
  try {
    const mnemonic = await retrieveMnemonic();
    return mnemonic !== null && mnemonic.trim().length > 0;
  } catch (error) {
    console.error('Failed to check for mnemonic:', error);
    return false;
  }
}

/**
 * Removes the mnemonic from secure storage (useful for account deletion/reset)
 * @returns Promise<boolean> True if removed successfully, false otherwise
 */
export async function removeMnemonic(): Promise<boolean> {
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.USER_MNEMONIC);
    console.log('Mnemonic removed from secure storage');
    return true;
  } catch (error) {
    console.error('Failed to remove mnemonic:', error);
    return false;
  }
}

/**
 * Stores additional profile data securely (optional, for future use)
 * @param profileData JSON-serializable profile data
 * @returns Promise<boolean> True if stored successfully, false otherwise
 */
export async function storeProfileData(profileData: any): Promise<boolean> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};

    await SecureStore.setItemAsync(
      STORAGE_KEYS.USER_PROFILE_DATA,
      JSON.stringify(profileData),
      options
    );

    console.log('Profile data stored securely');
    return true;
  } catch (error) {
    console.error('Failed to store profile data:', error);
    return false;
  }
}

/**
 * Retrieves profile data from secure storage
 * @returns Promise<any | null> The profile data object or null if not found/error
 */
export async function retrieveProfileData(): Promise<any | null> {
  try {
    const options = Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};

    const data = await SecureStore.getItemAsync(STORAGE_KEYS.USER_PROFILE_DATA, options);

    if (data) {
      return JSON.parse(data);
    }

    return null;
  } catch (error) {
    console.error('Failed to retrieve profile data:', error);
    return null;
  }
}
