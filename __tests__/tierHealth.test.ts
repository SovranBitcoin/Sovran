/**
 * Pure liveness probes for the Nostr data tiers: the nagg HTTP `/healthz` check
 * (routed through a mocked `fetchJson`), the Primal WebSocket round-trip (driven
 * by a fake socket), and the relay-map fold. No network or harness required.
 */
/* eslint-disable import/first */

jest.mock('@/shared/lib/apiClient', () => ({
  __esModule: true,
  fetchJson: jest.fn(),
}));

// `fetchJson` is mocked, so the parser built by `parseWith` is never invoked;
// stub it to dodge jest's ESM directory-import resolution of the schemas source.
jest.mock('@sovranbitcoin/schemas', () => ({
  __esModule: true,
  parseWith: () => () => undefined,
}));

import { ok, err } from 'neverthrow';

import { fetchJson } from '@/shared/lib/apiClient';
import { foldRelayStatus, probeNaggHealth, probePrimalHealth } from '@/shared/lib/nostr/tierHealth';

const mockFetchJson = fetchJson as jest.Mock;

describe('probeNaggHealth', () => {
  afterEach(() => {
    mockFetchJson.mockReset();
  });

  it('is online for a body of { ok: "true" }', async () => {
    mockFetchJson.mockResolvedValue(ok({ ok: 'true' }));
    const result = await probeNaggHealth('https://nagg.example');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(true);
  });

  it('is online for a body of { ok: true } (boolean)', async () => {
    mockFetchJson.mockResolvedValue(ok({ ok: true }));
    const result = await probeNaggHealth('https://nagg.example');
    expect(result._unsafeUnwrap()).toBe(true);
  });

  it('is offline (ok false) for a body of { ok: "false" }', async () => {
    mockFetchJson.mockResolvedValue(ok({ ok: 'false' }));
    const result = await probeNaggHealth('https://nagg.example');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(false);
  });

  it('errors (offline) when the fetch fails — non-2xx, malformed, or unreachable', async () => {
    mockFetchJson.mockResolvedValue(err(new Error('Fetch error: 503')));
    const result = await probeNaggHealth('https://nagg.example');
    expect(result.isErr()).toBe(true);
  });

  it('strips a trailing slash before appending /healthz', async () => {
    mockFetchJson.mockResolvedValue(ok({ ok: 'true' }));
    await probeNaggHealth('https://nagg.example/');
    expect(mockFetchJson).toHaveBeenCalledWith(
      'https://nagg.example/healthz',
      expect.anything(),
      'nostr/nagg-healthz',
      undefined,
      expect.objectContaining({ timeoutMs: 4000 })
    );
  });
});

/** Minimal scriptable WebSocket stand-in driving the probe's event callbacks. */
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

describe('probePrimalHealth', () => {
  it('is online when a frame arrives after the REQ, and closes the socket', async () => {
    let socket: FakeWebSocket | null = null;
    const Ctor = function (this: unknown, url: string) {
      socket = new FakeWebSocket(url);
      return socket;
    } as unknown as typeof WebSocket;

    const promise = probePrimalHealth('wss://cache.example', { WebSocketImpl: Ctor });
    socket!.onopen?.();
    socket!.onmessage?.();

    const result = await promise;
    expect(result._unsafeUnwrap()).toBe(true);
    expect(socket!.sent.some((m) => m.includes('REQ'))).toBe(true);
    expect(socket!.sent.some((m) => m.includes('CLOSE'))).toBe(true);
    expect(socket!.closed).toBe(true);
  });

  it('is offline when the timeout fires with no response', async () => {
    jest.useFakeTimers();
    let socket: FakeWebSocket | null = null;
    const Ctor = function (this: unknown, url: string) {
      socket = new FakeWebSocket(url);
      return socket;
    } as unknown as typeof WebSocket;

    const promise = probePrimalHealth('wss://cache.example', {
      WebSocketImpl: Ctor,
      timeoutMs: 1000,
    });
    socket!.onopen?.();
    jest.advanceTimersByTime(1000);
    const result = await promise;
    expect(result._unsafeUnwrap()).toBe(false);
    jest.useRealTimers();
  });

  it('is offline on a socket error', async () => {
    let socket: FakeWebSocket | null = null;
    const Ctor = function (this: unknown, url: string) {
      socket = new FakeWebSocket(url);
      return socket;
    } as unknown as typeof WebSocket;

    const promise = probePrimalHealth('wss://cache.example', { WebSocketImpl: Ctor });
    socket!.onerror?.();
    const result = await promise;
    expect(result._unsafeUnwrap()).toBe(false);
  });

  it('is offline when the WebSocket constructor throws', async () => {
    const Ctor = function () {
      throw new Error('bad url');
    } as unknown as typeof WebSocket;
    const result = await probePrimalHealth('wss://cache.example', { WebSocketImpl: Ctor });
    expect(result._unsafeUnwrap()).toBe(false);
  });
});

describe('foldRelayStatus', () => {
  it('is online when any relay is connected', () => {
    expect(foldRelayStatus({ a: 'connected', b: 'disconnected' })).toBe('online');
  });
  it('is checking when any is connecting and none connected', () => {
    expect(foldRelayStatus({ a: 'connecting', b: 'failed' })).toBe('checking');
  });
  it('is offline when all are down', () => {
    expect(foldRelayStatus({ a: 'disconnected', b: 'failed' })).toBe('offline');
  });
  it('is offline for an empty pool', () => {
    expect(foldRelayStatus({})).toBe('offline');
  });
});
