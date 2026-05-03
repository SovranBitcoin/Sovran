import AsyncStorage from '@react-native-async-storage/async-storage';
import { wnLog } from '@/shared/lib/logger';
import { WhitenoiseNamespace, whitenoisePrefix } from './namespaces';

/**
 * Wipe every AsyncStorage key Whitenoise wrote under the given account.
 *
 * Safe to call when the active profile is the one being wiped — but note that
 * any in-flight storage writes from a still-mounted WhitenoiseProvider will
 * race with this. Callers (profile delete, profile reset) should run this
 * AFTER tearing down the provider tree, or accept that the app is about to
 * restart anyway and a few orphaned keys are harmless.
 */
async function wipeWhitenoiseStorage(accountIndex: number): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const toRemove: string[] = [];
    for (const ns of Object.values(WhitenoiseNamespace)) {
      const prefix = `${whitenoisePrefix(accountIndex, ns)}:`;
      for (const k of allKeys) {
        if (k.startsWith(prefix)) toRemove.push(k);
      }
    }
    if (toRemove.length === 0) {
      wnLog.debug('whitenoise.storage.wipe.empty', { accountIndex });
      return;
    }
    await AsyncStorage.multiRemove(toRemove);
    wnLog.info('whitenoise.storage.wipe.done', {
      accountIndex,
      removed: toRemove.length,
    });
  } catch (error) {
    wnLog.warn('whitenoise.storage.wipe.failed', {
      accountIndex,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Wipe Whitenoise data for every account passed in. Best-effort. */
export async function wipeWhitenoiseStorageForAccounts(
  accountIndexes: readonly number[]
): Promise<void> {
  await Promise.all(accountIndexes.map((i) => wipeWhitenoiseStorage(i)));
}
