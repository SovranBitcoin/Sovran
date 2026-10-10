import { profilePersistWrite } from './profileWriteBarrier';
import { type ZodType } from 'zod';
import { createJSONStorage, type PersistOptions, type StateStorage } from 'zustand/middleware';

import { redactError, storeLog } from '@/shared/lib/logger';
import type { LiveStore } from '@/shared/lib/account/accountRegistry';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';
import { declaredStores } from '@/shared/lib/account/accountRegistry';
import { guardUnreadable } from '@/shared/lib/persist/preserveUnreadable';

const DEFAULT_VERSION = 1;

interface PersistConfigOptions<TFull, TPartial> {
  /** Kebab-case AsyncStorage key (e.g. `'theme-store'`). */
  name: string;
  /** Backing storage adapter — typically `AsyncStorage`, `profileStorage`, or `createProfileScopedStorage()`. */
  storage: StateStorage;
  /**
   * Zod schema describing the persisted shape. Rejected blobs fall back to
   * in-memory state via `createMergeWithSchema`. Typed as `ZodType<unknown>`
   * because the schema's parsed shape (often a loose-object spread) does not
   * have to be assignment-compatible with the strict app type returned by
   * `partialize` — runtime validation is the contract, not compile-time
   * structural equivalence.
   */
  schema: ZodType<unknown>;
  /** Project the store into the persisted subset. */
  partialize: (state: TFull) => TPartial;
  /** Schema version. Defaults to 1 — bump and supply `migrate` when the persisted shape changes. */
  version?: number;
  /**
   * Optional migrator. The default is identity — schema validation in `merge`
   * is the canonical drift trap, so a no-op migrator is the right default for
   * unversioned legacy blobs.
   */
  migrate?: (state: unknown, version: number) => TPartial;
  /**
   * Snake_case slug for log namespacing and the `merge` schema label.
   * Defaults to deriving from `name` (`'theme-store'` → `'theme'`,
   * `'audit-mint-store'` → `'audit_mint'`).
   */
  logKey?: string;
  /**
   * Optional post-rehydration hook. Runs after the default error log;
   * receives the rehydrated state (`undefined` on error) and the error
   * (`undefined` on success). Use for side effects like applying mock-mode
   * or marking `_hasHydrated`.
   */
  afterHydrate?: (state: TFull | undefined, error: unknown) => void;
  /**
   * False in two cases. A store whose storage adapter keeps secrets out of the
   * blob it writes (`routstr-store`): what such an adapter hands back is rebuilt
   * with the secrets in it, and copying that to plain storage would expose
   * them, so the adapter has to protect unreadable data itself. And a cache
   * that can be fetched again, where replacing a bad blob is the right outcome.
   */
  preserveUnreadable?: boolean;
}

/**
 * Log a save that the storage rejected, then pass the rejection on. Once per
 * store and message: a full database fails every save the same way.
 *
 * The rejection must survive. Zustand ignores it for ordinary saves, but it
 * awaits the save after a migration, and recovery awaits these writes and
 * decides what to undo from whether they threw.
 */
function reportFailedSaves(logKey: string, storage: StateStorage): StateStorage {
  let lastMessage: string | null = null;
  return {
    getItem: (name) => storage.getItem(name),
    removeItem: (name) => storage.removeItem(name),
    setItem: async (name, value) => {
      try {
        await storage.setItem(name, value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastMessage) {
          lastMessage = message;
          storeLog.error(`store.${logKey}.save_failed`, {
            chars: value.length,
            error: redactError(error),
          });
        }
        throw error;
      }
    },
  };
}

/** Derive a snake_case log slug from the kebab-case `<name>-store` storage key. */
function deriveLogKey(name: string): string {
  return name.replace(/-store$/, '').replace(/-/g, '_');
}

/**
 * Registry of every persisted store's `{name, version, schema}`, populated as
 * stores are imported. A golden-snapshot test diffs the schema shape per
 * version so a non-additive schema edit without a `version` bump fails CI —
 * the one thing standing between a routine schema change and silent data loss
 * on the durable stores (createMergeWithSchema drops a whole blob it can't parse).
 */
interface PersistRegistryEntry extends Partial<LiveStore> {
  name: string;
  version: number;
  schema: ZodType<unknown>;
  /**
   * The store's own projection into the persisted subset. Registered so a test
   * can round-trip `schema.safeParse(partialize(state))`: a schema that rejects
   * what its own store writes discards the blob on EVERY rehydrate, which is
   * silent, permanent data loss that no other guard here can see (the drift
   * snapshot compares schemas to themselves, not to the data).
   */
  partialize: (state: never) => unknown;
  capturedOwner?: string;
}
export const persistRegistry: PersistRegistryEntry[] = [];

/**
 * Standard Zustand `persist` options for a Sovran store.
 *
 * Bundles the conventions every store currently re-implements:
 *   - explicit `version` so future schema bumps cannot silently wipe data;
 *   - identity `migrate` so a missing per-store migrator does not erase
 *     pre-version blobs (schema validation in `merge` is the drift trap);
 *   - `createJSONStorage` wrapping the supplied adapter;
 *   - `createMergeWithSchema` keyed on a derived snake_case namespace;
 *   - an `onRehydrateStorage` that logs failures via `storeLog` and chains
 *     into an optional `afterHydrate` extension.
 */
export function persistConfig<TFull, TPartial>(
  opts: PersistConfigOptions<TFull, TPartial>
): PersistOptions<TFull, TPartial> {
  const logKey = opts.logKey ?? deriveLogKey(opts.name);
  const migrate = opts.migrate ?? ((state) => state as TPartial);
  const version = opts.version ?? DEFAULT_VERSION;

  if (!persistRegistry.some((e) => e.name === opts.name)) {
    persistRegistry.push({
      name: opts.name,
      version,
      schema: opts.schema,
      capturedOwner:
        'profileStorageOwner' in opts.storage &&
        typeof opts.storage.profileStorageOwner === 'string'
          ? opts.storage.profileStorageOwner
          : undefined,
      partialize: opts.partialize as (state: never) => unknown,
    });
  }

  const profileScoped = declaredStores.some(
    (entry) => entry.name === opts.name && entry.scope === 'profile'
  );
  const storage: StateStorage = profileScoped
    ? {
        getItem: (name) => opts.storage.getItem(name),
        setItem: (name, value) => profilePersistWrite(() => opts.storage.setItem(name, value)),
        removeItem: (name) => profilePersistWrite(() => opts.storage.removeItem(name)),
      }
    : opts.storage;
  // Zustand does not look at the result of a save. One that fails (on Android,
  // most often because AsyncStorage is full) would otherwise leave no trace.
  const reported = reportFailedSaves(logKey, storage);
  const guard =
    opts.preserveUnreadable === false ? null : guardUnreadable(opts.name, logKey, reported);
  const mergeWithSchema = createMergeWithSchema(logKey, opts.schema);
  return {
    name: opts.name,
    storage: createJSONStorage(() => guard?.storage ?? reported),
    version,
    partialize: opts.partialize,
    migrate,
    merge: (persisted, current) => {
      const merged = mergeWithSchema(persisted, current);
      // The schema merge hands back `current` itself when it turns a blob down.
      if (persisted && typeof persisted === 'object' && merged === current) guard?.reject();
      return merged;
    },
    onRehydrateStorage: () => (state, error) => {
      if (error) {
        // An unparseable blob or a throwing `migrate` ends up here, not in `merge`.
        guard?.reject();
        storeLog.warn(`store.${logKey}.rehydrate_failed`, { error: redactError(error) });
      }
      opts.afterHydrate?.(state, error);
    },
  };
}
