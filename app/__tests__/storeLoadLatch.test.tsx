/**
 * The gates on a store having loaded (the wallet lifecycle, the signer
 * connections, the settings, the prompts) stay loaded for as long as the
 * component is mounted: a later read of the same store (a retry, a migration
 * writing the row again) does not send the gate back to waiting. The plain
 * load hook follows every read.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import {
  markHydrationFailed,
  markHydrationStarted,
  useStoreLoad,
  useStoreLoadLatched,
} from '@/shared/lib/persist/hydrationOutcome';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

type Persist = typeof useWalletLifecycleStore.persist;

/** Lets the test decide when the store's load starts and finishes. */
function controlLoad(persist: Persist) {
  let loaded = false;
  const finished = new Set<() => void>();
  jest.spyOn(persist, 'hasHydrated').mockImplementation(() => loaded);
  jest.spyOn(persist, 'onFinishHydration').mockImplementation((listener) => {
    finished.add(listener as () => void);
    return () => finished.delete(listener as () => void);
  });
  return {
    finish: () => {
      loaded = true;
      for (const listener of [...finished]) listener();
    },
    startAgain: () => {
      loaded = false;
    },
  };
}

afterEach(() => jest.restoreAllMocks());

describe.each([
  ['wallet lifecycle', useWalletLifecycleStore],
  ['signer connections', useNip46ConnectionsStore as unknown as typeof useWalletLifecycleStore],
  ['settings', useSettingsStore as unknown as typeof useWalletLifecycleStore],
  ['prompts', useCtaStore as unknown as typeof useWalletLifecycleStore],
])('the %s load gate', (_name, store) => {
  const { persist } = store;
  const useLoaded = () => useStoreLoadLatched(store.persist);

  it('waits while the store is unread and opens when it loads', () => {
    const load = controlLoad(persist);
    const { result } = renderHook(() => useLoaded());
    expect(result.current).toBe(false);

    act(() => load.finish());

    expect(result.current).toBe(true);
  });

  it('opens at once for a store that has already loaded', () => {
    const load = controlLoad(persist);
    load.finish();
    const { result } = renderHook(() => useLoaded());
    expect(result.current).toBe(true);
  });

  it('stays open while a later read of the store is in progress', () => {
    const load = controlLoad(persist);
    load.finish();
    const { result, rerender } = renderHook(() => useLoaded());

    load.startAgain();
    rerender({});

    expect(result.current).toBe(true);
  });
});

describe('the store load', () => {
  const store = useWalletLifecycleStore;

  it('follows a later read back to loading, and says when a read fails', () => {
    const load = controlLoad(store.persist);
    load.finish();
    const { result } = renderHook(() => useStoreLoad(store.persist));
    expect(result.current).toBe('loaded');

    load.startAgain();
    act(() => markHydrationStarted('wallet-lifecycle'));
    expect(result.current).toBe('loading');

    act(() => markHydrationFailed('wallet-lifecycle'));
    expect(result.current).toBe('failed');

    act(() => markHydrationStarted('wallet-lifecycle'));
    act(() => load.finish());
    expect(result.current).toBe('loaded');
  });
});
