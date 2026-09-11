import { useState, useEffect, useCallback, useRef } from 'react';

import type { facade } from 'nostr';

import { fetchNostrProfile, type NostrProfileFull } from '@/shared/lib/apiClient';
import { resolveIdentityName } from '@/shared/lib/identity';
import { npubToPubkey } from '@/shared/lib/nostr/client';
import { tryNpubEncode } from '@/features/feed/components/nostr/feedParse';
import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';
import { getNostrTierConfig } from '@/shared/lib/nostr/nostrTierConfig';
import { fetchProfileStatsViaFacade } from '@/shared/lib/nostr/fetchProfiles';
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
    followers: stats.followersCount ?? 0,
    follows: stats.followingCount ?? 0,
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

interface UseNostrProfileResult {
  data: NostrProfileFull | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useNostrProfile(pubkey: string | null): UseNostrProfileResult {
  const [state, setState] = useState<{
    pubkey: string | null;
    data: NostrProfileFull | null;
    isLoading: boolean;
    error: Error | null;
  }>(() => ({ pubkey, data: null, isLoading: !!pubkey, error: null }));
  const requestRef = useRef<AbortController | null>(null);

  // Initial loads and manual refreshes share cancellation. Starting a newer
  // request, changing profile, or unmounting retires every prior completion.
  const fetchProfile = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const { signal } = controller;
    if (!pubkey) {
      setState({ pubkey, data: null, isLoading: false, error: null });
      return;
    }

    log.debug('feed.profile.fetch.start', { pubkey });
    setState((previous) => ({
      pubkey,
      data: previous.pubkey === pubkey ? previous.data : null,
      isLoading: true,
      error: null,
    }));

    // Only nagg supplies reputation + top followers; honor tier settings and
    // preserve the existing Primal/relay fallback when nagg is unavailable.
    if (getNostrTierConfig().nagg.enabled) {
      const result = await fetchNostrProfile(pubkey, { signal });
      if (signal.aborted) return;
      if (result.isOk()) {
        log.debug('feed.profile.fetch.success', { pubkey, source: 'nagg' });
        recordDebugTiers([pubkey], 'nagg');
        setState({ pubkey, data: result.value, isLoading: false, error: null });
        return;
      }
      log.warn('feed.profile.fetch.nagg_failed_fallback', { pubkey, error: result.error });
    }

    const stats = await fetchProfileStatsViaFacade(pubkey, { signal });
    if (signal.aborted) return;
    if (stats) {
      log.debug('feed.profile.fetch.success', { pubkey, source: stats.tier });
      recordDebugTiers([pubkey], stats.tier);
      setState({
        pubkey,
        data: profileFullFromStats(pubkey, stats),
        isLoading: false,
        error: null,
      });
    } else {
      log.warn('feed.profile.fetch.error', { pubkey });
      setState({
        pubkey,
        data: null,
        isLoading: false,
        error: new Error('profile unavailable from all tiers'),
      });
    }
  }, [pubkey]);

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
