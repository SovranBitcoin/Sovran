import { describe, test, expect } from 'vitest';
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
});
