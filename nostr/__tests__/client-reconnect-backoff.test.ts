import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { NostrClient } from '../src/client';

// ---------------------------------------------------------------------------
// D8: a relay that is down must not be redialled every 3 s for ever, and the
// client must go quiet in the background.
// ---------------------------------------------------------------------------

class RelaySocket {
  static instances: RelaySocket[] = [];
  /** Relays that refuse the connection. */
  static dead = new Set<string>();
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  sent: unknown[][] = [];
  closed = false;
  constructor(public url: string) {
    RelaySocket.instances.push(this);
    queueMicrotask(() => {
      if (RelaySocket.dead.has(url)) this.onerror?.({});
      else this.onopen?.({});
    });
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as unknown[]);
  }
  close() {
    this.closed = true;
  }
}

const Impl = RelaySocket as unknown as new (url: string) => never;
const DEAD = 'wss://dead.test';
const LIVE = 'wss://live.test';
const dials = (url: string) => RelaySocket.instances.filter((socket) => socket.url === `${url}/`).length;
const last = (url: string) => RelaySocket.instances.filter((socket) => socket.url === `${url}/`).at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  RelaySocket.instances = [];
  RelaySocket.dead = new Set([`${DEAD}/`]);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('NostrClient reconnect backoff', () => {
  test('a dead relay is redialled 3 s, 6 s, 12 s … up to 60 s apart, not every 3 s', async () => {
    const client = new NostrClient({ relays: [DEAD], WebSocketImpl: Impl, random: () => 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(dials(DEAD)).toBe(1);
    const dialledAt: number[] = [];
    let seen = 1;
    for (let second = 1; second <= 300; second += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      if (dials(DEAD) > seen) {
        seen = dials(DEAD);
        dialledAt.push(second);
      }
    }
    expect(dialledAt).toEqual([3, 9, 21, 45, 93, 153, 213, 273]);
    client.dispose();
  });

  test('the delay is jittered down to half', async () => {
    const client = new NostrClient({ relays: [DEAD], WebSocketImpl: Impl, random: () => 0 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(dials(DEAD)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(dials(DEAD)).toBe(2);
    client.dispose();
  });

  test('a relay that accepts and drops at once still backs off; one that stayed up starts over', async () => {
    RelaySocket.dead.clear();
    const client = new NostrClient({ relays: [LIVE], WebSocketImpl: Impl, random: () => 1 });
    await vi.advanceTimersByTimeAsync(0);
    last(LIVE).onclose?.({});
    await vi.advanceTimersByTimeAsync(3_000);
    expect(dials(LIVE)).toBe(2);
    last(LIVE).onclose?.({});
    // Second short-lived connection: 6 s, not 3 s.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(dials(LIVE)).toBe(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(dials(LIVE)).toBe(3);
    // This one lasts.
    await vi.advanceTimersByTimeAsync(31_000);
    last(LIVE).onclose?.({});
    await vi.advanceTimersByTimeAsync(3_000);
    expect(dials(LIVE)).toBe(4);
    client.dispose();
  });
});

describe('NostrClient in the background', () => {
  test('pause stops the reconnect timer; resume redials at once', async () => {
    const client = new NostrClient({ relays: [DEAD], WebSocketImpl: Impl, random: () => 1 });
    await vi.advanceTimersByTimeAsync(0);
    client.pause();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(dials(DEAD)).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    client.resume();
    expect(dials(DEAD)).toBe(2);
    // And the failure after a resume starts from the first step again.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(dials(DEAD)).toBe(3);
    client.dispose();
  });

  test('pause closes a socket that carries nothing and keeps one with a subscription', async () => {
    RelaySocket.dead.clear();
    const client = new NostrClient({ relays: [LIVE, 'wss://idle.test'], WebSocketImpl: Impl });
    await vi.advanceTimersByTimeAsync(0);
    client.subscribeRelay(LIVE, [{ kinds: [3] }], { onEvent: () => {}, onEose: () => {} });
    client.pause();
    expect(last(LIVE).closed).toBe(false);
    expect(last('wss://idle.test').closed).toBe(true);
    expect(client.getRelayHealth()['wss://idle.test/']).toBe('disconnected');
    client.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(dials('wss://idle.test')).toBe(2);
    expect(dials(LIVE)).toBe(1);
    client.dispose();
  });

  test('a socket waiting on a publish OK is not closed by pause, and a publish while paused still connects', async () => {
    RelaySocket.dead.clear();
    const client = new NostrClient({ relays: [LIVE, 'wss://idle.test'], WebSocketImpl: Impl });
    await vi.advanceTimersByTimeAsync(0);
    const event = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: 'x' }, generateSecretKey());
    const inFlight = client.publishToRelay(LIVE, event);
    client.pause();
    expect(last(LIVE).closed).toBe(false);
    last(LIVE).onmessage?.({ data: JSON.stringify(['OK', event.id, true, '']) });
    await expect(inFlight).resolves.toBeUndefined();

    // Paused and closed: sending money still opens the socket it needs.
    const later = client.publishToRelay('wss://idle.test', event);
    await vi.advanceTimersByTimeAsync(0);
    expect(dials('wss://idle.test')).toBe(2);
    expect(last('wss://idle.test').sent.map((frame) => [frame[0], (frame[1] as { id: string }).id])).toEqual([
      ['EVENT', event.id],
    ]);
    last('wss://idle.test').onmessage?.({ data: JSON.stringify(['OK', event.id, true, '']) });
    await expect(later).resolves.toBeUndefined();
    client.dispose();
  });

  test('a relay added while paused is dialled on resume, not before', async () => {
    RelaySocket.dead.clear();
    const client = new NostrClient({ relays: [LIVE], WebSocketImpl: Impl });
    await vi.advanceTimersByTimeAsync(0);
    client.pause();
    client.ensureRelays(['wss://added.test']);
    expect(dials('wss://added.test')).toBe(0);
    client.resume();
    expect(dials('wss://added.test')).toBe(1);
    client.dispose();
  });
});
