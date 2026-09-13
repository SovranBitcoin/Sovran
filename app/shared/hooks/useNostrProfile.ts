import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { refreshVertex, isVertexProfileStale } from '@/shared/lib/nostr/vertex/refreshVertex';
import { useState, useEffect, useCallback, useRef } from 'react';

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
  fetchFollowingCountViaFacade,
  fetchProfileStatsViaFacade,
} from '@/shared/lib/nostr/fetchProfiles';
import { log } from '@/shared/lib/logger';

export type TopFollower = NostrProfileFull['topFollowers'][number];

/**
 * Synthesize the screen's `NostrProfileFull` shape from a facade profile-stats
 * result (Primal `user_profile` / relay floor). Reputation (`score`) and
 * `topFollowers` have no Primal/relay equivalent, so they're left empty —
 * counts, joined date, and name/picture map across.
 */
function profileFullFromStats(
  pubkey: string,
  stats: facade.ResolvedProfileStats
): NostrProfileFull {
  const m = stats.metadata;
  return {
    pubkey,
    npub: tryNpubEncode(pubkey),
    rank: 0,
    score: null,
    ...(stats.followersCount !== undefined ? { followers: stats.followersCount } : {}),
    ...(stats.followingCount !== undefined ? { follows: stats.followingCount } : {}),
    created_at: stats.joinedAt ?? null,
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

type ProfileCounts = Pick<NostrProfileFull, 'followers' | 'follows'>;

/** Newer profile data with any count it lacks carried over from the previous
 *  snapshot, so a Vertex-refreshed nagg envelope (no aggregates) cannot erase
 *  counts already completed from Primal or the contact list. */
function keepCounts<T extends ProfileCounts>(next: T, previous: ProfileCounts | null): T {
  return {
    ...next,
    ...(next.followers === undefined && previous?.followers !== undefined
      ? { followers: previous.followers }
      : {}),
    ...(next.follows === undefined && previous?.follows !== undefined
      ? { follows: previous.follows }
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
async function completeCounts(
  pubkey: string,
  profile: ProfileCounts,
  signal: AbortSignal,
  options: { skipStats?: boolean } = {}
): Promise<ProfileCounts> {
  let counts: ProfileCounts = { followers: profile.followers, follows: profile.follows };
  if (countsMissing(counts) && !options.skipStats) {
    const stats = await fetchProfileStatsViaFacade(pubkey, { signal });
    if (signal.aborted) return counts;
    if (stats) {
      counts = keepCounts(
        {
          ...(stats.followersCount !== undefined ? { followers: stats.followersCount } : {}),
          ...(stats.followingCount !== undefined ? { follows: stats.followingCount } : {}),
        },
        counts
      );
      log.debug('feed.profile.counts.from_stats', { pubkey, tier: stats.tier });
    }
  }
  if (counts.follows === undefined) {
    const follows = await fetchFollowingCountViaFacade(pubkey, { signal });
    if (signal.aborted) return counts;
    if (follows !== undefined) {
      counts = { ...counts, follows };
      log.debug('feed.profile.counts.from_contacts', { pubkey, follows });
    }
  }
  if (countsMissing(counts)) log.info('feed.profile.counts.unavailable', { pubkey });
  return counts;
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
  const [state, setState] = useState<{
    pubkey: string | null;
    data: NostrProfileFull | null;
    isLoading: boolean;
    countsLoading: boolean;
    error: Error | null;
  }>(() => ({ pubkey, data: null, isLoading: !!pubkey, countsLoading: false, error: null }));
  const requestRef = useRef<AbortController | null>(null);

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

    log.debug('feed.profile.fetch.start', { pubkey });
    setState((previous) => ({
      pubkey,
      data: previous.pubkey === pubkey ? previous.data : null,
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
    // the count pills stay in their loading state until every source answered.
    const fillCounts = async (profile: ProfileCounts, options?: { skipStats?: boolean }) => {
      if (!countsMissing(profile)) return;
      setState((previous) => ({ ...previous, countsLoading: true }));
      const counts = await completeCounts(pubkey, profile, signal, options);
      if (signal.aborted) return;
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
        log.debug('feed.profile.fetch.success', { pubkey, source: 'nagg' });
        recordDebugTiers([pubkey], 'nagg');
        settle(result.value);
        // nagg without the nostr module answers a valid envelope with no
        // aggregates; the other sources fill the counts in parallel with the
        // reputation refresh.
        const counting = fillCounts(result.value);
        const refreshed = await refreshVertex({
          kind: 'profile',
          target: pubkey,
          stale: refreshReputation && isVertexProfileStale(result.value.vertexFetchedAt),
          ndk,
          signal,
        });
        if (!signal.aborted && refreshed) {
          const parsed = parseNostrProfileFor(pubkey)(refreshed);
          if (parsed.isOk()) settle(parsed.value);
        }
        await counting;
        return;
      }
      log.warn('feed.profile.fetch.nagg_failed_fallback', { pubkey, error: result.error });
    }

    const stats = await fetchProfileStatsViaFacade(pubkey, { signal });
    if (signal.aborted) return;
    let counting: Promise<void> = Promise.resolve();
    if (stats) {
      log.debug('feed.profile.fetch.success', { pubkey, source: stats.tier });
      recordDebugTiers([pubkey], stats.tier);
      const data = profileFullFromStats(pubkey, stats);
      settle(data);
      counting = fillCounts(data, { skipStats: true });
    } else {
      log.warn('feed.profile.fetch.error', { pubkey });
      settle(null, new Error('profile unavailable from all tiers'));
    }
    // A missing nagg profile does not imply that Vertex has no reputation for
    // this identity. Keep fallback content visible while the consent/budget
    // owner attempts the same signed refresh used for stale nagg profiles.
    const refreshed = await refreshVertex({
      kind: 'profile',
      target: pubkey,
      stale: refreshReputation,
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
  }, [pubkey, ndk, refreshReputation]);

  useEffect(() => {
    void fetchProfile();
    return () => requestRef.current?.abort();
  }, [fetchProfile]);

  const refetch = useCallback(() => {
    void fetchProfile();
  }, [fetchProfile]);
  // Hide the previous person's stats on the first render of a new route,
  // before the effect can reset request state.
  const current = state.pubkey === pubkey;
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
