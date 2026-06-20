import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import {
  parseProfileMetadata,
  profilesFromKind0,
  createNostrDataLayer,
  pendingFeedTier,
} from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import { createPrimalTier, type PrimalConnection, type RawPrimalEvent } from '../src/facade/primal';
import type { NaggError } from '../src/errors';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('parseProfileMetadata', () => {
  test('parses full metadata + display_name alias; null on junk', () => {
    const m = parseProfileMetadata(
      JSON.stringify({ name: 'al', display_name: 'Alice', picture: 'p', nip05: 'a@b', lud16: 'a@c' }),
    );
    expect(m).toMatchObject({ name: 'al', displayName: 'Alice', picture: 'p', nip05: 'a@b', lud16: 'a@c' });
    expect(parseProfileMetadata('{not json')).toBeNull();
    expect(parseProfileMetadata('{}')).toBeNull(); // nothing useful
  });
});

describe('profilesFromKind0', () => {
  test('keeps the latest kind-0 per author', () => {
    const profiles = profilesFromKind0([
      { pubkey: A, kind: 0, content: JSON.stringify({ name: 'old' }), created_at: 100 },
      { pubkey: A, kind: 0, content: JSON.stringify({ name: 'new' }), created_at: 200 },
      { pubkey: B, kind: 1, content: 'not a profile', created_at: 50 }, // non-kind-0 ignored
    ]);
    expect(profiles[A]?.name).toBe('new');
    expect(profiles[B]).toBeUndefined();
  });
});

describe('getProfiles through the facade', () => {
  test('relay floor serves kind-0 by authors', async () => {
    const events: RawRelayEvent[] = [
      { id: '1'.repeat(64), pubkey: A, kind: 0, content: JSON.stringify({ name: 'alice' }), created_at: 100 },
    ];
    let captured: unknown;
    const connection: RelayConnection = {
      request: (filters): Promise<Result<RawRelayEvent[], NaggError>> => {
        captured = filters;
        return Promise.resolve(ok(events));
      },
    };
    const layer = createNostrDataLayer({ tiers: [pendingFeedTier('nagg'), createRelayTier({ connection })] });
    const result = await layer.getProfiles({ pubkeys: [A] });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(out.tier).toBe('relay');
    expect(out.profiles[A]?.name).toBe('alice');
    expect((captured as { authors?: string[] }[])[0]?.authors).toEqual([A]);
  });

  test('Primal serves user_infos before the relay floor', async () => {
    const batch: RawPrimalEvent[] = [
      { id: '2'.repeat(64), pubkey: A, kind: 0, content: JSON.stringify({ display_name: 'Alice P' }), created_at: 100 },
    ];
    let verb: string | undefined;
    const primal: PrimalConnection = {
      request: (req): Promise<Result<RawPrimalEvent[], NaggError>> => {
        verb = req.verb;
        return Promise.resolve(ok(batch));
      },
    };
    const layer = createNostrDataLayer({ tiers: [createPrimalTier({ connection: primal })] });
    const result = await layer.getProfiles({ pubkeys: [A] });
    expect(verb).toBe('user_infos');
    expect(result._unsafeUnwrap().profiles[A]?.displayName).toBe('Alice P');
  });

  test('empty pubkeys short-circuits to an empty answer', async () => {
    const tier = createRelayTier({ connection: { request: () => Promise.resolve(ok([])) } });
    const outcome = await tier.getProfiles!({ pubkeys: [] });
    expect(outcome.kind).toBe('answered');
  });
});
