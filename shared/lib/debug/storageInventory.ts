import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';

import type { ProfileEntry } from '@/shared/stores/global/profileStore';

const GLOBAL_ZUSTAND_STORE_KEYS = [
  'settings-store',
  'profile-store',
  'pricelist-store',
  'btcmap-store',
  'kym-mint-store',
  'audit-mint-store',
];

const PROFILE_ZUSTAND_STORE_KEYS = [
  'mint-store',
  'mint-distribution-store',
  'npc-mint-store',
  'routstr-store',
  'scan-history-store',
  'search-history-store',
  'swap-transactions-store',
  'transaction-location-store',
  'nostr-social-store',
];

const SECURE_STORE_KEY_PREFIXES = {
  migrations: 'migrations_complete_',
  derived: 'derived_keys_',
  cashuMnemonic: 'cashu_mnemonic_',
  importedNsec: 'imported_nsec_',
} as const;

const SECURE_STORE_STATIC_KEYS = ['user_mnemonic', 'migrations_complete'] as const;

const COCO_DB_REGEX = /^coco(?:-\d+)?\.db(?:-(?:wal|shm|journal))?$/;

export interface ZustandInventory {
  existingGlobalStoreKeys: string[];
  existingProfileStoreKeys: string[];
  existingLegacyBareProfileKeys: string[];
  existingUncategorizedStoreKeys: string[];
}

export interface SecureStoreInventoryEntry {
  key: string;
  exists: boolean;
}

export interface StorageInventorySnapshot {
  zustand: ZustandInventory;
  secureStore: SecureStoreInventoryEntry[];
  cocoDatabases: string[];
}

function buildSecureStoreProbeKeys(profiles: ProfileEntry[]): string[] {
  const accountIndexes = new Set<number>([0]);
  const importedPubkeys = new Set<string>();

  for (const profile of profiles) {
    accountIndexes.add(profile.accountIndex);
    if (profile.source === 'imported') {
      importedPubkeys.add(profile.pubkey);
    }
  }

  const keys = new Set<string>(SECURE_STORE_STATIC_KEYS);

  for (const index of accountIndexes) {
    keys.add(`${SECURE_STORE_KEY_PREFIXES.migrations}${index}`);
    keys.add(`${SECURE_STORE_KEY_PREFIXES.derived}${index}`);
    keys.add(`${SECURE_STORE_KEY_PREFIXES.cashuMnemonic}${index}`);
  }

  for (const pubkey of importedPubkeys) {
    keys.add(`${SECURE_STORE_KEY_PREFIXES.importedNsec}${pubkey}`);
  }

  return [...keys].sort();
}

async function getZustandInventory(): Promise<ZustandInventory> {
  const keys = await AsyncStorage.getAllKeys();
  const keySet = new Set(keys);

  const existingGlobalStoreKeys = [...GLOBAL_ZUSTAND_STORE_KEYS].filter((key) => keySet.has(key));
  const existingLegacyBareProfileKeys = [...PROFILE_ZUSTAND_STORE_KEYS].filter((key) =>
    keySet.has(key)
  );
  const existingProfileStoreKeys = keys
    .filter((key) => PROFILE_ZUSTAND_STORE_KEYS.some((base) => key.startsWith(`${base}:profile:`)))
    .sort();

  const knownStorePrefixes = [...GLOBAL_ZUSTAND_STORE_KEYS, ...PROFILE_ZUSTAND_STORE_KEYS];
  const existingUncategorizedStoreKeys = keys
    .filter((key) => knownStorePrefixes.some((prefix) => key.startsWith(prefix)))
    .filter(
      (key) =>
        !existingGlobalStoreKeys.includes(key) &&
        !existingLegacyBareProfileKeys.includes(key) &&
        !existingProfileStoreKeys.includes(key)
    )
    .sort();

  return {
    existingGlobalStoreKeys,
    existingProfileStoreKeys,
    existingLegacyBareProfileKeys,
    existingUncategorizedStoreKeys,
  };
}

async function getSecureStoreInventory(
  profiles: ProfileEntry[]
): Promise<SecureStoreInventoryEntry[]> {
  const keys = buildSecureStoreProbeKeys(profiles);
  const entries = await Promise.all(
    keys.map(async (key) => {
      const value = await SecureStore.getItemAsync(key);
      return { key, exists: value != null };
    })
  );

  return entries;
}

async function getCocoDatabaseInventory(): Promise<string[]> {
  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) return [];

  const sqliteDirectory = `${documentDirectory}SQLite`;

  try {
    const files = await FileSystem.readDirectoryAsync(sqliteDirectory);
    return files.filter((file) => COCO_DB_REGEX.test(file)).sort();
  } catch {
    return [];
  }
}

export async function getStorageInventorySnapshot(
  profiles: ProfileEntry[]
): Promise<StorageInventorySnapshot> {
  const [zustand, secureStore, cocoDatabases] = await Promise.all([
    getZustandInventory(),
    getSecureStoreInventory(profiles),
    getCocoDatabaseInventory(),
  ]);

  return { zustand, secureStore, cocoDatabases };
}
