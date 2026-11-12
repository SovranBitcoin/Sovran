import { profilePersistWrite } from './profileWriteBarrier';
import { type ZodType } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  createJSONStorage,
  type PersistOptions,
  type StateStorage,
  type StorageValue,
} from 'zustand/middleware';

import { redactError, storeLog } from '@/shared/lib/logger';
import type { LiveStore } from '@/shared/lib/account/accountRegistry';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';
import { declaredStores } from '@/shared/lib/account/accountRegistry';
import { guardUnreadable, unreadableKey } from '@/shared/lib/persist/preserveUnreadable';
import {
  markHydrationFailed,
  markHydrationLoaded,
  markHydrationStarted,
} from '@/shared/lib/persist/hydrationOutcome';

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
  /**
   * The saved fields do not refer to each other, so when the schema turns the
   * blob down, the fields that still parse are kept instead of every field
   * falling back to its default. See `createMergeWithSchema`.
   */
  independentFields?: boolean;
  /**
   * Read back the copy this store set aside at `<name>:unreadable` once this
   * release's schema can parse it. Only for a store whose copies hold what a
   * person cannot get back any other way. See `recoverUnreadable`.
   */
  recoverUnreadable?: UnreadableRecovery<TFull, TPartial>;
}

interface UnreadableRecovery<TFull, TPartial> {
  /**
   * What the store would hold with the copy laid into it, keeping whatever
   * the store already has, and recording `copyId` as merged. Changes nothing.
   */
  merge: (recovered: TPartial, copyId: string) => TFull;
  /** Lay the copy into the live store the same way, once the merge is saved. */
  apply: (recovered: TPartial, copyId: string) => void;
  /** True when `saved` records that the copy `copyId` was already merged into it. */
  merged: (saved: TPartial, copyId: string) => boolean;
  /** True when `saved` holds everything in `recovered` that must survive, so the copy can go. */
  holds: (saved: TPartial, recovered: TPartial, copyId: string) => boolean;
  /**
   * Whose data is loaded: for a per-account store, the active account.
   * Recovery stops if it changes while a read or save is under way.
   */
  owner: () => string | undefined;
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

/**
 * A saved blob as this release reads it: migrated from the version it was
 * written at, then parsed by the schema. Null when it does not parse.
 */
function readBlob<TPartial>(
  raw: string,
  version: number,
  migrate: (state: unknown, version: number) => TPartial,
  schema: ZodType<unknown>
): TPartial | null {
  try {
    const blob = JSON.parse(raw) as Partial<StorageValue<unknown>> | null;
    if (!blob || typeof blob !== 'object') return null;
    // As zustand does on load: migrate whenever the versions differ.
    const state =
      blob.version === version ? blob.state : migrate(blob.state, blob.version as number);
    const parsed = schema.safeParse(state);
    return parsed.success ? (parsed.data as TPartial) : null;
  } catch {
    return null;
  }
}

/**
 * Fold the copy a store set aside at `<name>:unreadable` back into it, once
 * its schema can read the copy. Runs after a load that succeeded, for the
 * owner that load was for.
 *
 * The copy is removed only after the merged state has been saved and read
 * back under the main key, so a failed or dropped save, or a kill at any
 * point, leaves the copy, the merged state, or both; never neither. The merge
 * keeps what the store already has, so running it again adds nothing. A copy
 * that still does not parse is left where it is.
 */
async function recoverUnreadable<TFull, TPartial>(run: {
  name: string;
  logKey: string;
  version: number;
  migrate: (state: unknown, version: number) => TPartial;
  schema: ZodType<unknown>;
  partialize: (state: TFull) => TPartial;
  recovery: UnreadableRecovery<TFull, TPartial>;
  /** Raw reads and the removal, under the store's own scope. */
  storage: StateStorage;
  /** The store's own save path. */
  save: (value: StorageValue<TPartial>) => Promise<unknown> | unknown;
  /** False once the store has started another load. */
  stillLoaded: () => boolean;
}): Promise<void> {
  // A throw anywhere here rejects this promise; none reaches the hydration
  // callback, which zustand would call again with the error.
  const owner = run.recovery.owner();
  const current = () => run.stillLoaded() && run.recovery.owner() === owner;
  const side = unreadableKey(run.name);
  const raw = await run.storage.getItem(side);
  if (raw === null || !current()) return;
  const recovered = readBlob(raw, run.version, run.migrate, run.schema);
  if (!recovered) {
    storeLog.warn(`store.${run.logKey}.unreadable_kept`, { bytes: raw.length });
    return;
  }
  // Which copy this is, so a merge that was saved but whose copy could not be
  // removed is not laid in a second time: entries finished and dropped since
  // would come back.
  const copyId = bytesToHex(sha256(new TextEncoder().encode(raw)));
  const before = await run.storage.getItem(run.name);
  if (!current()) return;
  const onDisk = before === null ? null : readBlob(before, run.version, run.migrate, run.schema);
  if (onDisk && run.recovery.merged(onDisk, copyId)) {
    await run.storage.removeItem(side);
    storeLog.info(`store.${run.logKey}.unreadable_recovered`, { bytes: raw.length, repeat: true });
    return;
  }
  // Saved before the live store changes: a save that fails leaves the store
  // as it was, and the failure is this promise's, not an unawaited one.
  const value = {
    state: run.partialize(run.recovery.merge(recovered, copyId)),
    version: run.version,
  };
  await run.save(value);
  if (!current()) return;
  run.recovery.apply(recovered, copyId);
  const savedRaw = await run.storage.getItem(run.name);
  if (!current()) return;
  const saved = savedRaw === null ? null : readBlob(savedRaw, run.version, run.migrate, run.schema);
  if (!saved || !run.recovery.holds(saved, recovered, copyId)) {
    storeLog.warn(`store.${run.logKey}.unreadable_recovery_not_saved`);
    return;
  }
  await run.storage.removeItem(side);
  storeLog.info(`store.${run.logKey}.unreadable_recovered`, { bytes: raw.length });
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
  /** Counts loads, so recovery can tell the store has reloaded under it. */
  let loads = 0;
  let loadTurnedDown = false;
  const turnDown = () => {
    loadTurnedDown = true;
    guard?.reject();
  };
  // A turned-down blob is copied aside before the next save, whether or not
  // some of its fields were kept.
  const mergeWithSchema = createMergeWithSchema(logKey, opts.schema, {
    independentFields: opts.independentFields,
    onRejected: turnDown,
  });
  const jsonStorage = createJSONStorage<TPartial>(() => guard?.storage ?? reported);
  return {
    name: opts.name,
    storage: jsonStorage,
    version,
    partialize: opts.partialize,
    migrate,
    merge: mergeWithSchema,
    onRehydrateStorage: () => {
      loads += 1;
      loadTurnedDown = false;
      markHydrationStarted(opts.name);
      return (state, error) => {
        if (error) {
          // An unparseable blob or a throwing `migrate` ends up here, not in `merge`.
          turnDown();
          storeLog.warn(`store.${logKey}.rehydrate_failed`, { error: redactError(error) });
          markHydrationFailed(opts.name);
        } else markHydrationLoaded(opts.name);
        opts.afterHydrate?.(state, error);
        const recovery = opts.recoverUnreadable;
        // Not after a load that was itself turned down: its own blob is the
        // one waiting to be copied aside, and the copy already there is kept.
        if (!recovery || !guard || !jsonStorage || loadTurnedDown) return;
        const load = loads;
        recoverUnreadable({
          name: opts.name,
          logKey,
          version,
          migrate,
          schema: opts.schema,
          partialize: opts.partialize,
          recovery,
          storage: reported,
          save: (value) => jsonStorage.setItem(opts.name, value),
          stillLoaded: () => load === loads,
        }).catch((recoveryError: unknown) => {
          storeLog.warn(`store.${logKey}.unreadable_recovery_failed`, {
            error: redactError(recoveryError),
          });
        });
      };
    },
  };
}
