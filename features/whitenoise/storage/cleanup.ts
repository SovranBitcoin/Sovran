import AsyncStorage from '@react-native-async-storage/async-storage';
import { log } from '@/shared/lib/logger';

const wnLog = log.child({ module: 'whitenoise' });

// All AsyncStorage prefixes Whitenoise writes under, namespaced per account.
// Keep this list in sync with:
//   - storage/index.ts          (group-state, key-package)
//   - storage/inviteStore.ts    (invite-received, invite-unread, invite-seen)
//   - storage/groupHistory.ts   (history)
//   - storage/dmIndex.ts        (dm-index)
const WHITENOISE_NAMESPACES = [
  'group-state',
  'key-package',
  'invite-received',
  'invite-unread',
  'invite-seen',
  'history',
  'dm-index',
] as const;

function prefixFor(accountIndex: number, namespace: string): string {
  return `whitenoise:${accountIndex}:${namespace}:`;
}

/**
 * Wipe every AsyncStorage key Whitenoise wrote under the given account.
 *
 * Safe to call when the active profile is the one being wiped — but note that
 * any in-flight storage writes from a still-mounted WhitenoiseProvider will
 * race with this. Callers (profile delete, profile reset) should run this
 * AFTER tearing down the provider tree, or accept that the app is about to
 * restart anyway and a few orphaned keys are harmless.
 */
export async function wipeWhitenoiseStorage(accountIndex: number): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const toRemove: string[] = [];
    for (const ns of WHITENOISE_NAMESPACES) {
      const prefix = prefixFor(accountIndex, ns);
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
