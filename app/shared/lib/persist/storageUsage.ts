import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { redactError, storeLog } from '@/shared/lib/logger';

/**
 * On Android, AsyncStorage is one SQLite database with a total cap (6 MB
 * unless the native build raises it), and a single row over about 2 MB can be
 * written but not read back. Past the cap, saves fail. Nothing else in the app
 * can see how close an install is, so this measures it.
 */
const ANDROID_TOTAL_CAP_CHARS = 6 * 1024 * 1024;
const WARN_AT_FRACTION = 0.75;
const LARGE_ROW_CHARS = 1_500_000;

interface StorageUsage {
  rows: number;
  /** Characters stored, keys and values together. A lower bound on bytes. */
  totalChars: number;
  /** Rows that could not be read back, usually because they are too large. */
  unreadableRows: number;
  /** The largest rows, by store name with any profile key removed. */
  largest: { store: string; chars: number }[];
}

/**
 * A key reduced to a name. Keys carry identities in several shapes (a profile
 * suffix, a pubkey inside a cache key, a counterparty in a message index); any
 * run of hex or a bech32 key is replaced, so what is logged names a store and
 * never a person.
 */
const storeName = (key: string) =>
  key.replace(/[0-9a-f]{32,}/gi, '[id]').replace(/\b(npub|nsec|note)1[0-9a-z]{20,}/gi, '[id]');

export async function measureAsyncStorageUsage(): Promise<StorageUsage> {
  const keys = await AsyncStorage.getAllKeys();
  const sizes: { store: string; chars: number }[] = [];
  let totalChars = 0;
  let unreadableRows = 0;
  // One row at a time: a batch read fails as a whole when one row is too large.
  for (const key of keys) {
    try {
      const value = await AsyncStorage.getItem(key);
      const chars = key.length + (value?.length ?? 0);
      totalChars += chars;
      sizes.push({ store: storeName(key), chars });
    } catch {
      unreadableRows += 1;
      sizes.push({ store: storeName(key), chars: -1 });
    }
  }
  sizes.sort((a, b) => b.chars - a.chars);
  return {
    rows: keys.length,
    totalChars,
    unreadableRows,
    largest: [
      ...sizes.filter((row) => row.chars < 0),
      ...sizes.filter((row) => row.chars >= 0),
    ].slice(0, 5),
  };
}

/**
 * Measure once and log it. A warning when the install is close to the Android
 * cap, holds a row near the size that cannot be read back, or already has one
 * that cannot. Never throws.
 */
export async function reportAsyncStorageUsage(): Promise<void> {
  // The result only goes to the log. Reading every row is not free, so do
  // nothing where the log would discard it.
  if (typeof storeLog.isLevelEnabled === 'function' && !storeLog.isLevelEnabled('info')) return;
  try {
    const usage = await measureAsyncStorageUsage();
    const android = Platform.OS === 'android';
    // The total cap and the unreadable-row size are Android's. A row that
    // cannot be read is worth a warning anywhere.
    const nearCap = android && usage.totalChars > ANDROID_TOTAL_CAP_CHARS * WARN_AT_FRACTION;
    const largeRow = android && usage.largest.some((row) => row.chars > LARGE_ROW_CHARS);
    const report = { ...usage, capChars: android ? ANDROID_TOTAL_CAP_CHARS : null };
    if (nearCap || largeRow || usage.unreadableRows > 0)
      storeLog.warn('storage.usage.high', report);
    else storeLog.info('storage.usage', report);
  } catch (error) {
    storeLog.warn('storage.usage.unmeasured', { error: redactError(error) });
  }
}
