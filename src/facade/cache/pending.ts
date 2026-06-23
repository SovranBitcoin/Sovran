// ---------------------------------------------------------------------------
// PendingSet — reference-counted "a fetch is in flight for this key" tracker.
//
// The entity cache answers "do we HAVE this profile"; it can't answer "are we
// FETCHING it". A binding needs both to tell a loading skeleton apart from a
// genuinely-absent profile (a fallback avatar). Reads wrap their network call in
// begin()/end() (in a `finally`), and a per-key counter survives overlapping
// reads: two concurrent fetches for the same pubkey both increment, and the key
// only leaves the set when the LAST one settles — so an early-settling read can't
// flip a still-loading key to absent, and an abort/error can't strand it loading.
// ---------------------------------------------------------------------------

export interface PendingSet {
  /** Whether at least one fetch is currently in flight for `key`. */
  has(key: string): boolean;
  /** Mark a fetch started for each key (increments its counter). */
  begin(keys: readonly string[]): void;
  /** Mark a fetch settled for each key (decrements; removes at zero). Call in `finally`. */
  end(keys: readonly string[]): void;
  /** Observe one key's pending transitions (idle↔loading). */
  subscribeKey(key: string, listener: () => void): () => void;
  /** Observe any pending transition. */
  subscribe(listener: () => void): () => void;
}

export function createPendingSet(): PendingSet {
  const counts = new Map<string, number>();
  const listeners = new Set<() => void>();
  const keyListeners = new Map<string, Set<() => void>>();

  function notifyGlobal(): void {
    for (const listener of listeners) listener();
  }
  function notifyKey(key: string): void {
    const set = keyListeners.get(key);
    if (set) for (const listener of set) listener();
  }

  return {
    has(key) {
      return (counts.get(key) ?? 0) > 0;
    },
    begin(keys) {
      let changed = false;
      for (const key of keys) {
        const prev = counts.get(key) ?? 0;
        counts.set(key, prev + 1);
        if (prev === 0) {
          notifyKey(key); // idle → loading
          changed = true;
        }
      }
      if (changed) notifyGlobal();
    },
    end(keys) {
      let changed = false;
      for (const key of keys) {
        const prev = counts.get(key) ?? 0;
        if (prev <= 1) {
          counts.delete(key);
          if (prev === 1) {
            notifyKey(key); // loading → idle
            changed = true;
          }
        } else {
          counts.set(key, prev - 1);
        }
      }
      if (changed) notifyGlobal();
    },
    subscribeKey(key, listener) {
      let set = keyListeners.get(key);
      if (!set) {
        set = new Set();
        keyListeners.set(key, set);
      }
      set.add(listener);
      return () => {
        const current = keyListeners.get(key);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) keyListeners.delete(key);
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
