/**
 * @fileoverview Nostr Profile API Hook
 *
 * Fetches profile data from Sovran API including:
 * - Follower/following counts
 * - Top followers with optional profile info
 * - Rank metrics
 */

import { useState, useEffect, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface TopFollower {
  pubkey: string;
  npub: string;
  rank: number;
  // Optional profile info (sometimes included)
  name?: string;
  displayName?: string;
  picture?: string;
  image?: string;
  banner?: string;
  about?: string;
  nip05?: string;
  nip05Valid?: boolean;
  website?: string;
  lud16?: string;
}

export interface NostrProfileResponse {
  pubkey: string;
  npub: string;
  rank: number;
  followers: number;
  follows: number;
  score: number;
  topFollowers: TopFollower[];
  created_at: number;
  fromCache: boolean;
  // Optional mint URL if this profile is associated with a mint
  mintUrl?: string;
}

interface UseNostrProfileResult {
  data: NostrProfileResponse | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const API_BASE_URL = 'https://api.sovran.money/api/nostr/profile';

// ============================================================================
// Hook
// ============================================================================

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

    try {
      const response = await fetch(`${API_BASE_URL}?pubkey=${pubkey}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch profile: ${response.status}`);
      }

      const profileData: NostrProfileResponse = await response.json();
      setData(profileData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [pubkey]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchProfile,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Filter top followers that have profile information (name/picture)
 */
export function getFollowersWithProfiles(topFollowers: TopFollower[]): TopFollower[] {
  return topFollowers.filter(
    (follower) => follower.name || follower.displayName || follower.picture || follower.image
  );
}

/**
 * Get display name for a top follower
 */
export function getFollowerDisplayName(follower: TopFollower): string {
  return follower.displayName || follower.name || follower.npub.slice(0, 12) + '...';
}

/**
 * Get picture URL for a top follower
 */
export function getFollowerPicture(follower: TopFollower): string | undefined {
  return follower.picture || follower.image;
}
