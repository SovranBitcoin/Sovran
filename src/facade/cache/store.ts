// ---------------------------------------------------------------------------
// NormalizingStore — a bounded, additive, observable entity map
//
// The reusable primitive behind the facade's shared cache. It keys records by a
// stable id and combines writes with a FIELD-LEVEL additive merge: a partial
// write fills/overwrites only the fields it carries and never clobbers fields it
// omits. That lets a cheap "seed" (a feed item's name+picture) and a later rich
// fetch (full kind-0 metadata) accumulate into one record without either erasing
// the other — the property that makes re-seeing an entity instant.
//
// The merge strategy is pluggable so callers can add monotonic guards (e.g. a
// stale profile seed must not overwrite a fresher one). Recency-LRU bounds memory
// (touched on read AND write, so hot entities survive). A pub/sub seam lets a
// binding (React or otherwise) revalidate on change without the core knowing it.
// ---------------------------------------------------------------------------

/** Combine a partial write with the existing record into the stored record. */
export type Merge<T> = (existing: T | undefined, patch: Partial<T>) => T;

export type NormalizingStoreOptions<T> = {
  /** Max entries before least-recently-touched eviction. */
  maxEntries: number;
  /**
   * How a patch combines with the existing record. Defaults to field-level
   * additive (undefined-preserving), last-writer-wins.
   */
  merge?: Merge<T>;
};

export interface NormalizingStore<T> {
  get(key: string): T | undefined;
  /** Resolve many keys at once; index-aligned, `undefined` where absent. */
  getMany(keys: readonly string[]): Array<T | undefined>;
  has(key: string): boolean;
  set(key: string, patch: Partial<T>): void;
  /** Apply many writes and notify subscribers exactly ONCE (no notify storm). */
  setMany(entries: Iterable<readonly [string, Partial<T>]>): void;
  delete(key: string): void;
  clear(): void;
  /** Iterate stored records (insertion order). Does NOT touch LRU recency. */
  values(): IterableIterator<T>;
  /** Observe changes. Returns an unsubscribe. Listeners decide when to revalidate. */
  subscribe(listener: () => void): () => void;
  readonly size: number;
}

/**
 * Field-level additive merge: a copy of `existing` overlaid with every DEFINED
 * field of `patch`. Omitted/undefined fields are preserved — never clobbered.
 */
export function fieldLevelMerge<T>(existing: T | undefined, patch: Partial<T>): T {
  const base: T = existing ? { ...existing } : ({} as T);
  for (const key in patch) {
    const value = patch[key];
    if (value !== undefined) base[key] = value as T[Extract<keyof T, string>];
  }
  return base;
}

export function createNormalizingStore<T>(options: NormalizingStoreOptions<T>): NormalizingStore<T> {
  const { maxEntries } = options;
  const merge = options.merge ?? fieldLevelMerge;
  // Map preserves insertion order; we re-insert on touch so the first key is
  // always the least-recently-used, giving O(1) eviction.
  const map = new Map<string, T>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  /** Move a key to the most-recently-used position. */
  function touch(key: string, value: T): void {
    map.delete(key);
    map.set(key, value);
  }

  function evict(): void {
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  /** Merge one write into the map WITHOUT notifying. Returns nothing. */
  function write(key: string, patch: Partial<T>): void {
    const merged = merge(map.get(key), patch);
    touch(key, merged);
  }

  return {
    get(key) {
      const value = map.get(key);
      if (value !== undefined) touch(key, value);
      return value;
    },
    getMany(keys) {
      return keys.map((key) => this.get(key));
    },
    has(key) {
      return map.has(key);
    },
    set(key, patch) {
      write(key, patch);
      evict();
      notify();
    },
    setMany(entries) {
      let wrote = false;
      for (const [key, patch] of entries) {
        write(key, patch);
        wrote = true;
      }
      if (!wrote) return;
      evict();
      notify();
    },
    delete(key) {
      if (map.delete(key)) notify();
    },
    values() {
      return map.values();
    },
    clear() {
      if (map.size === 0) return;
      map.clear();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get size() {
      return map.size;
    },
  };
}
