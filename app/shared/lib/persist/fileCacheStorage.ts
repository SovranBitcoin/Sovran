import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { StateStorage } from 'zustand/middleware';

import { redactError, storeLog } from '@/shared/lib/logger';

/**
 * Keeps one large, refetchable blob in a file instead of AsyncStorage.
 *
 * On Android, AsyncStorage is one SQLite database capped at 6 MB in total, and
 * a single row over about 2 MB can be written but never read back ("Row too
 * big to fit into CursorWindow"). A cache of that size therefore failed to
 * load on every start while taking a third of the space every other store
 * shares. A file has neither limit.
 *
 * The file lives in the cache directory, which the system may clear: use this
 * only for data that can be fetched again. A value is written to a temporary
 * file and moved into place, so a write cut short leaves the previous value.
 * Writes and removals for a key run one at a time, in the order they were
 * made; zustand does not wait for one save before starting the next.
 *
 * The first read also clears the row an earlier release left under the same
 * key in AsyncStorage, adopting its value where it can still be read.
 */
export function createFileCacheStorage(): StateStorage {
  const queues = new Map<string, Promise<unknown>>();
  const inOrder = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const next = (queues.get(key) ?? Promise.resolve()).then(work, work);
    queues.set(
      key,
      next.catch(() => undefined)
    );
    return next;
  };
  const checkedForLeftoverRow = new Set<string>();

  const pathFor = (key: string) =>
    `${FileSystem.cacheDirectory}store-${key.replace(/[^a-z0-9-]/gi, '_')}.json`;
  // No cache directory (a platform without one, or a test without the file
  // system): the cache simply does not persist. It is a cache.
  const unavailable = () => !FileSystem.cacheDirectory;

  /** Take over the value an earlier release kept in AsyncStorage, then free its row. */
  const adoptLegacyRow = async (key: string): Promise<string | null> => {
    let legacy: string | null = null;
    try {
      legacy = await AsyncStorage.getItem(key);
    } catch (error) {
      // Android cannot read a row this large. It is a cache: drop it.
      storeLog.info('store.file_cache.legacy_row_unreadable', { error: redactError(error) });
    }
    await AsyncStorage.removeItem(key).catch(() => undefined);
    return legacy;
  };

  const write = async (key: string, value: string) => {
    const path = pathFor(key);
    const temporary = `${path}.tmp`;
    await FileSystem.writeAsStringAsync(temporary, value);
    await FileSystem.deleteAsync(path, { idempotent: true });
    await FileSystem.moveAsync({ from: temporary, to: path });
  };

  return {
    getItem: (key) =>
      inOrder(key, async () => {
        if (unavailable()) return null;
        const path = pathFor(key);
        if ((await FileSystem.getInfoAsync(path)).exists) {
          // Once per run is enough to clear a row left beside the file.
          if (!checkedForLeftoverRow.has(key)) {
            checkedForLeftoverRow.add(key);
            await adoptLegacyRow(key);
          }
          return FileSystem.readAsStringAsync(path);
        }
        const legacy = await adoptLegacyRow(key);
        if (legacy !== null) await write(key, legacy).catch(() => undefined);
        return legacy;
      }),
    setItem: (key, value) =>
      inOrder(key, async () => {
        if (!unavailable()) await write(key, value);
      }),
    removeItem: (key) =>
      inOrder(key, async () => {
        if (unavailable()) return;
        const path = pathFor(key);
        await FileSystem.deleteAsync(path, { idempotent: true });
        await FileSystem.deleteAsync(`${path}.tmp`, { idempotent: true });
        await AsyncStorage.removeItem(key).catch(() => undefined);
      }),
  };
}
