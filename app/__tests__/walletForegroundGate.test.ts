/** @jest-environment node */
import type { AppStateStatus } from 'react-native';
import type { WebSocketLike } from '@cashu/coco-core';
import { NPCPlugin } from 'coco-cashu-plugin-npc';
import {
  createForegroundGate,
  createWalletForegroundGate,
  trackSocketCloses,
} from '@/shared/lib/cashu/manager';
import { NPC_SYNC_INTERVAL_MS, pauseNpcSync, resumeNpcSync } from '@/shared/lib/cashu/npc';

const mockGetQuotesSince = jest.fn(async (_since: number) => []);
const mockSubscribe = jest.fn((_onUpdate: () => void, _onError: (error: unknown) => void) =>
  jest.fn()
);
jest.mock('npubcash-sdk', () => ({
  JWTAuthProvider: class JWTAuthProvider {},
  NPCClient: class NPCClient {
    getQuotesSince = (since: number) => mockGetQuotesSince(since);
    subscribe = (onUpdate: () => void, onError: (error: unknown) => void) =>
      mockSubscribe(onUpdate, onError);
  },
}));

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///docs/' }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('@sovranbitcoin/coco-cashu-plugin-p2pk-import', () => ({
  createP2PKImportPlugin: jest.fn(() => ({})),
}));
jest.mock('wallet', () => ({ createCashuSeedGetter: jest.fn(), withTimeout: jest.fn() }));
jest.mock('@/shared/lib/nostr/secureStorage', () => ({}));
jest.mock('@/shared/lib/nostr/keyDerivation', () => ({}));
jest.mock('@/shared/lib/cashu/cocoRepositories', () => ({}));
jest.mock('@/shared/lib/cashu/managerInternals', () => ({}));
jest.mock('@/shared/lib/cashu/paymentRequestNostrTransport', () => ({}));

function createAppState(initial: AppStateStatus = 'active') {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const appState = {
    currentState: initial,
    addEventListener: (_type: 'change', listener: (state: AppStateStatus) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  return {
    appState,
    listenerCount: () => listeners.size,
    set(state: AppStateStatus) {
      appState.currentState = state;
      for (const listener of [...listeners]) listener(state);
    },
  };
}

async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

async function advance(ms: number) {
  jest.advanceTimersByTime(ms);
  await settle();
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockGetQuotesSince.mockClear();
  mockSubscribe.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createForegroundGate', () => {
  function setup(initial: AppStateStatus = 'active') {
    const app = createAppState(initial);
    const calls: string[] = [];
    const pause = jest.fn(async () => {
      calls.push('pause');
    });
    const resume = jest.fn(async () => {
      calls.push('resume');
    });
    const gate = createForegroundGate({ appState: app.appState, pause, resume });
    return { app, calls, pause, resume, gate };
  }

  it('does nothing in the foreground', async () => {
    const t = setup();
    await advance(60_000);
    expect(t.calls).toEqual([]);
  });

  it('pauses on background and resumes on active, once each', async () => {
    const t = setup();
    t.app.set('background');
    t.app.set('background');
    await settle();
    expect(t.calls).toEqual(['pause']);

    t.app.set('active');
    t.app.set('active');
    await settle();
    expect(t.calls).toEqual(['pause', 'resume']);
  });

  it('ignores inactive in both directions', async () => {
    const t = setup();
    t.app.set('inactive');
    await settle();
    expect(t.calls).toEqual([]);

    t.app.set('background');
    await settle();
    t.app.set('inactive');
    await settle();
    expect(t.calls).toEqual(['pause']);
  });

  it('pauses at once when created in the background', async () => {
    const t = setup('background');
    await settle();
    expect(t.calls).toEqual(['pause']);
  });

  it('never overlaps a pause with a resume', async () => {
    const app = createAppState();
    const pausing = deferred();
    const calls: string[] = [];
    createForegroundGate({
      appState: app.appState,
      pause: async () => {
        calls.push('pause:start');
        await pausing.promise;
        calls.push('pause:end');
      },
      resume: async () => {
        calls.push('resume');
      },
    });

    app.set('background');
    app.set('active');
    await settle();
    expect(calls).toEqual(['pause:start']);

    pausing.resolve();
    await settle();
    expect(calls).toEqual(['pause:start', 'pause:end', 'resume']);
  });

  it('skips a transition the app has already reversed', async () => {
    const app = createAppState();
    const pausing = deferred();
    const pause = jest.fn(() => pausing.promise);
    const resume = jest.fn(async () => undefined);
    createForegroundGate({ appState: app.appState, pause, resume });

    app.set('background');
    app.set('active');
    app.set('background');
    pausing.resolve();
    await settle();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
  });

  it('retries a failed resume', async () => {
    const app = createAppState();
    const resume = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValue(undefined);
    createForegroundGate({ appState: app.appState, pause: async () => undefined, resume });

    app.set('background');
    await settle();
    app.set('active');
    await settle();
    expect(resume).toHaveBeenCalledTimes(1);

    await advance(2_000);
    expect(resume).toHaveBeenCalledTimes(2);
    await advance(60_000);
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it('stops following the app and waits out a transition when disposed', async () => {
    const app = createAppState();
    const pausing = deferred();
    const resume = jest.fn(async () => undefined);
    const gate = createForegroundGate({
      appState: app.appState,
      pause: () => pausing.promise,
      resume,
    });

    app.set('background');
    let disposed = false;
    void gate.dispose().then(() => {
      disposed = true;
    });
    await settle();
    expect(disposed).toBe(false);
    expect(app.listenerCount()).toBe(0);

    pausing.resolve();
    await settle();
    expect(disposed).toBe(true);
    app.set('active');
    await settle();
    expect(resume).not.toHaveBeenCalled();
  });
});

describe('createForegroundGate with a grace period', () => {
  it('does not pause for a background shorter than the grace period', async () => {
    const { appState, set } = createAppState();
    const pause = jest.fn(async () => {});
    const resume = jest.fn(async () => {});
    const gate = createForegroundGate({ appState, pause, resume, pauseAfterMs: 10_000 });

    set('background');
    await advance(9_999);
    set('active');
    await advance(60_000);

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    await gate.dispose();
  });

  it('pauses once the app has stayed backgrounded, and resumes at once on return', async () => {
    const { appState, set } = createAppState();
    const pause = jest.fn(async () => {});
    const resume = jest.fn(async () => {});
    const gate = createForegroundGate({ appState, pause, resume, pauseAfterMs: 10_000 });

    set('background');
    set('background');
    await advance(10_000);
    expect(pause).toHaveBeenCalledTimes(1);

    set('active');
    await settle();
    expect(resume).toHaveBeenCalledTimes(1);
    await gate.dispose();
  });

  it('drops a pending pause when disposed', async () => {
    const { appState, set } = createAppState();
    const pause = jest.fn(async () => {});
    const gate = createForegroundGate({
      appState,
      pause,
      resume: async () => {},
      pauseAfterMs: 10_000,
    });

    set('background');
    await gate.dispose();
    await advance(60_000);

    expect(pause).not.toHaveBeenCalled();
  });
});

describe('trackSocketCloses', () => {
  function fakeSocket() {
    const listeners = new Set<() => void>();
    const socket: WebSocketLike = {
      send: () => undefined,
      close: () => undefined,
      addEventListener: (type, listener) => {
        if (type === 'close') listeners.add(listener as () => void);
      },
      removeEventListener: () => undefined,
    };
    return { socket, emitClose: () => listeners.forEach((listener) => listener()) };
  }

  it('resolves at once when every socket has already reported closed', async () => {
    const made = fakeSocket();
    const tracker = trackSocketCloses(() => made.socket);
    tracker.factory('wss://mint.example/v1/ws');
    const closing = tracker.open();
    expect(closing).toEqual([made.socket]);

    made.emitClose();
    expect(tracker.open()).toEqual([]);
    await expect(tracker.closed(closing, 2_000)).resolves.toBe(true);
  });

  it('holds until the last socket reports closed', async () => {
    const first = fakeSocket();
    const second = fakeSocket();
    const queue = [first.socket, second.socket];
    const tracker = trackSocketCloses(() => queue.shift() as WebSocketLike);
    tracker.factory('wss://a.example/v1/ws');
    tracker.factory('wss://b.example/v1/ws');

    let result: boolean | undefined;
    void tracker.closed(tracker.open(), 2_000).then((value) => {
      result = value;
    });
    first.emitClose();
    await advance(1);
    expect(result).toBeUndefined();

    second.emitClose();
    await advance(1);
    expect(result).toBe(true);
  });

  it('gives up after the timeout and does not wait for that socket again', async () => {
    const made = fakeSocket();
    const tracker = trackSocketCloses(() => made.socket);
    tracker.factory('wss://mint.example/v1/ws');
    const closing = tracker.open();

    let result: boolean | undefined;
    void tracker.closed(closing, 2_000).then((value) => {
      result = value;
    });
    await advance(2_000);
    await advance(1);
    expect(result).toBe(false);
    await expect(tracker.closed(closing, 2_000)).resolves.toBe(true);
  });

  it('does not wait for a socket opened after the snapshot', async () => {
    const first = fakeSocket();
    const second = fakeSocket();
    const queue = [first.socket, second.socket];
    const tracker = trackSocketCloses(() => queue.shift() as WebSocketLike);
    tracker.factory('wss://a.example/v1/ws');
    const closing = tracker.open();
    tracker.factory('wss://b.example/v1/ws');
    first.emitClose();
    await expect(tracker.closed(closing, 2_000)).resolves.toBe(true);
  });
});

describe('NPC sync behind the foreground gate', () => {
  async function setup() {
    const app = createAppState();
    const plugin = new NPCPlugin({
      defaultBaseUrl: 'https://npub.cash',
      syncIntervalMs: NPC_SYNC_INTERVAL_MS,
      useWebsocket: true,
    });
    const context = {
      services: {
        eventBus: { on: () => () => undefined },
        mintOperationService: {},
        mintService: {},
        quotes: {},
        paymentRequestService: {},
      },
      registerExtension: jest.fn(),
    };
    plugin.onInit(context as never);
    plugin.onReady();
    const account = await plugin.addAccount({
      id: 'a'.repeat(64),
      signer: (async () => ({})) as never,
      autoStart: true,
    });
    const gate = createForegroundGate({
      appState: app.appState,
      pause: () => pauseNpcSync(account),
      resume: () => resumeNpcSync(account),
    });
    return { app, account, gate, plugin };
  }

  it('syncs once per interval in the foreground', async () => {
    const t = await setup();
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(0);
    await advance(NPC_SYNC_INTERVAL_MS - 1);
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(0);
    await advance(1);
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(1);
    await advance(NPC_SYNC_INTERVAL_MS);
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(2);
    await t.plugin.shutdown();
  });

  it('does not sync while backgrounded, syncs at once on return, then keeps the cadence', async () => {
    const t = await setup();
    await advance(NPC_SYNC_INTERVAL_MS);
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(1);

    t.app.set('background');
    await advance(NPC_SYNC_INTERVAL_MS * 10);
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(1);
    expect(t.account.getStatus().isWebSocketConnected).toBe(false);

    t.app.set('active');
    await settle();
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(2);
    expect(t.account.getStatus().isWebSocketConnected).toBe(true);

    await advance(NPC_SYNC_INTERVAL_MS - 1);
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(3);
    await t.plugin.shutdown();
  });

  it('starts one websocket and one timer however often the app flips', async () => {
    const t = await setup();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    t.app.set('background');
    t.app.set('active');
    t.app.set('active');
    await settle();
    t.app.set('inactive');
    t.app.set('active');
    await settle();

    // One reconnect for the one real return, and the earlier socket was closed.
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(mockSubscribe.mock.results[0].value).toHaveBeenCalledTimes(1);
    expect(mockSubscribe.mock.results[1].value).not.toHaveBeenCalled();
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(1);

    // One timer, not two: one interval adds exactly one sync.
    await advance(NPC_SYNC_INTERVAL_MS);
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(2);
    await t.plugin.shutdown();
  });

  it('waits for a sync already running before it counts as paused', async () => {
    const t = await setup();
    const fetching = deferred();
    mockGetQuotesSince.mockImplementationOnce(async () => {
      await fetching.promise;
      return [];
    });
    await advance(NPC_SYNC_INTERVAL_MS);
    expect(t.account.getStatus().isSyncing).toBe(true);

    t.app.set('background');
    t.app.set('active');
    await settle();
    // Still pausing: the resume has not run, so no second fetch yet.
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(1);

    fetching.resolve();
    await settle();
    expect(mockGetQuotesSince).toHaveBeenCalledTimes(2);
    await t.plugin.shutdown();
  });
});

describe('createWalletForegroundGate', () => {
  it('stops NPC before coco and brings it back after coco', async () => {
    const app = createAppState();
    const calls: string[] = [];
    const record = (name: string) => async () => {
      calls.push(name);
    };
    const account = {
      stop: record('npc.stop'),
      start: () => void calls.push('npc.start'),
      sync: record('npc.sync'),
    };
    createWalletForegroundGate({
      appState: app.appState,
      manager: {
        pauseSubscriptions: record('coco.pause'),
        resumeSubscriptions: record('coco.resume'),
        requeuePaidMintQuotes: async () => {
          calls.push('coco.requeue');
          return { requeued: [] };
        },
      },
      npcAccount: () => account as never,
      socketCloses: null,
    });

    app.set('background');
    await settle();
    expect(calls).toEqual(['npc.stop', 'coco.pause']);

    calls.length = 0;
    app.set('active');
    await settle();
    expect(calls).toEqual(['coco.resume', 'npc.start', 'npc.sync', 'coco.requeue']);
  });
});
