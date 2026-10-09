import type { StateStorage } from 'zustand/middleware';

import { redactError, storeLog } from '@/shared/lib/logger';

/**
 * Where a store's unreadable blob is kept. Appended to the store's name before
 * the storage adapter adds its own scope, so a per-profile store's copy lives
 * at `<store>:unreadable:profile:<pubkey>` and is owned by that profile.
 */
const UNREADABLE_SUFFIX = ':unreadable';

/** The side key a store's unreadable blob is copied to, before scoping. */
export function unreadableKey(name: string): string {
  return `${name}${UNREADABLE_SUFFIX}`;
}

/**
 * Stops a store from destroying data it could not load.
 *
 * A store whose blob fails to load runs on defaults, and its next write would
 * replace the blob. Two cases, handled differently:
 *
 * - **The blob was read but rejected** (unparseable, or refused by `migrate`
 *   or the schema). Its bytes are copied to the side key before the first
 *   overwrite. The store then carries on; a later release can recover the copy.
 *   An existing copy is never replaced: the first one is the one most likely
 *   to hold real data.
 * - **The read itself failed.** There are no bytes to copy, so writes are
 *   refused until a read succeeds. Nothing is lost; the store forgets changes
 *   made in the meantime.
 *
 * A copy that cannot be written and read back also refuses the overwrite, and
 * the next write tries the copy again.
 *
 * Meant for data a person would miss. A cache that can be fetched again should
 * opt out (`preserveUnreadable: false`): for it, replacing a bad blob is the
 * right outcome, and refusing would leave it unable to save.
 *
 * Sits under `createJSONStorage`, so it sees the raw string before zustand
 * parses or migrates it. `reject` is called by the persist options when the
 * parsed blob is turned down.
 */
export function guardUnreadable(
  name: string,
  logKey: string,
  storage: StateStorage
): { storage: StateStorage; reject: () => void } {
  /** What the last read returned. Undefined until a read has succeeded. */
  let raw: string | null | undefined;
  let readFailed = false;
  let rejected = false;
  let preserving: Promise<boolean> | null = null;
  let refusalLogged = false;
  /** Bumped by every read, so a write that waited can tell the store has reloaded. */
  let generation = 0;

  const refuse = (reason: string) => {
    if (refusalLogged) return;
    refusalLogged = true;
    storeLog.warn(`store.${logKey}.write_refused`, { reason });
  };

  const preserve = async (blob: string): Promise<boolean> => {
    const side = unreadableKey(name);
    try {
      if ((await storage.getItem(side)) !== null) return true;
      await storage.setItem(side, blob);
      // A write can be dropped without an error (the profile write barrier),
      // so only a copy that reads back counts.
      const kept = (await storage.getItem(side)) === blob;
      if (kept) storeLog.warn(`store.${logKey}.unreadable_preserved`, { bytes: blob.length });
      return kept;
    } catch (error) {
      storeLog.warn(`store.${logKey}.preserve_failed`, { error: redactError(error) });
      return false;
    }
  };

  return {
    reject: () => {
      rejected = true;
    },
    storage: {
      getItem: async (key) => {
        // A fresh read starts a fresh verdict: the store may be reloading
        // under another profile's key.
        generation += 1;
        rejected = false;
        preserving = null;
        refusalLogged = false;
        try {
          const value = await storage.getItem(key);
          raw = value;
          readFailed = false;
          return value;
        } catch (error) {
          readFailed = true;
          raw = undefined;
          throw error;
        }
      },
      setItem: async (key, value) => {
        if (readFailed) return refuse('read_failed');
        if (rejected && typeof raw === 'string') {
          const startedAt = generation;
          preserving ??= preserve(raw);
          const attempt = preserving;
          if (!(await attempt)) {
            // Not remembered: a copy dropped by the profile write barrier or a
            // passing storage error must not stop this store saving for good.
            // The next write tries the copy again.
            if (preserving === attempt) preserving = null;
            return refuse('not_preserved');
          }
          // The store reloaded while this waited, possibly under another
          // profile's key. This write belongs to what was loaded before.
          if (startedAt !== generation) return;
        }
        // Reached without yielding in the ordinary case: a profile-scoped
        // adapter works out whose key to write when it is called.
        await storage.setItem(key, value);
      },
      removeItem: (key) => storage.removeItem(key),
    },
  };
}
