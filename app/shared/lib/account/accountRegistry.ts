/**
 * Everything an account owns outside React, in one place.
 *
 * The account providers remount when the active account changes, which
 * replaces whatever lives in React. Four kinds of state live outside React and
 * are not reached by that remount. Each is registered here, by its owner, so
 * that a profile switch, a profile removal and the tests can enumerate them
 * without knowing who they are:
 *
 * | Kind | Registered by | Registered with | On a switch |
 * | --- | --- | --- | --- |
 * | Store | every zustand store | `defineStore` (records into `liveStores`) | profile and session stores are reset; profile stores rehydrate under the new key |
 * | Holder | a module-level cache, Map or singleton | `registerAccountScoped` | disposed |
 * | Service | something running for the account: signer, relay pool, clients | `registerProfileSwitchService` | stopped, before anything is reset |
 * | Boundary | the layout component that mounts the account providers | `registerProfileSwitchBoundary` | suspended, then resumed |
 *
 * `declaredStores` is the same list of stores known statically, generated from
 * source, so code that runs before a store module has loaded (the storage
 * migrations) can still name every store.
 *
 * Registering never stops, disposes or resets anything. Only
 * `profile/inProcessProfileSwitch.ts` and `profile/profileRemovalStorage.ts`
 * act on what is registered. See ADR 0029.
 *
 * This module imports nothing but the generated manifest, so a provider can
 * register here without pulling the stores or the switch into its module graph.
 */
import { storeRegistryManifest } from '@/shared/lib/persist/storeRegistryManifest';

// ── Stores ───────────────────────────────────────────────────────────────────

/** Who a store's state belongs to: the installation, one account, or the active account's session. */
export type StoreScope = 'global' | 'profile' | 'session';

export interface LiveStore {
  name: string;
  scope: StoreScope;
  persisted: boolean;
  store: {
    getState: () => unknown;
    getInitialState: () => unknown;
    // State types are erased here; only a store's own recorded state is ever restored into it.
    setState: (state: never, replace: true) => void;
    persist?: { rehydrate: () => Promise<void> | void; hasHydrated: () => boolean };
  };
  initialState: unknown;
  queryCache?: { clear: () => void; removeViewer: (pubkey: string) => void };
}

/** Every store that has been created in this runtime. Filled by `defineStore`. */
export const liveStores: LiveStore[] = [];

/** Every store declared in source, whether or not its module has loaded. */
export const declaredStores = storeRegistryManifest;

/** The storage names of the persisted stores of one scope, from the declarations. */
export function persistedStoreKeys(scope: StoreScope): string[] {
  return [
    ...new Set(
      declaredStores
        .filter((entry) => entry.persisted && entry.scope === scope)
        .map((entry) => entry.name)
    ),
  ];
}

// ── Holders ──────────────────────────────────────────────────────────────────

interface AccountHolder {
  name: string;
  dispose: () => void | Promise<void>;
  /** True when the holder holds nothing. Lets a test prove a dispose worked. */
  inspect?: () => boolean;
}

export const accountHolders: AccountHolder[] = [];

/**
 * Register how a module-level cache, Map or singleton drops what it holds.
 * Holders that share a name are all kept (one per instance), so a holder that
 * is rebuilt per session registers once, at module level, not each time it is
 * rebuilt. A provider-owned instance calls the returned function after its own
 * teardown, so dead closures do not accumulate.
 */
export function registerAccountScoped(
  name: string,
  dispose: () => void | Promise<void>,
  inspect?: () => boolean
): () => void {
  const holder = { name, dispose, inspect };
  accountHolders.push(holder);
  return () => {
    const index = accountHolders.indexOf(holder);
    if (index !== -1) accountHolders.splice(index, 1);
  };
}

// ── Services ─────────────────────────────────────────────────────────────────

const services = new Map<string, () => void | Promise<void>>();

/** Register how to stop something running for the account. Returns its unregister. */
export function registerProfileSwitchService(name: string, stop: () => void | Promise<void>) {
  services.set(name, stop);
  return () => {
    if (services.get(name) === stop) services.delete(name);
  };
}

/** The registered services, in registration order. */
export function profileSwitchServices(): ReadonlyMap<string, () => void | Promise<void>> {
  return services;
}

// One lifecycle signal also covers providers initialized after the service snapshot.
let quiescing = false;
export function setProfileSwitchQuiescing(value: boolean): void {
  quiescing = value;
}
export function profileSwitchQuiescing(): boolean {
  return quiescing;
}

// ── Boundary ─────────────────────────────────────────────────────────────────

interface ProviderBoundary {
  suspend: () => Promise<void>;
  resume: () => Promise<void>;
}
let boundary: ProviderBoundary | undefined;

/** Register the component that mounts the account providers. */
export function registerProfileSwitchBoundary(value: ProviderBoundary): () => void {
  boundary = value;
  return () => {
    if (boundary === value) boundary = undefined;
  };
}

export function profileSwitchBoundary(): ProviderBoundary | undefined {
  return boundary;
}
