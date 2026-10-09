/** @jest-environment node */
import type { AppStateStatus } from 'react-native';
import { Manager, MemoryRepositories, type WebSocketLike } from '@cashu/coco-core';
import { createWalletForegroundGate, trackSocketCloses } from '@/shared/lib/cashu/manager';

jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));
jest.mock('npubcash-sdk', () => ({ JWTAuthProvider: class {}, NPCClient: class {} }));
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

/**
 * The real coco Manager and its real transports, with only the network faked:
 * sockets that open and close the way React Native's do (a close is reported
 * on a later task) and a mint that answers every `checkstate`. The count of
 * those answers is the HTTP polling this test is about.
 */
const MINT = 'https://mint.example';
const Y = '02'.padEnd(66, 'a');
const SLOW_POLL_MS = 20_000;
const FAST_POLL_MS = 5_000;
const CLOSE_REPORT_MS = 50;

async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

/** Small steps: each poll schedules the next only after its answer settles. */
async function run(ms: number, step = 50) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    jest.advanceTimersByTime(Math.min(step, ms - elapsed));
    await settle();
  }
}

/** Background and return before the closed socket has reported it. */
async function flap(app: ReturnType<typeof createAppState>) {
  app.set('background');
  app.set('active');
  await run(CLOSE_REPORT_MS / 2, 1);
}

function createAppState() {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const appState = {
    currentState: 'active' as AppStateStatus,
    addEventListener: (_type: 'change', listener: (state: AppStateStatus) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  return {
    appState,
    set(state: AppStateStatus) {
      appState.currentState = state;
      for (const listener of [...listeners]) listener(state);
    },
  };
}

function fakeSockets() {
  type Listener = (event: unknown) => void;
  const sockets: { closed: boolean; emit: (type: string) => void }[] = [];
  const factory = (): WebSocketLike => {
    const listeners = new Map<string, Set<Listener>>();
    const emit = (type: string) => listeners.get(type)?.forEach((listener) => listener({}));
    const record = { closed: false, emit };
    sockets.push(record);
    setTimeout(() => !record.closed && emit('open'), 0);
    return {
      send: () => undefined,
      close: () => {
        record.closed = true;
        setTimeout(() => emit('close'), CLOSE_REPORT_MS);
      },
      addEventListener: (type, listener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)?.add(listener);
      },
      removeEventListener: (type, listener) => {
        listeners.get(type)?.delete(listener);
      },
    };
  };
  return { sockets, factory };
}

async function setup(options: { waitForSocketCloses: boolean } = { waitForSocketCloses: true }) {
  const body = { states: [{ Y, state: 'UNSPENT', witness: null }] };
  const response = {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
  const fetchMock = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => response as unknown as Response);

  const ws = fakeSockets();
  const socketCloses = options.waitForSocketCloses ? trackSocketCloses(ws.factory) : null;
  const manager = new Manager(
    new MemoryRepositories(),
    async () => new Uint8Array(64),
    undefined,
    socketCloses?.factory ?? ws.factory
  );
  await manager.subscriptions.subscribe(MINT, 'proof_state', [Y], () => undefined);
  await run(50);

  const app = createAppState();
  const gate = createWalletForegroundGate({
    appState: app.appState,
    manager,
    npcAccount: () => null,
    socketCloses,
  });
  return {
    app,
    sockets: ws.sockets,
    polls: () => fetchMock.mock.calls.length,
    async teardown() {
      await gate.dispose();
      await manager.dispose();
    },
  };
}

describe('coco subscriptions behind the foreground gate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('stops polling while backgrounded, checks at once on return, and keeps the cadence', async () => {
    const t = await setup();
    expect(t.polls()).toBe(1);
    expect(t.sockets).toHaveLength(1);
    await run(SLOW_POLL_MS);
    expect(t.polls()).toBe(2);

    t.app.set('background');
    await run(SLOW_POLL_MS * 6);
    expect(t.polls()).toBe(2);
    expect(t.sockets[0].closed).toBe(true);
    expect(t.sockets).toHaveLength(1);

    t.app.set('active');
    await run(100);
    expect(t.polls()).toBe(3);
    expect(t.sockets).toHaveLength(2);
    expect(t.sockets[1].closed).toBe(false);

    await run(SLOW_POLL_MS - 500);
    expect(t.polls()).toBe(3);
    await run(500);
    expect(t.polls()).toBe(4);
    await t.teardown();
  });

  it('leaves the fast cadence of a mint without a websocket as it was', async () => {
    const t = await setup();
    // The socket drops; coco moves this mint to its fast interval from the
    // next poll on.
    t.sockets[0].emit('close');
    await run(SLOW_POLL_MS);
    expect(t.polls()).toBe(2);
    await run(FAST_POLL_MS);
    expect(t.polls()).toBe(3);

    t.app.set('background');
    await run(FAST_POLL_MS * 12);
    expect(t.polls()).toBe(3);

    t.app.set('active');
    await run(100);
    expect(t.polls()).toBe(4);
    // The return also reconnects the socket coco had given up on.
    expect(t.sockets).toHaveLength(2);

    await run(FAST_POLL_MS);
    expect(t.polls()).toBe(5);
    await run(FAST_POLL_MS);
    expect(t.polls()).toBe(6);
    await t.teardown();
  });

  it('does not move the next poll when the background was shorter than the interval', async () => {
    const t = await setup();
    t.app.set('background');
    await run(1_000);
    t.app.set('active');
    t.app.set('inactive');
    t.app.set('active');
    await run(1_000);
    t.app.set('active');
    await run(1_000);

    // One reconnect for the one return. The poll is not due yet, and coco
    // does not bring it forward: it lands when it would have anyway.
    expect(t.sockets).toHaveLength(2);
    expect(t.polls()).toBe(1);
    await run(SLOW_POLL_MS - 3_500);
    expect(t.polls()).toBe(1);
    await run(1_000);
    expect(t.polls()).toBe(2);
    await t.teardown();
  });

  it('keeps a mint on its websocket through a background that ends at once', async () => {
    const t = await setup();
    await flap(t.app);
    // The replacement is not opened until the old socket has reported closed.
    expect(t.sockets).toHaveLength(1);
    await run(CLOSE_REPORT_MS);
    expect(t.sockets).toHaveLength(2);

    // Still the slow interval, so coco still counts the socket as healthy.
    await run(SLOW_POLL_MS * 2);
    expect(t.polls()).toBe(3);
    expect(t.sockets).toHaveLength(2);
    await t.teardown();
  });

  it('would drop that mint to fast polling without the wait for the old socket', async () => {
    // What trackSocketCloses is for: coco takes the old socket's late close
    // for the new socket failing. If this starts failing, coco has fixed that
    // and the wait can go.
    const t = await setup({ waitForSocketCloses: false });
    await flap(t.app);
    expect(t.sockets).toHaveLength(2);

    await run(SLOW_POLL_MS * 2);
    expect(t.polls()).toBeGreaterThan(3);
    await t.teardown();
  });
});
