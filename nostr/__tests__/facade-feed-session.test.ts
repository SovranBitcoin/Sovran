import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNostrDataLayer } from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import type { NaggError } from '../src/errors';
import type { FeedItem } from '../src/facade';

const PUB = 'd'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const rawNote = (id: string, createdAt: number): RawRelayEvent => ({
  id,
  pubkey: PUB,
  kind: 1,
  content: `note ${id}`,
  tags: [],
  created_at: createdAt,
});

const noteIds = (items: ReadonlyArray<FeedItem>) =>
  items.map((i) => (i.type === 'note' ? i.event.id : ''));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('openFeedSession', () => {
  test('pages from the tier, withholds live items behind pendingNew, loadNew reveals', async () => {
    const live: { onEvent: ((e: RawRelayEvent) => void) | null } = { onEvent: null };
    const connection: RelayConnection = {
      request: (): Promise<Result<RawRelayEvent[], NaggError>> =>
        Promise.resolve(ok([rawNote(A, 100), rawNote(B, 90)])),
      subscribe: (_filters, onEvent) => {
        live.onEvent = onEvent;
        return () => {
          live.onEvent = null;
        };
      },
    };
    const layer = createNostrDataLayer({ tiers: [createRelayTier({ connection })] });
    const session = layer.openFeedSession({ spec: { kind: 'following-recent', authors: [PUB] } });

    const first = await session.firstPage();
    expect(noteIds(first)).toEqual([A, B]); // newest-first
    expect(session.pendingNew()).toBe(0);
    expect(live.onEvent).not.toBeNull(); // listener started

    // write-through populated the shared cache
    expect(layer.cache.getNote(A)?.content).toBe(`note ${A}`);

    // a newer note arrives on the listener — withheld, not injected
    live.onEvent?.(rawNote(C, 200));
    await sleep(70); // let the 50ms settle window fire
    expect(session.pendingNew()).toBe(1);
    expect(noteIds(session.revealed)).toEqual([A, B]); // screen unchanged

    // explicit tap reveals it at the top
    expect(noteIds(session.loadNew())).toEqual([C, A, B]);
    expect(session.pendingNew()).toBe(0);
    session.close();
  });

  test('a connection that cannot stream yields a no-op listener (pendingNew stays 0)', async () => {
    // No subscribe capability → the live seam is a no-op; the session is pure pagination.
    const connection: RelayConnection = {
      request: () => Promise.resolve(ok([rawNote(A, 100)])),
    };
    const layer = createNostrDataLayer({ tiers: [createRelayTier({ connection })] });
    const session = layer.openFeedSession({ spec: { kind: 'user', pubkey: PUB } });
    await session.firstPage();
    expect(session.pendingNew()).toBe(0);
    session.close();
  });
});
