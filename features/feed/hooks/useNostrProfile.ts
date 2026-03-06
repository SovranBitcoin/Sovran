import { useState, useEffect, useCallback } from 'react';

import {
  fetchNostrProfile,
  type NostrProfileResponse,
  type TopFollower,
} from '@/shared/lib/apiClient';

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

  const fetchProfile = useCallback(async () => {
    if (!pubkey) {
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const result = await fetchNostrProfile(pubkey);
    if (result.isOk()) {
      setData(result.value);
    } else {
      setError(result.error);
      setData(null);
    }
    setIsLoading(false);
  }, [pubkey]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return { data, isLoading, error, refetch: fetchProfile };
}

/**
 * Filter top followers that have profile information (name/picture).
 */
export function getFollowersWithProfiles(topFollowers: TopFollower[]): TopFollower[] {
  return topFollowers.filter((f) => f.name || f.displayName || f.picture || f.image);
}

/** Best available display name for a follower, falling back to truncated npub. */
export function getFollowerDisplayName(follower: TopFollower): string {
  return follower.displayName || follower.name || follower.npub.slice(0, 12) + '...';
}

/** Best available picture URL for a follower. */
export function getFollowerPicture(follower: TopFollower): string | undefined {
  return follower.picture || follower.image;
}
