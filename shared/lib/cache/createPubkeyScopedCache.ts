/**
 * Two-tier cache (in-memory + AsyncStorage) keyed by an external "scope"
 * identifier — typically a Nostr recipient pubkey, but the factory is
 * agnostic. Powers `giftWrapCache` (NIP-17 unwraps) and `nip04Cache`
 * (NIP-04 plaintext); both used to be hand-rolled and drifted apart.
 *
 * Why this is NOT just a Zustand-persist store: callers (the picker, the
 * messages screen) need synchronous reads in a `useMemo` that runs before
 * profileStore hydration completes. Going through `createProfileScopedStorage`
 * would block hydration behind the migration gate, defeating the whole
 * "warm before first picker mount" goal. Scope is taken as an explicit
 * argument so callers control timing.
 *
 * The negative-cache (failed-key memoization) is a separate persisted
 * blob so a flood of malformed keys can't evict legitimate decryptions.
 * Disabled by omitting `storagePrefixNeg` from opts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Logger } from '@/shared/lib/logger';

export interface PubkeyScopedCacheOpts<T> {
  /** Storage prefix for the positive blob. Final key: `{prefix}:{scope}`. */
  storagePrefix: string;
  /** Storage prefix for the negative blob. Omit to disable negative cache. */
  storagePrefixNeg?: string;
  /** Soft cap on positive entries per scope. LRU-evicts oldest 10% on overflow. */
  maxEntries?: number;
  /** Soft cap on negative entries per scope. */
  maxNegEntries?: number;
  /** Coalesce writes within this many ms before flushing to AsyncStorage. */
  flushDebounceMs?: number;
  /** Logger to emit cache.* events on. */
  log: Logger;
  /**
   * Discard hydrated entries that fail this guard. Defensive — protects
   * against partial / corrupt blobs without wiping the whole cache.
   * Default: accept any non-nullish value.
   */
  validate?: (value: unknown) => value is T;
}

export interface PubkeyScopedCache<T> {
  hydrate(scope: string): Promise<void>;
  get(scope: string, key: string): T | undefined;
  put(scope: string, key: string, value: T): void;
  isKnownFailed(scope: string, key: string): boolean;
  markFailed(scope: string, key: string): void;
  clear(scope: string): Promise<void>;
  evictFromMemory(scope: string): void;
}

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

interface PerScopeCache<T> {
  scope: string;
  storageKey: string;
  storageKeyNeg: string | null;
  memory: Map<string, CacheEntry<T>>;
  negative: Map<string, number>;
  hydrated: boolean;
  hydratePromise: Promise<void> | null;
  dirty: boolean;
  dirtyNeg: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

export function createPubkeyScopedCache<T>(
  opts: PubkeyScopedCacheOpts<T>,
): PubkeyScopedCache<T> {
  const maxEntries = opts.maxEntries ?? 1000;
  const maxNegEntries = opts.maxNegEntries ?? 200;
  const flushDebounceMs = opts.flushDebounceMs ?? 1000;
  const validate = opts.validate ?? ((v): v is T => v !== null && v !== undefined);
  const { log } = opts;
  const negEnabled = !!opts.storagePrefixNeg;

  const scopes = new Map<string, PerScopeCache<T>>();

  function getScope(scope: string): PerScopeCache<T> {
    let s = scopes.get(scope);
    if (!s) {
      s = {
        scope,
        storageKey: `${opts.storagePrefix}:${scope}`,
        storageKeyNeg: opts.storagePrefixNeg ? `${opts.storagePrefixNeg}:${scope}` : null,
        memory: new Map(),
        negative: new Map(),
        hydrated: false,
        hydratePromise: null,
        dirty: false,
        dirtyNeg: false,
        flushTimer: null,
      };
      scopes.set(scope, s);
    }
    return s;
  }

  function evictLRU<V>(map: Map<string, V>, max: number, sortKey: (v: V) => number): number {
    if (map.size <= max) return 0;
    const evictCount = Math.floor(max * 0.1);
    const sorted = Array.from(map.entries()).sort((a, b) => sortKey(a[1]) - sortKey(b[1]));
    for (let i = 0; i < evictCount; i++) map.delete(sorted[i][0]);
    return evictCount;
  }

  function scheduleFlush(s: PerScopeCache<T>): void {
    if (s.flushTimer) return;
    s.flushTimer = setTimeout(() => {
      s.flushTimer = null;
      void flush(s);
    }, flushDebounceMs);
  }

  async function flush(s: PerScopeCache<T>): Promise<void> {
    if (!s.dirty && !s.dirtyNeg) return;
    const t0 = performance.now();
    // Snapshot up-front so a write landing during the await doesn't get
    // dropped. Failed writes restore the dirty flag for retry.
    const wasDirty = s.dirty;
    const wasDirtyNeg = s.dirtyNeg;
    s.dirty = false;
    s.dirtyNeg = false;

    const writes: Promise<unknown>[] = [];
    if (wasDirty) {
      const obj: Record<string, CacheEntry<T>> = {};
      for (const [k, v] of s.memory) obj[k] = v;
      writes.push(AsyncStorage.setItem(s.storageKey, JSON.stringify(obj)));
    }
    if (wasDirtyNeg && s.storageKeyNeg) {
      const obj: Record<string, number> = {};
      for (const [k, v] of s.negative) obj[k] = v;
      writes.push(AsyncStorage.setItem(s.storageKeyNeg, JSON.stringify(obj)));
    }

    const results = await Promise.allSettled(writes);
    if (results.some((r) => r.status === 'rejected')) {
      if (wasDirty) s.dirty = true;
      if (wasDirtyNeg) s.dirtyNeg = true;
      log.warn(`${opts.storagePrefix}.flush_failed`, { scope: s.scope.slice(0, 8) });
      return;
    }

    log.debug(`${opts.storagePrefix}.flushed`, {
      scope: s.scope.slice(0, 8),
      entries: s.memory.size,
      negativeEntries: s.negative.size,
      duration_ms: Math.round((performance.now() - t0) * 100) / 100,
    });
  }

  return {
    async hydrate(scope: string): Promise<void> {
      const s = getScope(scope);
      if (s.hydrated) return;
      if (s.hydratePromise) return s.hydratePromise;

      s.hydratePromise = (async () => {
        const t0 = performance.now();
        const reads: Promise<string | null>[] = [AsyncStorage.getItem(s.storageKey)];
        if (s.storageKeyNeg) reads.push(AsyncStorage.getItem(s.storageKeyNeg));
        const [posRes, negRes] = await Promise.allSettled(reads);

        if (posRes.status === 'fulfilled' && posRes.value) {
          try {
            const parsed = JSON.parse(posRes.value) as Record<string, CacheEntry<unknown>>;
            for (const [key, entry] of Object.entries(parsed)) {
              if (entry && typeof entry.cachedAt === 'number' && validate(entry.value)) {
                s.memory.set(key, { value: entry.value, cachedAt: entry.cachedAt });
              }
            }
          } catch (error) {
            log.warn(`${opts.storagePrefix}.hydrate_parse_failed`, {
              scope: scope.slice(0, 8),
              error,
            });
          }
        }

        if (negRes && negRes.status === 'fulfilled' && negRes.value) {
          try {
            const parsed = JSON.parse(negRes.value) as Record<string, number>;
            for (const [key, cachedAt] of Object.entries(parsed)) {
              if (typeof cachedAt === 'number') s.negative.set(key, cachedAt);
            }
          } catch (error) {
            log.warn(`${opts.storagePrefix}.hydrate_neg_parse_failed`, {
              scope: scope.slice(0, 8),
              error,
            });
          }
        }

        log.info(`${opts.storagePrefix}.hydrated`, {
          scope: scope.slice(0, 8),
          entries: s.memory.size,
          negativeEntries: s.negative.size,
          duration_ms: Math.round((performance.now() - t0) * 100) / 100,
        });
        s.hydrated = true;
      })();

      return s.hydratePromise;
    },

    get(scope, key) {
      return getScope(scope).memory.get(key)?.value;
    },

    put(scope, key, value) {
      const s = getScope(scope);
      s.memory.set(key, { value, cachedAt: Date.now() });
      const evicted = evictLRU(s.memory, maxEntries, (e) => e.cachedAt);
      if (evicted > 0) {
        log.debug(`${opts.storagePrefix}.evicted`, {
          scope: s.scope.slice(0, 8),
          evicted,
          remaining: s.memory.size,
        });
      }
      s.dirty = true;
      scheduleFlush(s);
    },

    isKnownFailed(scope, key) {
      if (!negEnabled) return false;
      return getScope(scope).negative.has(key);
    },

    markFailed(scope, key) {
      if (!negEnabled) return;
      const s = getScope(scope);
      s.negative.set(key, Date.now());
      evictLRU(s.negative, maxNegEntries, (v) => v);
      s.dirtyNeg = true;
      scheduleFlush(s);
    },

    async clear(scope) {
      const s = scopes.get(scope);
      if (s) {
        s.memory.clear();
        s.negative.clear();
        if (s.flushTimer) {
          clearTimeout(s.flushTimer);
          s.flushTimer = null;
        }
        s.dirty = false;
        s.dirtyNeg = false;
      }
      const removes: Promise<void>[] = [
        AsyncStorage.removeItem(`${opts.storagePrefix}:${scope}`),
      ];
      if (opts.storagePrefixNeg) {
        removes.push(AsyncStorage.removeItem(`${opts.storagePrefixNeg}:${scope}`));
      }
      const results = await Promise.allSettled(removes);
      if (results.some((r) => r.status === 'rejected')) {
        log.warn(`${opts.storagePrefix}.clear_failed`, { scope: scope.slice(0, 8) });
      }
    },

    // TODO: wire callers to invoke this on profile switch once
    // app-restart-on-switch is replaced with in-process switching. Today
    // the JS runtime tears down on switch so the in-memory `scopes` Map
    // resets automatically; the on-disk blobs stay scoped per pubkey.
    evictFromMemory(scope) {
      const s = scopes.get(scope);
      if (!s) return;
      if (s.dirty || s.dirtyNeg) void flush(s);
      if (s.flushTimer) {
        clearTimeout(s.flushTimer);
        s.flushTimer = null;
      }
      scopes.delete(scope);
    },
  };
}
