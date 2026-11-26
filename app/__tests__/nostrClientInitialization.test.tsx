/** @jest-environment node */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { NostrClient } from 'nostr/client';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { useNostrClient, useNostrClientLifecycle } from '@/runtime/nostrClient';

/** The account scope's Nostr client owner, around the children that read it. */
function NostrClientProvider({
  accountIndex,
  children,
}: {
  accountIndex: number;
  children: React.ReactNode;
}) {
  useNostrClientLifecycle(accountIndex);
  return <>{children}</>;
}
import { useOwnRelayListSync } from '@/shared/lib/nostr/outbox/useOwnRelayListSync';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mockCanStart = false;
let mockKeys: { privateKey: Uint8Array; pubkey: string } | null = null;
const mockComplete = jest.fn();
// No relay sockets: the client under test opens none.
jest.mock('@/shared/ndk', () => ({ relays: [] }));
jest.mock('@/shared/lib/nostr/giftWrapCache', () => ({
  giftWrapCache: { cache: { hydrate: jest.fn() } },
}));
jest.mock('@/shared/lib/nostr/outbox/useOwnRelayListSync', () => ({
  useOwnRelayListSync: jest.fn(),
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockKeys }),
}));
jest.mock('@/runtime/initializationStages', () => ({
  useInitializationStage: () => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.useMemo(
      () => ({ canStart: mockCanStart, log: jest.fn(), complete: mockComplete, error: jest.fn() }),
      [mockCanStart]
    );
  },
}));
jest.mock('@/shared/lib/logger', () => ({
  useInitMount: jest.fn(),
  nostrLog: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

/** Every client the provider exposed, in order. */
const exposed: (NostrClient | undefined)[] = [];
function Probe() {
  const { client, isInitialized } = useNostrClient();
  if (exposed.at(-1) !== client) exposed.push(client);
  expect(isInitialized).toBe(client !== undefined);
  return null;
}
let renderer: TestRenderer.ReactTestRenderer;
function tree(accountIndex = 0) {
  return (
    <React.StrictMode>
      <NostrClientProvider key={accountIndex} accountIndex={accountIndex}>
        <Probe />
      </NostrClientProvider>
    </React.StrictMode>
  );
}
const current = () => exposed.at(-1);
const keysFor = () => {
  const privateKey = generateSecretKey();
  return { privateKey, pubkey: getPublicKey(privateKey) };
};
beforeEach(() => {
  mockCanStart = false;
  mockKeys = null;
  exposed.length = 0;
  jest.clearAllMocks();
});
afterEach(() => {
  act(() => renderer.unmount());
});

it('starts no client while stage dependencies or keys are missing', () => {
  act(() => {
    renderer = TestRenderer.create(tree());
  });
  expect(current()).toBeUndefined();
  mockCanStart = true;
  act(() => renderer.update(tree()));
  expect(current()).toBeUndefined();
  expect(mockComplete).not.toHaveBeenCalled();
});

it('exposes one live client signing for the account, with no warm-up delay', () => {
  mockCanStart = true;
  mockKeys = keysFor();
  act(() => {
    renderer = TestRenderer.create(tree());
  });
  const client = current()!;
  expect(client.disposed).toBe(false);
  expect(client.signer?.pubkey).toBe(mockKeys.pubkey);
  // A client made and dropped by the strict-mode replay is closed.
  expect(exposed.filter((c) => c && !c.disposed)).toEqual([client]);
  expect(mockComplete).toHaveBeenCalled();
  expect(giftWrapCache.cache.hydrate).toHaveBeenCalledWith(mockKeys.pubkey);
  expect(jest.mocked(useOwnRelayListSync)).toHaveBeenLastCalledWith(client, mockKeys.pubkey);
});

it('closes the outgoing account client and zeroes its signer on a switch', () => {
  mockCanStart = true;
  mockKeys = keysFor();
  act(() => {
    renderer = TestRenderer.create(tree());
  });
  const first = current()!;
  mockKeys = keysFor();
  act(() => renderer.update(tree(2)));
  const second = current()!;
  expect(second).not.toBe(first);
  expect(first.disposed).toBe(true);
  expect(first.signer).toBeUndefined();
  expect(second.signer?.pubkey).toBe(mockKeys.pubkey);
});

it('closes the client when the keys become unavailable', () => {
  mockCanStart = true;
  mockKeys = keysFor();
  act(() => {
    renderer = TestRenderer.create(tree());
  });
  const client = current()!;
  mockKeys = null;
  act(() => renderer.update(tree()));
  expect(client.disposed).toBe(true);
  expect(current()).toBeUndefined();
});
