import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNostrDataLayer } from '../src/facade';
import {
  createRelayTier,
  type RelayConnection,
  type RawRelayEvent,
  type NostrFilter,
} from '../src/facade/relay';
import type { NaggError } from '../src/errors';

const ME = 'a'.repeat(64);

function wrap(id: string, created_at: number): RawRelayEvent {
  return { id, pubkey: 'b'.repeat(64), kind: 1059, content: 'opaque-ciphertext', tags: [['p', ME]], created_at };
}

describe('getDmEnvelopes — relay floor', () => {
  test('fetches gift wraps by #p with NO since/limit (randomized created_at)', async () => {
    let captured: NostrFilter[] | undefined;
    const connection: RelayConnection = {
      request: (filters): Promise<Result<RawRelayEvent[], NaggError>> => {
        captured = filters;
        return Promise.resolve(ok([wrap('1'.repeat(64), 222), wrap('2'.repeat(64), 111)]));
      },
    };
    const layer = createNostrDataLayer({ tiers: [createRelayTier({ connection })] });

    const result = await layer.getDmEnvelopes({ viewerPubkey: ME, limit: 50 });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(out.tier).toBe('relay');
    expect(out.envelopes).toHaveLength(2);
    expect(out.cursor).toBeNull(); // relay can't paginate gift wraps by arrival
    // the load-bearing caution: no since/limit on the wrap filter
    const f = captured?.[0] ?? {};
    expect(f.kinds).toEqual([4, 1059]);
    expect(f['#p']).toEqual([ME]);
    expect('limit' in f).toBe(false);
    expect('since' in f).toBe(false);
    expect('until' in f).toBe(false);
  });
});

describe('subscribeDmEnvelopes — relay live', () => {
  test('opens a #p/1059 REQ and pushes mapped envelopes; unsubscribe closes it', () => {
    let captured: NostrFilter[] | undefined;
    let push: ((raw: RawRelayEvent) => void) | undefined;
    let closed = false;
    const connection: RelayConnection = {
      request: (): Promise<Result<RawRelayEvent[], NaggError>> => Promise.resolve(ok([])),
      subscribe: (filters, onEvent) => {
        captured = filters;
        push = onEvent;
        return () => {
          closed = true;
        };
      },
    };
    const layer = createNostrDataLayer({ tiers: [createRelayTier({ connection })] });

    const received: string[] = [];
    const unsubscribe = layer.subscribeDmEnvelopes({ viewerPubkey: ME }, (env) =>
      received.push(env.id),
    );

    // Live filter: DM kinds + #p, NO since/limit (gift-wrap created_at is random).
    const f = captured?.[0] ?? {};
    expect(f.kinds).toEqual([4, 1059]);
    expect(f['#p']).toEqual([ME]);
    expect('since' in f).toBe(false);
    expect('limit' in f).toBe(false);

    // An arriving wrap is mapped and pushed.
    push?.(wrap('1'.repeat(64), 222));
    expect(received).toEqual(['1'.repeat(64)]);

    // Malformed events (no id/pubkey) are dropped, not forwarded.
    push?.({ kind: 1059, content: 'x', tags: [], created_at: 1 } as unknown as RawRelayEvent);
    expect(received).toEqual(['1'.repeat(64)]);

    unsubscribe();
    expect(closed).toBe(true);
  });

  test('is a no-op when no relay tier is configured', () => {
    const layer = createNostrDataLayer({ tiers: [] });
    const unsubscribe = layer.subscribeDmEnvelopes({ viewerPubkey: ME }, () => {
      throw new Error('should not fire without a relay tier');
    });
    expect(() => unsubscribe()).not.toThrow();
  });

});


describe('incremental DM envelopes', () => {

  test('relay forwards an explicit since, including zero, without adding a limit', async () => {
    const filters: NostrFilter[][] = [];
    const connection: RelayConnection = {
      request: (value) => {
        filters.push(value);
        return Promise.resolve(ok([]));
      },
    };
    const tier = createRelayTier({ connection });
    await tier.getDmEnvelopes!({ viewerPubkey: ME, since: 100, limit: 25 });
    await tier.getDmEnvelopes!({ viewerPubkey: ME, since: 0 });
    expect(filters).toEqual([
      [{ kinds: [4, 1059], '#p': [ME], since: 100 }],
      [{ kinds: [4, 1059], '#p': [ME], since: 0 }],
    ]);
  });
});
