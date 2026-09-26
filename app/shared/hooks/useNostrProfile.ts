import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { refreshVertex, isVertexProfileStale } from '@/shared/lib/nostr/vertex/refreshVertex';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { readEvents, readKeyHash, newReadId, readErrorType } from '@/shared/lib/read/readLog';

import { aggregateValue, type facade } from 'nostr';

import {
  fetchNostrProfile,
  parseNostrProfileFor,
  type NostrProfileFull,
} from '@/shared/lib/apiClient';
import { resolveIdentityName } from '@/shared/lib/identity';
import { npubToPubkey } from '@/shared/lib/nostr/client';
import { tryNpubEncode } from '@/features/feed/components/nostr/feedParse';
import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';
import { getNostrTierConfig } from '@/shared/lib/nostr/nostrTierConfig';
import {
  cacheProfileStats,
  fetchFollowingCountViaFacade,
  fetchProfileStatsViaFacade,
  readCachedProfileStats,
} from '@/shared/lib/nostr/fetchProfiles';
import { log, useQueryResultLogger } from '@/shared/lib/logger';

export type TopFollower = NostrProfileFull['topFollowers'][number];

/**
 * Synthesize the screen's `NostrProfileFull` shape from a facade profile-stats
 * result (Primal `user_profile` / relay floor / the cache). Reputation comes
 * only from the cache — a nagg search hit, discovery row or an earlier open of
 * this profile wrote it there — so a score seen anywhere paints on the first
 * frame here. `topFollowers` has no equivalent and stays empty.
 */
function profileFullFromStats(
  pubkey: string,
  stats: facade.ResolvedProfileStats
): NostrProfileFull {
  const m = stats.metadata;
  return {
    pubkey,
    npub: tryNpubEncode(pubkey),
    rank: stats.rank ?? 0,
    score: stats.score ?? null,
    ...(stats.vertexFetchedAt !== undefined ? { vertexFetchedAt: stats.vertexFetchedAt } : {}),
    ...(stats.followersCount !== undefined ? { followers: stats.followersCount } : {}),
    ...(stats.followingCount !== undefined ? { follows: stats.followingCount } : {}),
    created_at: stats.joinedAtSec ?? null,
    topFollowers: [],
    fromCache: false,
    ...(m?.name ? { name: m.name } : {}),
    ...(m?.displayName ? { displayName: m.displayName } : {}),
    ...(m?.picture ? { picture: m.picture } : {}),
    ...(m?.banner ? { banner: m.banner } : {}),
    ...(m?.about ? { about: m.about } : {}),
    ...(m?.nip05 ? { nip05: m.nip05 } : {}),
    ...(m?.website ? { website: m.website } : {}),
    ...(m?.lud16 ? { lud16: m.lud16 } : {}),
  };
}

type ProfileCounts = Pick<NostrProfileFull, 'followers' | 'follows'> &
  Partial<Pick<NostrProfileFull, 'score'>>;

/** Newer profile data with any count it lacks carried over from the previous
 *  snapshot, so a Vertex-refreshed nagg envelope (no aggregates) cannot erase
 *  counts already completed from Primal or the contact list — and, the other
 *  way round, an answer without a score cannot erase one already shown. */
function keepCounts<T extends ProfileCounts>(next: T, previous: ProfileCounts | null): T {
  return {
    ...next,
    ...(next.followers === undefined && previous?.followers !== undefined
      ? { followers: previous.followers }
      : {}),
    ...(next.follows === undefined && previous?.follows !== undefined
      ? { follows: previous.follows }
      : {}),
    ...(typeof next.score !== 'number' && typeof previous?.score === 'number'
      ? { score: previous.score }
      : {}),
  };
}

function countsMissing(profile: ProfileCounts): boolean {
  return profile.followers === undefined || profile.follows === undefined;
}

/**
 * Fill the counts nagg did not have from the other sources, in order: Primal
 * `user_profile` (followers + following) → the profile's own kind-3 off the
 * relays (following only; followers need a reverse index relays lack). The
 * counts a source cannot supply stay undefined — never 0 — so the header shows
 * a placeholder instead of a wrong number.
 */
/**
 * Fill the counts nagg did not have from the other sources CONCURRENTLY —
 * Primal `user_profile` (followers + following) and the profile's own kind-3
 * (following) — applying each as it lands through `onCounts`, so the pills
 * fill one at a time instead of waiting for the slowest source. Resolves once
 * every source settled; a count no source could supply stays `undefined`.
 */
async function completeCounts(
  pubkey: string,
  profile: ProfileCounts,
  signal: AbortSignal,
  readId: string,
  onCounts: (counts: ProfileCounts, source: 'primal' | 'relay' | 'nagg' | 'contacts') => void,
  options: { skipStats?: boolean } = {}
): Promise<ProfileCounts> {
  let counts: ProfileCounts = { followers: profile.followers, follows: profile.follows };
  const keyHash = readKeyHash(pubkey);
  const apply = (next: ProfileCounts, source: 'primal' | 'relay' | 'nagg' | 'contacts') => {
    counts = keepCounts(next, counts);
    readEvents.partial({
      readId,
      surface: 'profileStats',
      keyHash,
      answered: [source],
      pending: [],
      count: (counts.followers !== undefined ? 1 : 0) + (counts.follows !== undefined ? 1 : 0),
      gate: 'partial',
    });
    onCounts(counts, source);
  };
  const tasks: Promise<void>[] = [];
  if (countsMissing(counts) && !options.skipStats) {
    // `refresh`: the nagg answer was just written to the entity cache WITHOUT
    // the missing count (nagg omits zero-valued aggregates, and has no
    // follower count for pubkeys outside its kind-3 corpus). Cache-first would
    // hand that same header straight back and Primal would never be asked.
    tasks.push(
      Promise.resolve(fetchProfileStatsViaFacade(pubkey, { signal, readId, refresh: true })).then(
        (stats) => {
          if (signal.aborted || !stats) return;
          apply(
            {
              ...(stats.followersCount !== undefined ? { followers: stats.followersCount } : {}),
              ...(stats.followingCount !== undefined ? { follows: stats.followingCount } : {}),
            },
            stats.tier === 'primal' || stats.tier === 'nagg' ? stats.tier : 'relay'
          );
        }
      )
    );
  }
  if (counts.follows === undefined) {
    tasks.push(
      Promise.resolve(fetchFollowingCountViaFacade(pubkey, { signal, readId })).then((follows) => {
        if (signal.aborted || follows === undefined) return;
        apply({ follows }, 'contacts');
      })
    );
  }
  await Promise.all(tasks);
  if (!signal.aborted && countsMissing(counts)) {
    log.info('feed.profile.counts.unavailable', { pubkey: readKeyHash(pubkey) });
  }
  return counts;
}

/** Seed the header from the single owner (a previous open, a feed page, or a nagg REST answer). */
function seedFromCache(pubkey: string | null): NostrProfileFull | null {
  if (!pubkey) return null;
  const stats = readCachedProfileStats(pubkey);
  if (!stats) return null;
  return profileFullFromStats(pubkey, { tier: 'cache', ...stats });
}

interface UseNostrProfileResult {
  data: NostrProfileFull | null;
  isLoading: boolean;
  /** True while follower/following counts are still being completed from
   *  fallback sources after the profile itself has rendered. */
  isCountsLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useNostrProfile(
  pubkey: string | null,
  refreshReputation = false
): UseNostrProfileResult {
  const { ndk } = useNDK();
  // Seeded from the single owner so a known profile paints its counts on the
  // first frame (status: revalidating); an unknown one starts with skeletons.
  const [state, setState] = useState<{
    pubkey: string | null;
    data: NostrProfileFull | null;
    isLoading: boolean;
    countsLoading: boolean;
    error: Error | null;
  }>(() => ({
    pubkey,
    data: seedFromCache(pubkey),
    isLoading: !!pubkey,
    countsLoading: false,
    error: null,
  }));
  const requestRef = useRef<AbortController | null>(null);
  // Focus is an input to the Vertex refresh only — never a reason to re-run
  // the whole ladder (a focus/blur cycle used to refetch everything).
  const refreshReputationRef = useLatestRef(refreshReputation);
  const dataRef = useLatestRef(state.pubkey === pubkey ? state.data : null);

  // Initial loads and manual refreshes share cancellation. Starting a newer
  // request, changing profile, or unmounting retires every prior completion.
  const fetchProfile = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const { signal } = controller;
    if (!pubkey) {
      setState({ pubkey, data: null, isLoading: false, countsLoading: false, error: null });
      return;
    }

    const readId = newReadId('profile');
    const keyHash = readKeyHash(pubkey);
    const t0 = Date.now();
    const seeded = seedFromCache(pubkey);
    readEvents.request({
      readId,
      surface: 'profile',
      keyHash,
      mode: 'initial',
      trigger: 'mount',
      action: seeded ? 'serve-stale-revalidate' : 'fetch',
      strategy: 'aggregate',
      cached: !!seeded,
      stale: !!seeded,
      coldStart: !seeded,
      gen: 0,
    });
    const done = (source: 'nagg' | 'primal' | 'relay' | 'cache', degraded: boolean) =>
      readEvents.done({
        readId,
        surface: 'profile',
        keyHash,
        gen: 0,
        durationMs: Date.now() - t0,
        source: 'network',
        tier: source,
        count: 1,
        empty: false,
        degraded,
        complete: true,
      });
    setState((previous) => ({
      pubkey,
      data: previous.pubkey === pubkey ? previous.data : seeded,
      isLoading: true,
      countsLoading: false,
      error: null,
    }));
    const settle = (data: NostrProfileFull | null, error: Error | null = null) =>
      setState((previous) => ({
        pubkey,
        data: data ? keepCounts(data, previous.pubkey === pubkey ? previous.data : null) : null,
        isLoading: false,
        countsLoading: previous.pubkey === pubkey ? previous.countsLoading : false,
        error,
      }));
    // Runs after the profile has painted: the header keeps its content while
    // each count pill fills as its source lands; the pills' loading state ends
    // once every source answered.
    const fillCounts = async (profile: ProfileCounts, options?: { skipStats?: boolean }) => {
      if (!countsMissing(profile)) return;
      setState((previous) => ({ ...previous, countsLoading: true }));
      const counts = await completeCounts(
        pubkey,
        profile,
        signal,
        readId,
        (partial) => {
          if (signal.aborted) return;
          setState((previous) => ({
            ...previous,
            data: previous.data ? keepCounts(previous.data, partial) : previous.data,
          }));
        },
        options
      );
      if (signal.aborted) return;
      cacheProfileStats(pubkey, counts);
      setState((previous) => ({
        ...previous,
        countsLoading: false,
        data: previous.data ? keepCounts(previous.data, counts) : previous.data,
      }));
    };

    // Only nagg supplies reputation + top followers; honor tier settings and
    // preserve the existing Primal/relay fallback when nagg is unavailable.
    if (getNostrTierConfig().nagg.enabled) {
      const result = await fetchNostrProfile(pubkey, { signal });
      if (signal.aborted) return;
      if (result.isOk()) {
        recordDebugTiers([pubkey], 'nagg');
        settle(result.value);
        done('nagg', false);
        // The single owner learns the header so the next open seeds it.
        cacheProfileStats(pubkey, {
          followers: result.value.followers,
          follows: result.value.follows,
          joinedAtSec: result.value.created_at,
          score: result.value.score,
          rank: result.value.rank,
          vertexFetchedAt: result.value.vertexFetchedAt,
        });
        // nagg without the nostr module answers a valid envelope with no
        // aggregates; the other sources fill the counts in parallel with the
        // reputation refresh.
        const counting = fillCounts(result.value);
        const refreshed = await refreshVertex({
          kind: 'profile',
          target: pubkey,
          stale: refreshReputationRef.current && isVertexProfileStale(result.value.vertexFetchedAt),
          ndk,
          signal,
        });
        if (!signal.aborted && refreshed) {
          const parsed = parseNostrProfileFor(pubkey)(refreshed);
          if (parsed.isOk()) {
            settle(parsed.value);
            cacheProfileStats(pubkey, {
              score: parsed.value.score,
              rank: parsed.value.rank,
              vertexFetchedAt: parsed.value.vertexFetchedAt,
            });
          }
        }
        await counting;
        return;
      }
      log.warn('feed.profile.fetch.nagg_failed_fallback', {
        readId,
        pubkey: keyHash,
        errorType: readErrorType(result.error),
      });
    }

    const stats = await fetchProfileStatsViaFacade(pubkey, { signal, readId });
    if (signal.aborted) return;
    let counting: Promise<void> = Promise.resolve();
    if (stats) {
      recordDebugTiers([pubkey], stats.tier);
      const data = profileFullFromStats(pubkey, stats);
      settle(data);
      done(stats.tier === 'cache' ? 'cache' : stats.tier, !!stats.provenance?.degraded);
      counting = fillCounts(data, { skipStats: true });
    } else {
      readEvents.failed({
        readId,
        surface: 'profile',
        keyHash,
        gen: 0,
        durationMs: Date.now() - t0,
        errorType: 'all_tiers_exhausted',
        retained: !!seeded,
      });
      // Keep a seeded header on screen; only an unknown profile is an error.
      if (seeded) settle(seeded);
      else settle(null, new Error('profile unavailable from all tiers'));
    }
    // A missing nagg profile does not imply that Vertex has no reputation for
    // this identity. Keep fallback content visible while the consent/budget
    // owner attempts the same signed refresh used for stale nagg profiles.
    const refreshed = await refreshVertex({
      kind: 'profile',
      target: pubkey,
      stale: refreshReputationRef.current,
      ndk,
      signal,
    });
    if (!signal.aborted && refreshed) {
      const parsed = parseNostrProfileFor(pubkey)(refreshed);
      if (parsed.isOk()) {
        setState((previous) => {
          const known = previous.pubkey === pubkey ? previous.data : null;
          const followers =
            aggregateValue(refreshed.aggregates, pubkey, 'followers') ??
            known?.followers ??
            parsed.value.followers;
          const follows =
            aggregateValue(refreshed.aggregates, pubkey, 'following') ??
            known?.follows ??
            parsed.value.follows;
          return {
            pubkey,
            data: {
              ...known,
              ...parsed.value,
              ...(followers !== undefined ? { followers } : {}),
              ...(follows !== undefined ? { follows } : {}),
              created_at: parsed.value.created_at ?? known?.created_at ?? null,
            },
            isLoading: false,
            countsLoading: known ? previous.countsLoading : false,
            error: null,
          };
        });
      }
    }
    await counting;
  }, [pubkey, ndk, refreshReputationRef]);

  useEffect(() => {
    void fetchProfile();
    return () => requestRef.current?.abort();
  }, [fetchProfile]);

  // Focus regained: refresh reputation only (and only when stale) — the header
  // keeps everything it has; no ladder re-run, no request when fresh.
  useEffect(() => {
    if (!refreshReputation || !pubkey) return;
    const data = dataRef.current;
    if (!data || !isVertexProfileStale(data.vertexFetchedAt)) return;
    if (!getNostrTierConfig().nagg.enabled) return;
    const controller = new AbortController();
    void refreshVertex({
      kind: 'profile',
      target: pubkey,
      stale: true,
      ndk,
      signal: controller.signal,
    }).then((refreshed) => {
      if (controller.signal.aborted || !refreshed) return;
      const parsed = parseNostrProfileFor(pubkey)(refreshed);
      if (!parsed.isOk()) return;
      setState((previous) =>
        previous.pubkey === pubkey && previous.data
          ? { ...previous, data: keepCounts(parsed.value, previous.data) }
          : previous
      );
    });
    return () => controller.abort();
    // Runs when focus is gained (refreshReputation flips true) for this pubkey.
  }, [refreshReputation, pubkey, ndk, dataRef]);

  const refetch = useCallback(() => {
    void fetchProfile();
  }, [fetchProfile]);
  // Hide the previous person's stats on the first render of a new route,
  // before the effect can reset request state.
  const current = state.pubkey === pubkey;

  // Logged HERE rather than per screen, because this hook feeds four surfaces
  // (profile, mint info, the drawer chrome, the API client's profile path) and
  // it lands in TWO stages: the kind-0 metadata, then the counts. Every consumer
  // therefore re-renders at least twice per profile, and a screen-level probe
  // can only see its own share of that.
  // `followers` / `follows` are the second stage: the kind-0 metadata lands
  // first, these arrive from the profile API (or kind-3) afterwards.
  const countsKnown =
    current &&
    state.data !== null &&
    state.data.followers !== undefined &&
    state.data.follows !== undefined;
  useQueryResultLogger({
    source: 'useNostrProfile',
    status: !pubkey
      ? 'idle'
      : !current
        ? 'switching'
        : state.isLoading
          ? 'loading'
          : state.error
            ? 'error'
            : state.countsLoading
              ? 'counts-loading'
              : 'ready',
    // The profile is one item; `count` carries the follower list instead, which
    // is the part that grows after first paint.
    count: current ? (state.data?.topFollowers?.length ?? 0) : 0,
    extra: {
      metadataKnown: current && !!state.data,
      countsKnown,
      reputationRequested: refreshReputation,
      // A `pubkey` change with the old person's data still in state is the
      // profile-switch flash; `switching` above names it.
      keyChanged: !current,
    },
  });

  return {
    data: current ? state.data : null,
    isLoading: current ? state.isLoading : !!pubkey,
    isCountsLoading: current ? state.countsLoading : false,
    error: current ? state.error : null,
    refetch,
  };
}

/**
 * Filter top followers that have profile information (name/picture).
 */
export function getFollowersWithProfiles(topFollowers: TopFollower[]): TopFollower[] {
  return topFollowers.filter((f) => f.name || f.displayName || f.picture || f.image);
}

/** Best available display name for a follower. Hierarchy matches the rest
 *  of the app: nostr metadata → deterministic word pair seeded by hex
 *  pubkey (decoded from the npub). */
export function getFollowerDisplayName(follower: TopFollower): string {
  return resolveIdentityName({
    pubkey: npubToPubkey(follower.npub) || follower.npub,
    nostrProfile: { displayName: follower.displayName, name: follower.name },
  });
}

/** Best available picture URL for a follower. */
export function getFollowerPicture(follower: TopFollower): string | undefined {
  return follower.picture || follower.image;
}
