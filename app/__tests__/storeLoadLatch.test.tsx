/**
 * The hooks that gate on a store having loaded stay loaded for as long as the
 * component is mounted: a later read of the same store (a retry, a migration
 * writing the row again) does not send the gate back to waiting.
 */

/* eslint-disable import/first */

jest.mock('@/features/nostrSigner/lib/nip46Engine', () => ({ nip46Engine: {} }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({ useNostrKeysContext: () => ({}) }));
jest.mock('@/shared/providers/NostrNDKProvider', () => ({ useNostrNDKContext: () => ({}) }));

import { act, renderHook } from '@testing-library/react-native';

import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46ConnectionsHydrated } from '@/features/nostrSigner/hooks/useNostrSignerService';
import {
  useWalletLifecycleHydrated,
  useWalletLifecycleStore,
} from '@/shared/stores/global/walletLifecycleStore';

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
  ['wallet lifecycle', useWalletLifecycleStore.persist, useWalletLifecycleHydrated],
  ['signer connections', useNip46ConnectionsStore.persist as Persist, useNip46ConnectionsHydrated],
])('the %s load gate', (_name, persist, useLoaded) => {
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
