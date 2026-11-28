import { describe, expect, test, vi, afterEach } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNostrDataLayer, createNostrEntityCache, ingestSearchHits } from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import { createPrimalTier, type PrimalConnection, type RawPrimalEvent } from '../src/facade/primal';
import type { NaggError } from '../src/errors';

// ---------------------------------------------------------------------------
// D5 / D6: a kind-0 is a replaceable event. Whatever source it came from and
// whatever order the answers land in, the newest `created_at` is the profile.
// ---------------------------------------------------------------------------

const PK = 'a'.repeat(64);

function kind0(content: Record<string, string>, createdAt: number, idChar = '1'): RawRelayEvent {
  return { id: idChar.repeat(64), pubkey: PK, kind: 0, content: JSON.stringify(content), created_at: createdAt };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

const OLD = kind0({ name: 'alice', lud16: 'alice@old.example', about: 'old bio' }, 1_700_000_000, '1');
/** The same person later removed their Lightning address and their bio. */
const NEW = kind0({ name: 'alice' }, 1_700_009_999, '2');

async function fetchWith(order: 'primal-first' | 'relay-first', primalHas: RawRelayEvent, relayHas: RawRelayEvent) {
  const primalAnswer = deferred<Result<RawPrimalEvent[], NaggError>>();
  const relayAnswer = deferred<Result<RawRelayEvent[], NaggError>>();
  const primal: PrimalConnection = { request: () => primalAnswer.promise };
  const relay: RelayConnection = { request: () => relayAnswer.promise };
  const layer = createNostrDataLayer({
    tiers: [createPrimalTier({ connection: primal }), createRelayTier({ connection: relay })],
  });
  let complete = false;
  layer.cache.pendingProfiles.subscribeKey(PK, () => {
    complete = !layer.cache.pendingProfiles.has(PK);
  });
  const read = layer.getProfiles({ pubkeys: [PK], refresh: true });
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  if (order === 'primal-first') {
    primalAnswer.resolve(ok([primalHas]));
    await settle();
    relayAnswer.resolve(ok([relayHas]));
  } else {
    relayAnswer.resolve(ok([relayHas]));
    await settle();
    primalAnswer.resolve(ok([primalHas]));
  }
  await read;
  await vi.waitFor(() => expect(complete).toBe(true));
  return layer;
}

describe('newest created_at wins across sources', () => {
  test.each(['primal-first', 'relay-first'] as const)(
    'a stale Primal kind-0 never overwrites a newer relay kind-0 (%s)',
    async (order) => {
      const layer = await fetchWith(order, OLD, NEW);
      const record = layer.cache.getProfile(PK);
      expect(record?.seenAt).toBe(1_700_009_999);
      expect(record?.name).toBe('alice');
      // Removed by the newer event: neither kept nor put back by the older one.
      expect(record?.lud16).toBeUndefined();
      expect(record?.about).toBeUndefined();
    },
  );

  test.each(['primal-first', 'relay-first'] as const)(
    'a stale relay kind-0 never overwrites a newer Primal kind-0 (%s)',
    async (order) => {
      const layer = await fetchWith(order, NEW, OLD);
      const record = layer.cache.getProfile(PK);
      expect(record?.seenAt).toBe(1_700_009_999);
      expect(record?.lud16).toBeUndefined();
      expect(record?.about).toBeUndefined();
    },
  );

  test('the read itself resolves with the newest event, not the best-ranked tier', async () => {
    const primal: PrimalConnection = { request: () => Promise.resolve(ok([OLD])) };
    const relay: RelayConnection = { request: () => Promise.resolve(ok([NEW])) };
    const layer = createNostrDataLayer({
      tiers: [createPrimalTier({ connection: primal }), createRelayTier({ connection: relay })],
    });
    let last: Record<string, unknown> | undefined;
    layer.cache.profiles.subscribeKey(PK, () => {
      last = layer.cache.profiles.peek(PK);
    });
    await layer.getProfiles({ pubkeys: [PK], refresh: true });
    await vi.waitFor(() => expect(layer.cache.pendingProfiles.has(PK)).toBe(false));
    expect(last?.lud16).toBeUndefined();
  });
});

describe('entity cache: a newer profile replaces fields, including removals', () => {
  test('a lightning address the person removed is no longer in the cache (lud16)', () => {
    const cache = createNostrEntityCache();
    cache.ingestProfileMetadata(
      { [PK]: { name: 'alice', lud16: 'alice@old.example', lud06: 'lnurl1old' } },
      1,
      'relay',
      { createdAt: { [PK]: 1_700_000_000 } },
    );
    expect(cache.getProfile(PK)?.lud16).toBe('alice@old.example');
    cache.ingestProfileMetadata({ [PK]: { name: 'alice' } }, 1, 'relay', {
      createdAt: { [PK]: 1_700_000_500 },
    });
    expect(cache.getProfile(PK)?.lud16).toBeUndefined();
    expect(cache.getProfile(PK)?.lud06).toBeUndefined();
  });

  test('an event time in seconds is the merge order: a later fetch of a newer event wins over an earlier authoritative write', () => {
    const cache = createNostrEntityCache();
    // What `ingestResolvedProfiles` writes for a profile resolved on Send.
    cache.ingestProfileMetadata({ [PK]: { name: 'alice', lud16: 'alice@old.example' } }, 1, 'relay', {
      createdAt: { [PK]: 1_700_000_000 },
    });
    // A later fetch from a better-ranked tier, of the event that removed it.
    cache.ingestProfileMetadata({ [PK]: { name: 'alice' } }, 1, 'primal', {
      createdAt: { [PK]: 1_700_000_500 },
    });
    expect(cache.getProfile(PK)?.lud16).toBeUndefined();
    expect(cache.getProfile(PK)?.seenAt).toBe(1_700_000_500);
  });

  test('an older event that arrives later fills nothing, not even a blank', () => {
    const cache = createNostrEntityCache();
    cache.ingestProfileMetadata({ [PK]: { name: 'alice' } }, 1, 'relay', {
      createdAt: { [PK]: 1_700_000_500 },
    });
    cache.ingestProfileMetadata(
      { [PK]: { name: 'old alice', lud16: 'alice@old.example', picture: 'old.png' } },
      1,
      'primal',
      { createdAt: { [PK]: 1_700_000_000 } },
    );
    expect(cache.getProfile(PK)).toMatchObject({ name: 'alice', seenAt: 1_700_000_500 });
    expect(cache.getProfile(PK)?.lud16).toBeUndefined();
    expect(cache.getProfile(PK)?.picture).toBeUndefined();
  });

  test('an answer with no event time loses to one that has it', () => {
    const cache = createNostrEntityCache();
    cache.ingestProfileMetadata({ [PK]: { name: 'alice' } }, 1, 'relay', {
      createdAt: { [PK]: 1_700_000_500 },
    });
    cache.ingestProfileMetadata({ [PK]: { name: 'untimed', lud16: 'x@y.example' } }, 1, 'primal');
    expect(cache.getProfile(PK)).toMatchObject({ name: 'alice' });
    expect(cache.getProfile(PK)?.lud16).toBeUndefined();
  });

  test('a seed fills a blank picture on a real profile but never a payment address', () => {
    const cache = createNostrEntityCache();
    cache.ingestProfileMetadata({ [PK]: { name: 'alice' } }, 1, 'relay', {
      createdAt: { [PK]: 1_700_000_500 },
    });
    cache.ingestProfileMetadata(
      { [PK]: { name: 'index name', picture: 'index.png', lud16: 'alice@index.example', lud06: 'lnurl1index' } },
      0,
      'nagg',
    );
    expect(cache.getProfile(PK)).toMatchObject({ name: 'alice', picture: 'index.png' });
    expect(cache.getProfile(PK)?.lud16).toBeUndefined();
    expect(cache.getProfile(PK)?.lud06).toBeUndefined();
  });

  test('a real profile replaces a seed outright', () => {
    const cache = createNostrEntityCache();
    cache.ingestProfileMetadata({ [PK]: { name: 'seed', lud16: 'seed@index.example', about: 'seed bio' } }, 0, 'nagg');
    cache.ingestProfileMetadata({ [PK]: { name: 'alice' } }, 1, 'relay', {
      createdAt: { [PK]: 1_700_000_500 },
    });
    expect(cache.getProfile(PK)?.name).toBe('alice');
    expect(cache.getProfile(PK)?.lud16).toBeUndefined();
    expect(cache.getProfile(PK)?.about).toBeUndefined();
  });

  test('a person who cleared their whole profile is cleared here too', async () => {
    const cleared: RawRelayEvent = { id: '3'.repeat(64), pubkey: PK, kind: 0, content: '{}', created_at: 1_700_010_000 };
    const layer = createNostrDataLayer({
      tiers: [
        createPrimalTier({ connection: { request: () => Promise.resolve(ok([OLD])) } }),
        createRelayTier({ connection: { request: () => Promise.resolve(ok([cleared])) } }),
      ],
    });
    await layer.getProfiles({ pubkeys: [PK], refresh: true });
    await vi.waitFor(() => expect(layer.cache.pendingProfiles.has(PK)).toBe(false));
    expect(layer.cache.getProfile(PK)?.lud16).toBeUndefined();
    expect(layer.cache.getProfile(PK)?.name).toBeUndefined();
  });

  test('the same event answered again keeps the record’s identity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const cache = createNostrEntityCache();
    const ingest = (source: 'primal' | 'relay') =>
      cache.ingestProfileMetadata({ [PK]: { name: 'alice', picture: 'a.png' } }, 1, source, {
        createdAt: { [PK]: 1_700_000_500 },
      });
    ingest('primal');
    const first = cache.profiles.peek(PK);
    let notified = 0;
    cache.profiles.subscribeKey(PK, () => {
      notified += 1;
    });
    vi.setSystemTime(1_800_000_000_000 + 30_000);
    ingest('relay');
    ingest('primal');
    expect(cache.profiles.peek(PK)).toBe(first);
    expect(notified).toBe(0);
  });
});

describe('negative cache: an absent profile is not refetched on every mount', () => {
  const NOW = 1_800_000_000_000;

  test('a miss backs off 1 min, then 10 min, then 1 h', () => {
    const cache = createNostrEntityCache();
    expect(cache.isProfileMissed(PK, NOW)).toBe(false);
    cache.settleProfileFetch([PK], 'answered', NOW);
    expect(cache.isProfileMissed(PK, NOW + 59_000)).toBe(true);
    expect(cache.isProfileMissed(PK, NOW + 61_000)).toBe(false);
    cache.settleProfileFetch([PK], 'answered', NOW);
    expect(cache.isProfileMissed(PK, NOW + 9 * 60_000)).toBe(true);
    expect(cache.isProfileMissed(PK, NOW + 11 * 60_000)).toBe(false);
    cache.settleProfileFetch([PK], 'answered', NOW);
    cache.settleProfileFetch([PK], 'answered', NOW);
    expect(cache.isProfileMissed(PK, NOW + 59 * 60_000)).toBe(true);
    expect(cache.isProfileMissed(PK, NOW + 61 * 60_000)).toBe(false);
  });

  test('a fetch no source answered is retried after 30 s and does not escalate', () => {
    const cache = createNostrEntityCache();
    cache.settleProfileFetch([PK], 'failed', NOW);
    cache.settleProfileFetch([PK], 'failed', NOW);
    cache.settleProfileFetch([PK], 'failed', NOW);
    expect(cache.isProfileMissed(PK, NOW + 29_000)).toBe(true);
    expect(cache.isProfileMissed(PK, NOW + 31_000)).toBe(false);
  });

  test('a profile that was found is not a miss, and finding it clears an earlier one', () => {
    const cache = createNostrEntityCache();
    cache.settleProfileFetch([PK], 'answered', NOW);
    cache.ingestProfileMetadata({ [PK]: { name: 'alice' } }, 1, 'relay', { createdAt: { [PK]: 1_700_000_500 } });
    cache.settleProfileFetch([PK], 'answered', NOW);
    expect(cache.isProfileMissed(PK, NOW)).toBe(false);
  });

  test('a seed alone does not count as found', () => {
    const cache = createNostrEntityCache();
    cache.ingestProfileInfos({ [PK]: { name: 'seed' } }, 'nagg');
    cache.settleProfileFetch([PK], 'answered', NOW);
    expect(cache.isProfileMissed(PK, NOW)).toBe(true);
  });
});

describe('search hits that carry their kind-0 are real profile answers (D11)', () => {
  test('a hit with an event time is ingested as fetched; one without stays a seed', () => {
    const cache = createNostrEntityCache();
    const other = 'b'.repeat(64);
    ingestSearchHits(
      cache,
      [
        { pubkey: PK, metadata: { name: 'alice', lud16: 'alice@new.example' }, metadataCreatedAt: 1_700_000_500 },
        { pubkey: other, metadata: { name: 'index only' } },
      ],
      'primal',
    );
    expect(cache.getProfile(PK)).toMatchObject({ seenAt: 1_700_000_500, lud16: 'alice@new.example' });
    expect(cache.getProfile(PK)?.fetchedAt).toBeGreaterThan(0);
    expect(cache.getProfile(other)?.seenAt).toBe(0);
    expect(cache.getProfile(other)?.fetchedAt).toBeUndefined();
  });
});
