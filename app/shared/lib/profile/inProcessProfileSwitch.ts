import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  blockProfilePersistWrites,
  unblockProfilePersistWrites,
  hasCapturedProfileStorage,
} from '@/shared/lib/cashu/profileScopedStorage';
import { log } from '@/shared/lib/logger';
import {
  profileSwitchBoundary,
  profileSwitchServices,
  setProfileSwitchQuiescing,
  liveStores,
  accountHolders,
} from '@/shared/lib/account/accountRegistry';

const STEP_TIMEOUT_MS = 5_000;

export async function switchStep<T>(operation: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Profile switch step timed out')),
          STEP_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function holdProfileSwitchForRestart(): Promise<void> {
  setProfileSwitchQuiescing(true);
  const boundary = profileSwitchBoundary();
  // Suspend even if an admitted write never drains. Neither failure permits a remount.
  await Promise.all([
    switchStep(blockProfilePersistWrites),
    boundary ? switchStep(boundary.suspend) : Promise.resolve(),
  ]);
}

/** Failure deliberately leaves providers suspended and writes blocked for restart. */
export async function runInProcessProfileSwitch(options: {
  cleanupCoco: () => Promise<void>;
  flipAccount: () => void | Promise<void>;
}): Promise<void> {
  setProfileSwitchQuiescing(true);
  const boundary = profileSwitchBoundary();
  const services = new Map(profileSwitchServices());
  if (!boundary) throw new Error('Unsafe account boundary');
  // NIP-46 must relinquish signing authority before the shared NDK pool closes.
  const signer = services.get('nostr.nip46');
  if (signer) await switchStep(signer);
  for (const [name, stop] of services) {
    if (name !== 'nostr.nip46') await switchStep(stop);
  }
  await switchStep(boundary.suspend);
  await switchStep(options.cleanupCoco);
  // Owner-bound holders flush and detach while the old identity still owns writes.
  for (const holder of [...accountHolders]) await switchStep(holder.dispose);
  if (hasCapturedProfileStorage()) throw new Error('Undisposed captured profile storage');
  await switchStep(blockProfilePersistWrites);
  const stores = liveStores.filter((entry) => entry.scope !== 'global');
  for (const entry of stores) {
    // State types are erased in the registry. Only this handle's recorded initial state is valid.
    entry.store.setState(entry.initialState as never, true);
  }
  await switchStep(options.flipAccount);
  for (const entry of stores) {
    if (entry.scope !== 'profile' || !entry.persisted) continue;
    const persist = entry.store.persist;
    if (!persist) throw new Error('Missing profile hydration API');
    await switchStep(() => {
      // An older hydration can finish while another store is awaited. Reset again
      // immediately before incrementing Zustand's hydration generation.
      entry.store.setState(entry.initialState as never, true);
      return persist.rehydrate();
    });
    // Zustand swallows storage rejection: resolution alone does not prove successful hydration.
    if (!persist.hasHydrated()) throw new Error('Profile hydration failed');
  }
  unblockProfilePersistWrites();
  await switchStep(boundary.resume);
  setProfileSwitchQuiescing(false);
}

function containsPubkey(value: unknown, pubkey: string, seen = new Set<unknown>()): boolean {
  if (typeof value === 'string') return value.includes(pubkey);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (value instanceof Map) return [...value].some((item) => containsPubkey(item, pubkey, seen));
  if (value instanceof Set) return [...value].some((item) => containsPubkey(item, pubkey, seen));
  return Object.entries(value).some(
    ([key, item]) => key.includes(pubkey) || containsPubkey(item, pubkey, seen)
  );
}

/** Inspect locally; report identifiers only. A's retained durable blobs are expected. */
export async function checkProfileSwitchLeaks(previousPubkey: string): Promise<void> {
  if (!__DEV__) return;
  for (const entry of liveStores) {
    if (entry.name !== 'profile-store' && containsPubkey(entry.store.getState(), previousPubkey)) {
      log.warn('profile.switch.leak', { store: entry.name });
    }
  }
  let unreadable = 0;
  for (const key of await AsyncStorage.getAllKeys()) {
    if (key.endsWith(`:profile:${previousPubkey}`)) continue;
    let value: string | null;
    try {
      value = await AsyncStorage.getItem(key);
    } catch {
      // Android cannot read a row larger than its cursor window (about 2 MB).
      // One such row must not end the scan of every other key.
      unreadable += 1;
      continue;
    }
    if (key.includes(previousPubkey) || value?.includes(previousPubkey)) {
      // Global profile inventory intentionally retains all account identities.
      if (key === 'profile-store') continue;
      // Name the store, not the accounts: the suffix would be another account's pubkey.
      const name = key
        .replace(previousPubkey, '[previous-account]')
        .replace(/:profile:[0-9a-f]{64}$/, ':profile:[account]');
      log.warn('profile.switch.leak', { key: name });
    }
  }
  if (unreadable > 0) log.warn('profile.switch.leak_scan_incomplete', { unreadable });
}
