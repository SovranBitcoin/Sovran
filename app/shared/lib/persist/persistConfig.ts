import { type ZodType } from 'zod';
import { createJSONStorage, type PersistOptions, type StateStorage } from 'zustand/middleware';

import { redactError, storeLog } from '@/shared/lib/logger';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

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
interface PersistRegistryEntry {
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
      partialize: opts.partialize as (state: never) => unknown,
    });
  }

  return {
    name: opts.name,
    storage: createJSONStorage(() => opts.storage),
    version,
    partialize: opts.partialize,
    migrate,
    merge: createMergeWithSchema(logKey, opts.schema),
    onRehydrateStorage: () => (state, error) => {
      if (error) {
        storeLog.warn(`store.${logKey}.rehydrate_failed`, { error: redactError(error) });
      }
      opts.afterHydrate?.(state, error);
    },
  };
}
