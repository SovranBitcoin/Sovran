import { describe, test, expect, vi } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import {
  createRelayPoolConnection,
  type RawRelayEvent,
} from '../src/facade/relay';

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const ID_C = 'c'.repeat(64);
const PUB = 'd'.repeat(64);

function note(id: string, created_at: number): RawRelayEvent {
  return { id, pubkey: PUB, kind: 1, content: `note ${id}`, tags: [], created_at };
}

describe('relay pool connection — dedup + EOSE quorum', () => {
  // Per-relay scripted events; ID_B is delivered by BOTH relays to prove dedup.
  const SCRIPT: Record<string, RawRelayEvent[]> = {
    'wss://r1': [note(ID_A, 200), note(ID_B, 100)],
    'wss://r2': [note(ID_B, 100), note(ID_C, 50)],
  };

  class FakeRelaySocket {
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    constructor(public url: string) {
      queueMicrotask(() => this.onopen?.({}));
    }
    send(data: string) {
      const [, subId] = JSON.parse(data) as [string, string];
      const events = SCRIPT[this.url] ?? [];
      queueMicrotask(() => {
        for (const ev of events) this.onmessage?.({ data: JSON.stringify(['EVENT', subId, ev]) });
        this.onmessage?.({ data: JSON.stringify(['EOSE', subId]) });
      });
    }
    close() {}
  }

  test('collects from both relays, deduped by id, once the EOSE quorum settles', async () => {
    const connection = createRelayPoolConnection({
      relays: ['wss://r1', 'wss://r2'],
      WebSocketImpl: FakeRelaySocket as unknown as new (url: string) => never,
      settleMs: 5,
    });

    const result = await connection.request([{ kinds: [1] }]);
    expect(result.isOk()).toBe(true);
    const ids = result._unsafeUnwrap().map((e) => e.id).sort();
    expect(ids).toEqual([ID_A, ID_B, ID_C].sort()); // ID_B not duplicated
  });
});

describe('regression — relay pool correctness (Stage-F adversarial review)', () => {
  // Bug 1: a real socket fires onerror THEN onclose; a flaky relay must not
  // double-count and prematurely fail the whole page before a healthy relay delivers.
  class FlakySocket {
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    constructor(public url: string) {
      queueMicrotask(() => {
        if (this.url === 'wss://bad') {
          this.onerror?.({});
          this.onclose?.({}); // same dead socket fires both
        } else {
          this.onopen?.({});
        }
      });
    }
    send(data: string) {
      const [, subId] = JSON.parse(data) as [string, string];
      queueMicrotask(() => {
        this.onmessage?.({ data: JSON.stringify(['EVENT', subId, note(ID_A, 100)]) });
        this.onmessage?.({ data: JSON.stringify(['EOSE', subId]) });
      });
    }
    close() {}
  }

  test('one flaky relay (error+close) does not fail the whole page', async () => {
    const connection = createRelayPoolConnection({
      relays: ['wss://bad', 'wss://good'],
      WebSocketImpl: FlakySocket as unknown as new (url: string) => never,
      settleMs: 5,
    });
    const result = await connection.request([{ kinds: [1] }]);
    expect(result.isOk()).toBe(true); // would be err "all relays failed" before the fix
    expect(result._unsafeUnwrap().map((e) => e.id)).toEqual([ID_A]);
  });

  // Bug 2: NIP-01 until is inclusive; the cursor's own (boundary) event must not
  // re-render at the top of the next page.

  test('live subscribe drops forged kind-1059 wraps before dedup and reconnects after socket close', async () => {
    vi.useFakeTimers();
    try {
      const validWrap = finalizeEvent(
        { kind: 1059, created_at: 1_700_000_000, tags: [], content: 'real-cipher' },
        generateSecretKey()
      );
      const forgedWrap = { ...validWrap, content: 'tampered', sig: '00'.repeat(64) };
      const sockets: {
        sent: unknown[][];
        emit: (frame: unknown[]) => void;
        drop: () => void;
      }[] = [];

      class ReconnectingSocket {
        onopen: ((ev: unknown) => void) | null = null;
        onmessage: ((ev: { data: unknown }) => void) | null = null;
        onerror: ((ev: unknown) => void) | null = null;
        onclose: ((ev: unknown) => void) | null = null;
        sent: unknown[][] = [];
        constructor(public url: string) {
          sockets.push({
            sent: this.sent,
            emit: (frame) => this.onmessage?.({ data: JSON.stringify(frame) }),
            drop: () => this.onclose?.({}),
          });
          queueMicrotask(() => this.onopen?.({}));
        }
        send(raw: string) {
          this.sent.push(JSON.parse(raw) as unknown[]);
        }
        close() {}
      }

      const connection = createRelayPoolConnection({
        relays: ['wss://inbox.test'],
        WebSocketImpl: ReconnectingSocket as unknown as new (url: string) => never,
      });

      const received: RawRelayEvent[] = [];
      const stop = connection.subscribe!([{ kinds: [1059] }], (ev) => received.push(ev));
      await Promise.resolve();
      await Promise.resolve();

      const firstSub = sockets[0]!.sent.find((f) => f[0] === 'REQ')![1] as string;
      // Forged wrap with the same id must NOT be delivered AND must NOT poison dedup for the real wrap.
      sockets[0]!.emit(['EVENT', firstSub, forgedWrap]);
      expect(received).toHaveLength(0);
      sockets[0]!.emit(['EVENT', firstSub, validWrap]);
      expect(received).toHaveLength(1);
      expect(received[0]!.content).toBe('real-cipher');

      // Unexpected disconnect schedules a reconnect and sends a fresh REQ.
      sockets[0]!.drop();
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
      expect(sockets.length).toBeGreaterThanOrEqual(2);
      expect(sockets[1]!.sent.some((f) => f[0] === 'REQ')).toBe(true);

      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
