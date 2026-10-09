import AsyncStorage from '@react-native-async-storage/async-storage';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import {
  blockProfilePersistWrites,
  unblockProfilePersistWrites,
  hasCapturedProfileStorage,
} from '@/shared/lib/cashu/profileScopedStorage';
import { log } from '@/shared/lib/logger';
import { profileSwitchBoundary, profileSwitchServices } from './profileSwitchSession';

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
  await switchStep(blockProfilePersistWrites);
  const boundary = profileSwitchBoundary();
  const services = profileSwitchServices();
  if (!boundary || hasCapturedProfileStorage()) throw new Error('Unsafe account boundary');
  // NIP-46 must relinquish signing authority before the shared NDK pool closes.
  const signer = services.get('nostr.nip46');
  if (signer) await switchStep(signer);
  for (const [name, stop] of services) {
    if (name !== 'nostr.nip46') await switchStep(stop);
  }
  await switchStep(boundary.suspend);
  await switchStep(options.cleanupCoco);
  for (const holder of [...persistRegistry.accountScoped]) await switchStep(holder.dispose);
  const stores = persistRegistry.stores.filter((entry) => entry.scope !== 'global');
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
  for (const entry of persistRegistry.stores) {
    if (entry.name !== 'profile-store' && containsPubkey(entry.store.getState(), previousPubkey)) {
      log.warn('profile.switch.leak', { store: entry.name });
    }
  }
  for (const key of await AsyncStorage.getAllKeys()) {
    if (key.endsWith(`:profile:${previousPubkey}`)) continue;
    const value = await AsyncStorage.getItem(key);
    if (key.includes(previousPubkey) || value?.includes(previousPubkey)) {
      // Global profile inventory intentionally retains all account identities.
      if (key === 'profile-store') continue;
      const name = key.replace(previousPubkey, '[previous-account]');
      log.warn('profile.switch.leak', { key: name });
    }
  }
}
