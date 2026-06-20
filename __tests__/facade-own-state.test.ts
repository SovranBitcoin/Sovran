import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNaggClient } from '../src/transport';
import { createNaggTier, createNostrDataLayer } from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import { createPrimalTier, type PrimalConnection, type RawPrimalEvent } from '../src/facade/primal';
import type { NaggError } from '../src/errors';

const ME = 'a'.repeat(64);
const T1 = 'b'.repeat(64);
const T2 = 'e'.repeat(64);

function ownEvent(id: string, kind: number, created_at: number, tags: string[][] = []): RawRelayEvent {
  return { id, pubkey: ME, kind, content: kind === 7 ? '+' : '', tags, created_at };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

describe('getOwnHistory — nagg tier', () => {
  test('lists my likes newest-first from /nostr/own/likes', async () => {
    let lastUrl = '';
    const client = createNaggClient({
      endpoint: 'https://nagg.test/graphql',
      appView: { baseUrl: 'https://nagg.test' },
      transport: 'appview',
      fetchImpl: (async (url: string) => {
        lastUrl = String(url);
        return jsonResponse({
          events: [ownEvent('1'.repeat(64), 7, 100, [['e', T1]]), ownEvent('2'.repeat(64), 7, 200, [['e', T2]])],
          paginationUntil: 100,
        });
      }) as unknown as typeof fetch,
    });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.getOwnHistory({ actionType: 'likes', viewerPubkey: ME });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(lastUrl).toContain('/nostr/own/likes');
    expect(out.tier).toBe('nagg');
    expect(out.actionType).toBe('likes');
    expect(out.entries.map((e) => e.id)).toEqual(['2'.repeat(64), '1'.repeat(64)]); // newest-first
  });
});

describe('getOwnHistory — relay floor', () => {
  function fakeRelay(events: RawRelayEvent[]): RelayConnection {
    return { request: (): Promise<Result<RawRelayEvent[], NaggError>> => Promise.resolve(ok(events)) };
  }

  test('splits authored vs replies on the presence of an #e reference', async () => {
    const authored = ownEvent('1'.repeat(64), 1, 100, []); // no #e → authored
    const reply = ownEvent('2'.repeat(64), 1, 200, [['e', T1]]); // #e → reply
    const tier = createRelayTier({ connection: fakeRelay([authored, reply]) });

    const asAuthored = await tier.ownHistory!({ actionType: 'authored', viewerPubkey: ME });
    const asReplies = await tier.ownHistory!({ actionType: 'replies', viewerPubkey: ME });
    if (asAuthored.kind === 'answered') {
      expect([...asAuthored.value.itemsById.keys()]).toEqual(['1'.repeat(64)]);
    }
    if (asReplies.kind === 'answered') {
      expect([...asReplies.value.itemsById.keys()]).toEqual(['2'.repeat(64)]);
    }
  });

  test('zaps-sent is an accepted ceiling on the floor (unsupported)', async () => {
    const tier = createRelayTier({ connection: fakeRelay([]) });
    const outcome = await tier.ownHistory!({ actionType: 'zaps-sent', viewerPubkey: ME });
    expect(outcome.kind).toBe('unsupported');
  });
});

describe('getOwnHistory — my-likes falls through Primal to the floor', () => {
  function fakePrimal(events: RawPrimalEvent[]): PrimalConnection {
    return { request: (): Promise<Result<RawPrimalEvent[], NaggError>> => Promise.resolve(ok(events)) };
  }
  function fakeRelay(events: RawRelayEvent[]): RelayConnection {
    return { request: (): Promise<Result<RawRelayEvent[], NaggError>> => Promise.resolve(ok(events)) };
  }

  test('Primal has no my-likes verb (unsupported) → relay answers', async () => {
    const layer = createNostrDataLayer({
      tiers: [
        createPrimalTier({ connection: fakePrimal([]) }),
        createRelayTier({ connection: fakeRelay([ownEvent('1'.repeat(64), 7, 100, [['e', T1]])]) }),
      ],
    });

    const result = await layer.getOwnHistory({ actionType: 'likes', viewerPubkey: ME });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().tier).toBe('relay');
  });
});
