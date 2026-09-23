import { useOwnProfileMetadataStore } from '@/shared/stores/profile/ownProfileMetadataStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { getMockProfileMetadata } from '@/shared/stores/runtime/mockDataStore';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { facade } from 'nostr';
import {
  Kind0MetadataSchema,
  cachedProfileToMetadata,
  type NostrProfileMetadata,
} from '@/shared/stores/global/nostrMetadataCache';
import { useCachedNostrProfile, useProfileRecordsMany } from '@/shared/lib/nostr/useEntityCache';
import { fetchProfilesViaFacade } from '@/shared/lib/nostr/fetchProfiles';
import { newReadId, readEvents, readKeyHash } from '@/shared/lib/read/readLog';
import { useQueryResultLogger } from '@/shared/lib/logger';

/** A pubkey that missed is retried after this long (a tier may have been momentarily down). */
const RETRY_ATTEMPT_WINDOW_MS = 60_000;

/** One `read.profiles.*` request/done/failed triple around a facade profile fetch. */
async function fetchProfilesLogged(
  pubkeys: string[],
  cached: number,
  stale: number,
  trigger: 'mount' | 'poll'
): Promise<Record<string, facade.ProfileMetadata>> {
  const readId = newReadId('profiles');
  const keyHash = readKeyHash(pubkeys.join(','));
  const t0 = Date.now();
  readEvents.request({
    readId,
    surface: 'profiles',
    keyHash,
    mode: trigger === 'poll' ? 'revalidate' : 'initial',
    trigger,
    action: 'fetch',
    strategy: 'aggregate',
    cached: cached > 0,
    stale: stale > 0,
    coldStart: cached === 0,
    gen: 0,
  });
  try {
    const profiles = await fetchProfilesViaFacade(pubkeys, { refresh: true, readId });
    const count = Object.keys(profiles).length;
    readEvents.done({
      readId,
      surface: 'profiles',
      keyHash,
      gen: 0,
      durationMs: Date.now() - t0,
      source: 'network',
      count,
      empty: count === 0,
      degraded: count < pubkeys.length,
      complete: true,
    });
    return profiles;
  } catch (error) {
    readEvents.failed({
      readId,
      surface: 'profiles',
      keyHash,
      gen: 0,
      durationMs: Date.now() - t0,
      errorType: error instanceof Error ? error.name : typeof error,
      retained: cached > 0,
    });
    return {};
  }
}

const STALE_TTL_MS = 24 * 60 * 60 * 1000;

interface UseNostrProfileMetadataResult {
  metadata: NostrProfileMetadata | undefined;
  isLoading: boolean;
  /** True while a real kind-0 fetch is still needed or in flight — including
   *  the first render (before the fetch effect has run), retry backoff
   *  windows, and revalidation of a stale/seeded record. Surfaces that render
   *  a generative fallback (e.g. the clay avatar) should hold their loading
   *  placeholder while this is true, so users see placeholder → final and
   *  never a fallback that an in-flight fetch is about to replace. `isLoading`
   *  alone misses the seeded-record case: a feed-seeded name-only record is
   *  "stale, not missing", so `isLoading` stays false while the fetch that
   *  will deliver the picture is still running. */
  isResolving: boolean;
}

const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 4_000;

export function useNostrProfileMetadata(pubkey: string | undefined): UseNostrProfileMetadataResult {
  // Reads the single owner (entity cache) via useCachedNostrProfile; a fetch
  // write-throughs there (getProfiles), so no explicit cache write here.
  const mockMode = useSettingsStore((state) => state.mockMode);
  const fixture = mockMode && pubkey ? getMockProfileMetadata(pubkey) : undefined;
  const cached = useCachedNostrProfile(pubkey ?? '');
  const baseMetadata = fixture ?? cached.metadata;
  const isOwn = useProfileStore(
    (s) =>
      !!pubkey &&
      s.profiles.find((profile) => profile.accountIndex === s.activeAccountIndex)?.pubkey === pubkey
  );
  const optimistic = useOwnProfileMetadataStore((s) => (isOwn ? s.optimistic : null));
  const metadata = optimistic
    ? {
        ...baseMetadata,
        fetchedAt: baseMetadata?.fetchedAt ?? 0,
        ...(optimistic.name !== undefined ? { displayName: optimistic.name } : {}),
        ...(optimistic.picture !== undefined ? { picture: optimistic.picture ?? undefined } : {}),
        ...(optimistic.lud16 !== undefined ? { lud16: optimistic.lud16 ?? undefined } : {}),
        ...(optimistic.nip05 !== undefined ? { nip05: optimistic.nip05 ?? undefined } : {}),
        ...(optimistic.about !== undefined ? { about: optimistic.about ?? undefined } : {}),
      }
    : baseMetadata;
  const isStale = !fixture && cached.isStale;
  const isMissing = !fixture && cached.isMissing;
  const [isFetching, setIsFetching] = useState(false);

  // Per-pubkey attempt counter, capped at MAX_FETCH_ATTEMPTS. A facade fetch can
  // come back empty for a TRANSIENT reason (a tier was momentarily down / the
  // cache hadn't warmed). The old code marked the pubkey done after ONE such miss
  // and never retried, so kind-0 could stay missing forever. We now retry on a
  // short backoff a bounded number of times; a genuine not-found still settles
  // after the cap without looping.
  const attempts = useRef<Map<string, number>>(new Map());
  const inFlight = useRef(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const attemptCount = pubkey ? (attempts.current.get(pubkey) ?? 0) : MAX_FETCH_ATTEMPTS;
  const needsFetch = !!pubkey && (isMissing || isStale) && attemptCount < MAX_FETCH_ATTEMPTS;
  // Log inputs only: read through a ref so they are not effect dependencies.
  const logCtxRef = useRef({ isMissing, isStale, attemptCount });
  logCtxRef.current = { isMissing, isStale, attemptCount };

  useEffect(() => {
    if (!pubkey || !needsFetch) return;
    attempts.current.set(pubkey, (attempts.current.get(pubkey) ?? 0) + 1);
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // Ref-counted rather than gated on `cancelled`: bumping the attempt counter
    // to the cap flips `needsFetch` during this effect's own lifetime, which
    // runs this cleanup (cancelled=true) while the fetch is still in flight — a
    // cancel-guarded `setIsFetching(false)` then never fires and isFetching
    // sticks true forever for a profile-less pubkey. The counter also keeps an
    // overlapping newer fetch from being clobbered back to false.
    inFlight.current += 1;
    setIsFetching(true);
    // refresh:true so a stale/boot-seeded record is revalidated, not served back.
    void fetchProfilesLogged(
      [pubkey],
      logCtxRef.current.isMissing ? 0 : 1,
      logCtxRef.current.isStale ? 1 : 0,
      logCtxRef.current.attemptCount > 0 ? 'poll' : 'mount'
    )
      .then((profiles) => {
        if (cancelled) return;
        // getProfiles already ingested any resolved profile into the entity cache
        // (the single owner), so the reactive read updates itself — we only track
        // resolution here to stop / schedule retries.
        if (profiles[pubkey]) {
          attempts.current.set(pubkey, MAX_FETCH_ATTEMPTS); // resolved → stop retrying
          return;
        }
        // Nothing resolved this round — schedule a bounded retry.
        retryTimer = setTimeout(() => {
          if (!cancelled) setRetryNonce((n) => n + 1);
        }, RETRY_BACKOFF_MS);
      })
      .finally(() => {
        inFlight.current -= 1;
        if (inFlight.current === 0) setIsFetching(false);
      });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // retryNonce drives the bounded retry: bumping it re-runs the effect, which
    // re-reads the (now-incremented) attempt count through `needsFetch`.
  }, [pubkey, needsFetch, retryNonce]);

  const isLoading = isMissing && isFetching;
  // `needsFetch` covers the pre-effect first render and retry backoffs;
  // `isFetching` covers the in-flight window (needsFetch can flip false the
  // moment attempts are bumped). Settles false once resolved or attempts cap.
  const isResolving = isFetching || needsFetch;

  // Logged in the hook, not per screen: ~30 call sites consume this, and each
  // one re-renders when a kind-0 lands. `source` is the same for all of them, so
  // log-doctor's DATA HOOK UPDATES row is the total churn this one cache
  // inflicts on the app — the number a screen-level probe can never show.
  useQueryResultLogger({
    source: 'useNostrProfileMetadata',
    status: !pubkey
      ? 'idle'
      : optimistic
        ? 'optimistic'
        : isLoading
          ? 'loading'
          : isResolving
            ? 'resolving'
            : metadata
              ? 'ready'
              : 'empty',
    count: metadata ? 1 : 0,
    extra: {
      nameKnown: !!metadata?.name,
      pictureKnown: !!metadata?.picture,
      nip05Known: !!metadata?.nip05,
      isMissing,
    },
  });

  return { metadata, isLoading: !optimistic && isLoading, isResolving: !optimistic && isResolving };
}

/**
 * Parse a raw kind-0 `content` JSON string into the cache's profile shape.
 * Exported so other surfaces (e.g. colada's `resolveRecipientProfile`
 * operation in `features/send/providers/Colada.tsx`) reuse the exact
 * same Zod schema + field-mapping as the hook — keeps `display_name` /
 * `displayName` aliasing and the rest of the metadata interpretation in one
 * place.
 */
export function parseRawMetadata(content: string): Omit<NostrProfileMetadata, 'fetchedAt'> | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const result = Kind0MetadataSchema.safeParse(json);
  if (!result.success) return null;
  const raw = result.data;
  return {
    displayName: raw.display_name ?? raw.displayName,
    name: raw.name,
    picture: raw.picture,
    banner: raw.banner,
    nip05: raw.nip05,
    lud16: raw.lud16,
    website: raw.website,
    about: raw.about,
  };
}

interface UseNostrProfileMetadataManyResult {
  /** Cached metadata for every pubkey we know about. Pubkeys still
   *  loading on first paint are absent from the map — callers can use
   *  `metadata.has(pubkey)` to drive loading skeletons. */
  metadata: ReadonlyMap<string, NostrProfileMetadata>;
  /** True while the initial fetch for any pubkey hasn't returned EOSE. */
  isLoading: boolean;
}

/**
 * SWR over many pubkeys at once. Backed by the same `nostrMetadataCache`
 * as the single-pubkey hook — populating one set of contacts warms the
 * cache for every other surface that consumes them (UserMessagesScreen,
 * UserProfileScreen, the picker, …). One batched kind-0 subscription
 * per render with `authors: missingOrStale` so we don't repeatedly hit
 * relays for entries we already have.
 */
export function useNostrProfileMetadataMany(
  pubkeys: readonly string[]
): UseNostrProfileMetadataManyResult {
  // Read the single owner (entity cache) for this set; the returned Map is
  // referentially stable across renders that don't change these keys' records.
  const records = useProfileRecordsMany(pubkeys);
  const mockMode = useSettingsStore((state) => state.mockMode);

  // Keyed on the pubkey LIST, not the array identity. Callers build this set
  // inline — ContactsScreen unions five sources in its render body — so a fresh
  // array arrives on most renders with identical contents. Depending on it
  // rebuilt this Map every time, and since ~30 surfaces consume it, that one
  // identity change redrew each of their lists: measured on Contacts as 2177
  // row renders for 19 distinct rows, 1443 of them wasted.
  //
  // `records` is already identity-stable across unrelated cache writes
  // (`useProfileRecordsMany` only rebuilds when a REQUESTED record changed), so
  // once the list key is stable too the Map survives.
  const pubkeysKey = useMemo(() => pubkeys.join('\u0000'), [pubkeys]);
  const metadata = useMemo(() => {
    const map = new Map<string, NostrProfileMetadata>();
    for (const [pk, record] of records) {
      const mapped = cachedProfileToMetadata(record);
      if (mapped) map.set(pk, mapped);
    }
    // Only the mock branch reads the list itself; rebuild it from the key so
    // the memo does not have to depend on the caller's array identity.
    if (mockMode)
      for (const pubkey of pubkeysKey ? pubkeysKey.split('\u0000') : []) {
        const fixture = getMockProfileMetadata(pubkey);
        if (fixture) map.set(pubkey, fixture);
      }
    return map;
  }, [records, mockMode, pubkeysKey]);

  // Pubkeys missing or stale in the cache and not attempted within the retry
  // window: a miss is retried after RETRY_ATTEMPT_WINDOW_MS, not never.
  const attempted = useRef<Map<string, number>>(new Map());
  const toFetch = useMemo(() => {
    if (pubkeys.length === 0) return [];
    const now = Date.now();
    const out: string[] = [];
    for (const pk of pubkeys) {
      const attemptedAt = attempted.current.get(pk);
      if (attemptedAt !== undefined && now - attemptedAt < RETRY_ATTEMPT_WINDOW_MS) continue;
      if (mockMode && getMockProfileMetadata(pk)) continue;
      const record = records.get(pk);
      if (!record || now - (record.seenAt ?? 0) > STALE_TTL_MS) out.push(pk);
    }
    return out;
  }, [pubkeys, records, mockMode]);

  const [pendingPubkeys, setPendingPubkeys] = useState<ReadonlySet<string>>(() => new Set());
  const toFetchKey = toFetch.join(',');
  useEffect(() => {
    // Strict Mode may replay this effect before a render recomputes toFetch.
    const now = Date.now();
    const batch = toFetch.filter((pk) => {
      const attemptedAt = attempted.current.get(pk);
      return attemptedAt === undefined || now - attemptedAt >= RETRY_ATTEMPT_WINDOW_MS;
    });
    if (batch.length === 0) return;
    for (const pk of batch) attempted.current.set(pk, now);
    setPendingPubkeys((pending) => new Set([...pending, ...batch]));
    // getProfiles write-throughs into the entity cache; the reactive read above
    // picks up resolved profiles. That update can change toFetch before this
    // request settles, so effect cleanup cannot own the loading flag. Track the
    // pending keys themselves: an old batch never clears a newer batch's work.
    const finish = () => {
      setPendingPubkeys((pending) => {
        const remaining = new Set(pending);
        for (const pk of batch) remaining.delete(pk);
        return remaining;
      });
    };
    const cachedCount = batch.filter((pk) => records.has(pk)).length;
    void fetchProfilesLogged(batch, cachedCount, cachedCount, 'mount').then(finish, finish);
    // `toFetchKey` is the serialized form of `toFetch`; depending on the array
    // itself would refire the fetch on every render that rebuilds it unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toFetchKey]);

  const isLoading =
    pubkeys.some((pk) => pendingPubkeys.has(pk)) ||
    toFetch.some((pk) => !attempted.current.has(pk));

  // The batched form is the one that redraws a whole list: every arriving batch
  // rebuilds `metadata`, so `resolved` climbing toward `asked` one batch at a
  // time is the signal that a list is repainting per batch instead of once.
  // Pair it with the `<List>/row` render.count rollups.
  useQueryResultLogger({
    source: 'useNostrProfileMetadataMany',
    status: isLoading ? 'loading' : 'ready',
    count: metadata.size,
    extra: {
      asked: pubkeys.length,
      resolved: metadata.size,
      missing: pubkeys.length - metadata.size,
      pending: pendingPubkeys.size,
      toFetch: toFetch.length,
    },
  });

  return { metadata, isLoading };
}
