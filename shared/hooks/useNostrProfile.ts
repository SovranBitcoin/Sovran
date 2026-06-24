import { useState, useEffect, useCallback } from 'react';

import type { facade } from '@sovranbitcoin/nagg-ts';

import { fetchNostrProfile, type NostrProfileFull } from '@/shared/lib/apiClient';
import { resolveIdentityName } from '@/shared/lib/identity';
import { npubToPubkey } from '@/shared/lib/nostr/client';
import { tryNpubEncode } from '@/features/feed/components/nostr/feedParse';
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
  const [data, setData] = useState<NostrProfileFull | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refetch builds a fresh AbortController each call; the effect's cleanup
  // signal aborts whichever fetch is in flight when pubkey changes or the
  // component unmounts.
  const fetchProfile = useCallback(
    async (signal?: AbortSignal) => {
      if (!pubkey) {
        setData(null);
        setIsLoading(false);
        return;
      }

      log.debug('feed.profile.fetch.start', { pubkey });
      setIsLoading(true);
      setError(null);

      // nagg's `/nostr/profile` (the score API) is the only source of reputation
      // + top followers, so prefer it WHEN nagg is the active tier. When nagg is
      // disabled in settings — or enabled but unreachable — fall through to the
      // facade's profile-stats surface (Primal `user_profile` → relay floor) so
      // counts/joined/metadata still load and the disable flag is actually honored.
      const naggEnabled = getNostrTierConfig().nagg.enabled;

      if (naggEnabled) {
        const result = await fetchNostrProfile(pubkey, { signal });
        if (signal?.aborted) return;
        if (result.isOk()) {
          log.debug('feed.profile.fetch.success', { pubkey, source: 'nagg' });
          setData(result.value);
          setIsLoading(false);
          return;
        }
        log.warn('feed.profile.fetch.nagg_failed_fallback', { pubkey, error: result.error });
      }

      const stats = await fetchProfileStatsViaFacade(pubkey, { signal });
      if (signal?.aborted) return;
      if (stats) {
        log.debug('feed.profile.fetch.success', { pubkey, source: stats.tier });
        setData(profileFullFromStats(pubkey, stats));
      } else {
        const err = new Error('profile unavailable from all tiers');
        log.warn('feed.profile.fetch.error', { pubkey });
        setError(err);
        setData(null);
      }
      setIsLoading(false);
    },
    [pubkey]
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchProfile(controller.signal);
    return () => controller.abort();
  }, [fetchProfile]);

  const refetch = () => {
    void fetchProfile();
  };

  return { data, isLoading, error, refetch };
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
