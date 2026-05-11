import { useState, useEffect, useCallback } from 'react';

import { fetchNostrProfile, type NostrProfileResponse } from '@/shared/lib/apiClient';
import type { TopFollower } from '@sovranbitcoin/schemas';
import { resolveIdentityName } from '@/shared/lib/identity';
import { npubToPubkey } from '@/shared/lib/nostr/client';
import { log } from '@/shared/lib/logger';

export type { TopFollower };

interface UseNostrProfileResult {
  data: NostrProfileResponse | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useNostrProfile(pubkey: string | null): UseNostrProfileResult {
  const [data, setData] = useState<NostrProfileResponse | null>(null);
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

      const result = await fetchNostrProfile(pubkey, { signal });
      if (signal?.aborted) return;
      if (result.isOk()) {
        log.debug('feed.profile.fetch.success', { pubkey, hasData: !!result.value });
        setData(result.value);
      } else {
        log.warn('feed.profile.fetch.error', { pubkey, error: result.error });
        setError(result.error);
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

  const refetch = useCallback(() => {
    void fetchProfile();
  }, [fetchProfile]);

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
