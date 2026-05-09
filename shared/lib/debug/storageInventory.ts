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

interface SecureStoreInventoryEntry {
  key: string;
  exists: boolean;
}

interface StorageInventorySnapshot {
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

/**
 * Read every key in AsyncStorage and return a parsed dump.
 * Values that are valid JSON are parsed; others are kept as raw strings.
 * Useful for debugging migrations — the output matches the old
 * "Share Full Dump" format from the v0.0.60 Storage Inspector.
 *
 * The result is passed through `redactStorageDump` before returning so
 * that callers (Settings → Share Sheet) cannot exfiltrate bearer
 * instruments (cashu tokens, lightning invoices) or precise device
 * geolocation. The raw shape lives only in process memory between
 * `multiGet` and the redactor.
 */
export async function getFullAsyncStorageDump(): Promise<Record<string, unknown>> {
  const allKeys = await AsyncStorage.getAllKeys();
  const pairs = await AsyncStorage.multiGet(allKeys);
  const raw: Record<string, unknown> = {};
  for (const [key, value] of pairs) {
    if (value == null) continue;
    try {
      raw[key] = JSON.parse(value);
    } catch {
      raw[key] = value;
    }
  }
  return redactStorageDump(raw);
}

const REDACTED_GEOLOCATION_KEY_PATTERN = /^transaction-location-store(:|$)/;

const CASHU_TOKEN_PATTERN = /\bcashu[AB][A-Za-z0-9_-]{20,}/g;
const LIGHTNING_INVOICE_PATTERN = /\bln(bc|tb|bcrt|sb)[0-9]{1,12}[a-z0-9]{20,}/gi;

/**
 * Strip bearer instruments and precise location data from a parsed
 * AsyncStorage dump.
 *
 * Geolocation: every key prefixed with `transaction-location-store`
 * (the Zustand store and any profile-scoped variants) is dropped
 * outright — there is no triage value in a redacted lat/lon.
 *
 * Bearer instruments: cashu token strings (`cashuA…` / `cashuB…`) and
 * lightning invoices (`lnbc…` / `lntb…` / `lnbcrt…` / `lnsb…`) are
 * recursively replaced inside any string value, since they leak
 * spendable funds or in-flight payment metadata if shared verbatim.
 *
 * Pure: callers are free to dump the redacted shape to Share.share,
 * console, or a support channel.
 */
export function redactStorageDump(dump: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dump)) {
    if (REDACTED_GEOLOCATION_KEY_PATTERN.test(key)) {
      result[key] = '<REDACTED:geolocation-store>';
      continue;
    }
    result[key] = redactValue(value);
  }
  return result;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v);
    }
    return out;
  }
  return value;
}

function redactString(s: string): string {
  return s
    .replace(CASHU_TOKEN_PATTERN, '<REDACTED:cashu-token>')
    .replace(LIGHTNING_INVOICE_PATTERN, '<REDACTED:lightning-invoice>');
}
