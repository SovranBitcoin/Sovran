/**
 * NostrSignerProvider service glue over a MOCKED engine and the real
 * runtime/persisted stores. Load-bearing cases: cold-start gating (no
 * connections, no pairing, no hot flag → engine.start never called, even with
 * NDK+keys ready), each missing gate keeping the engine cold, exactly one
 * start when every condition is met, hot-flag and resumed-pairing paths,
 * stop on the last hot condition lapsing and on unmount, AppState
 * foreground → reconnect (started engines only), and the boot pairing-intent
 * resume (taken → register + handoff; expired → toast notice).
 */

/* eslint-disable import/first */

jest.mock('@/features/nostrSigner/lib/nip46Engine', () => {
  const { ok } = jest.requireActual<typeof import('neverthrow')>('neverthrow');
  const state = { started: false };
  return {
    nip46Engine: {
      get isStarted() {
        return state.started;
      },
      start: jest.fn(() => {
        state.started = true;
        return ok(undefined);
      }),
      stop: jest.fn(() => {
        state.started = false;
        return ok(undefined);
      }),
      rebuildRelays: jest.fn(() => ok(undefined)),
      reconnect: jest.fn(() => ok(undefined)),
      startNostrconnectPairing: jest.fn(() => ok(undefined)),
      completeNostrconnectPairing: jest.fn(),
      cancelNostrconnectPairing: jest.fn(() => ok(undefined)),
      resolveRequest: jest.fn(),
      onUserVerdictNeeded: jest.fn(() => () => undefined),
      __state: state,
    },
  };
});

jest.mock('@/features/nostrSigner/lib/pairingIntentStorage', () => ({
  takePairingIntent: jest.fn(),
}));

jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => mockKeysContext,
}));

jest.mock('@/shared/providers/NostrNDKProvider', () => ({
  useNostrNDKContext: () => mockNdkContext,
}));

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  initLog: jest.fn(),
  useInitMount: jest.fn(),
  redactError: (error: unknown) => ({
    name: 'Error',
    message: error instanceof Error ? error.message : String(error),
  }),
}));

// NostrSignerProvider also mounts the approval controller (Layer 3), whose
// popup surface reaches heroui-native at import time — mock it like
// sendMemoSheet.test.ts does. The controller's behavior has its own suite.
jest.mock('@/shared/lib/popup', () => ({
  popup: jest.fn(),
  showActionSheet: jest.fn(),
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => {
  const map = new Map<string, string>();
  return {
    createProfileScopedStorage: () => ({
      getItem: (key: string) => Promise.resolve(map.get(key) ?? null),
      setItem: (key: string, value: string) => {
        map.set(key, value);
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        map.delete(key);
        return Promise.resolve();
      },
    }),
  };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { okAsync } from 'neverthrow';

import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { nip46Engine } from '@/features/nostrSigner/lib/nip46Engine';
import { takePairingIntent } from '@/features/nostrSigner/lib/pairingIntentStorage';
import { popup, showActionSheet } from '@/shared/lib/popup';
import { NostrSignerProvider } from '@/shared/providers/NostrSignerProvider';

// React processes renders/unmounts via deferred microtasks unless the act
// environment is declared — without this, a renderer from one test flushes
// its effects inside the NEXT test and pollutes the engine mock's counts.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER = 'f'.repeat(64);
const APP = 'a'.repeat(64);
const CLIENT = 'd'.repeat(64);
const ACCOUNT_INDEX = 7;
const RELAY = 'wss://relay.example.com';

// Mutable contexts consumed lazily by the provider mocks above.
const mockKeysContext: { keys: { pubkey: string; privateKey: Uint8Array } | null } = {
  keys: null,
};
const mockNdkContext = { isInitialized: true };

const engine = nip46Engine as typeof nip46Engine & {
  __state: { started: boolean };
  start: jest.Mock;
  stop: jest.Mock;
  reconnect: jest.Mock;
  rebuildRelays: jest.Mock;
  startNostrconnectPairing: jest.Mock;
};
const takeIntent = takePairingIntent as jest.Mock;
const popupMock = popup as jest.Mock;
const showActionSheetMock = showActionSheet as jest.Mock;

let appStateHandler: ((next: AppStateStatus) => void) | null = null;

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function renderProvider(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    const providerProps: React.ComponentProps<typeof NostrSignerProvider> = {
      children: null,
    };
    renderer = TestRenderer.create(React.createElement(NostrSignerProvider, providerProps));
    await flush();
  });
  return renderer;
}

async function unmountInAct(renderer: TestRenderer.ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.unmount();
  });
}

function seedConnection(): void {
  const upserted = useNip46ConnectionsStore
    .getState()
    .upsertApp({ clientPubkey: APP, relays: [RELAY], origin: 'bunker' });
  expect(upserted.isOk()).toBe(true);
}

beforeEach(async () => {
  jest.clearAllMocks();
  engine.__state.started = false;
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    type: string,
    handler: (next: AppStateStatus) => void
  ) => {
    if (type === 'change') appStateHandler = handler;
    return { remove: jest.fn() };
  }) as never);
  takeIntent.mockReturnValue(okAsync({ status: 'none' }));
  mockKeysContext.keys = { pubkey: USER, privateKey: new Uint8Array(32).fill(7) };
  mockNdkContext.isInitialized = true;
  await useNip46ConnectionsStore.persist.rehydrate();
  useNip46ConnectionsStore.setState({ apps: {} });
  useNip46RequestsStore.setState({
    pending: [],
    sessionGrants: [],
    throttledApps: {},
    serviceHotRequested: false,
    resumedPairing: null,
    pairingNotice: null,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useNostrSignerService cold-start gating', () => {
  it('never starts the engine with zero connections and no pairing', async () => {
    const renderer = await renderProvider();
    expect(engine.start).not.toHaveBeenCalled();
    await unmountInAct(renderer);
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it('stays cold with a connection but NDK not yet initialized', async () => {
    mockNdkContext.isInitialized = false;
    seedConnection();
    const renderer = await renderProvider();
    expect(engine.start).not.toHaveBeenCalled();
    await unmountInAct(renderer);
  });

  it('stays cold with a connection but no keys', async () => {
    mockKeysContext.keys = null;
    seedConnection();
    const renderer = await renderProvider();
    expect(engine.start).not.toHaveBeenCalled();
    await unmountInAct(renderer);
  });
});

describe('useNostrSignerService start/stop', () => {
  it('starts exactly once when all conditions are met', async () => {
    seedConnection();
    const renderer = await renderProvider();
    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(engine.start).toHaveBeenCalledWith({
      signer: mockKeysContext.keys?.privateKey,
      userPubkey: USER,
    });

    // Unrelated store churn must not re-start.
    await act(async () => {
      useNip46RequestsStore.getState().setAppThrottled(APP, Date.now() + 60_000);
      await flush();
    });
    expect(engine.start).toHaveBeenCalledTimes(1);
    await unmountInAct(renderer);
  });

  it('starts on the UI-requested hot flag despite zero connections', async () => {
    useNip46RequestsStore.getState().setServiceHotRequested(true);
    const renderer = await renderProvider();
    expect(engine.start).toHaveBeenCalledTimes(1);
    await unmountInAct(renderer);
  });

  it('stops when the last hot condition lapses', async () => {
    seedConnection();
    const renderer = await renderProvider();
    expect(engine.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      useNip46ConnectionsStore.getState().disconnectApp(APP);
      await flush();
    });
    expect(engine.stop).toHaveBeenCalledTimes(1);
    await unmountInAct(renderer);
  });

  it('stops on unmount', async () => {
    seedConnection();
    const renderer = await renderProvider();
    expect(engine.start).toHaveBeenCalledTimes(1);
    await unmountInAct(renderer);
    expect(engine.stop).toHaveBeenCalledTimes(1);
  });
});

describe('useNostrSignerService AppState', () => {
  it('reconnects on foreground while started', async () => {
    seedConnection();
    const renderer = await renderProvider();
    expect(appStateHandler).not.toBeNull();

    act(() => {
      appStateHandler?.('background');
    });
    expect(engine.reconnect).not.toHaveBeenCalled();

    act(() => {
      appStateHandler?.('active');
    });
    expect(engine.reconnect).toHaveBeenCalledTimes(1);
    await unmountInAct(renderer);
  });

  it('does not reconnect a cold engine on foreground', async () => {
    const renderer = await renderProvider();
    act(() => {
      appStateHandler?.('active');
    });
    expect(engine.reconnect).not.toHaveBeenCalled();
    await unmountInAct(renderer);
  });
});

describe('useResumePendingPairing', () => {
  it('registers a taken intent and publishes the connect-sheet handoff', async () => {
    const uri = `nostrconnect://${CLIENT}?relay=${encodeURIComponent(RELAY)}&secret=s3cret&name=Primal`;
    takeIntent.mockReturnValue(
      okAsync({
        status: 'taken',
        intent: {
          uri,
          targetPubkey: USER,
          targetAccountIndex: ACCOUNT_INDEX,
          createdAt: 1,
          expiresAt: 2,
        },
      })
    );

    const renderer = await renderProvider();
    expect(takeIntent).toHaveBeenCalledWith(USER);
    expect(engine.startNostrconnectPairing).toHaveBeenCalledTimes(1);
    expect(engine.startNostrconnectPairing).toHaveBeenCalledWith(
      expect.objectContaining({ clientPubkey: CLIENT, secret: 's3cret', relays: [RELAY] })
    );
    // Layer 3's connect-sheet opener consumes the handoff in the same mount:
    // hot flag raised, field cleared, sheet opened with the re-encoded URI.
    expect(useNip46RequestsStore.getState().resumedPairing).toBeNull();
    expect(useNip46RequestsStore.getState().serviceHotRequested).toBe(true);
    expect(showActionSheetMock).toHaveBeenCalledWith('signer-connect', { uri });
    // The handoff flipped the service hot — the engine must have warmed.
    expect(engine.start).toHaveBeenCalledTimes(1);
    await unmountInAct(renderer);
  });

  it('surfaces an expired intent as a toast notice and stays cold', async () => {
    takeIntent.mockReturnValue(okAsync({ status: 'expired' }));
    const renderer = await renderProvider();
    // Layer 3's opener consumes the notice: toast shown, field cleared.
    expect(useNip46RequestsStore.getState().pairingNotice).toBeNull();
    expect(popupMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Connection expired' })
    );
    expect(engine.startNostrconnectPairing).not.toHaveBeenCalled();
    expect(engine.start).not.toHaveBeenCalled();
    await unmountInAct(renderer);
  });

  it('takes the intent at most once per mount', async () => {
    const renderer = await renderProvider();
    await act(async () => {
      // Any re-render (store churn) must not re-take.
      useNip46RequestsStore.getState().setServiceHotRequested(true);
      await flush();
    });
    expect(takeIntent).toHaveBeenCalledTimes(1);
    await unmountInAct(renderer);
  });
});
