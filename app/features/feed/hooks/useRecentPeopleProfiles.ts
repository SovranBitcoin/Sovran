import { useMemo } from 'react';

import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import type { NostrProfileMetadata } from '@/shared/stores/global/nostrMetadataCache';
import { normalizeRecentPersonPubkey } from '@/shared/stores/profile/recentPeopleStore';

export type RecentPeopleProfileRow = {
  pubkey: string;
  metadata?: NostrProfileMetadata;
  isLoading: boolean;
};

/**
 * Profiles for a list of people, in the order given, one row per distinct
 * pubkey.
 *
 * Reads and fetches through `useNostrProfileMetadataMany`, so a miss falls
 * through the Nostr tiers (Nagg, then Primal, then relays) like every other
 * profile in the app. This used to post to Nagg's GraphQL endpoint directly:
 * when that endpoint went away each lookup failed with a 404 and nothing
 * retried, so a Nut Drop peer kept a blank face unless another screen had
 * already cached them.
 */
export function useRecentPeopleProfiles(pubkeys: readonly string[]): RecentPeopleProfileRow[] {
  const stableInputKey = pubkeys.join(',');
  const normalizedPubkeys = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const pubkey of stableInputKey.split(',')) {
      const normalized = normalizeRecentPersonPubkey(pubkey);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }, [stableInputKey]);

  const { metadata, isLoading } = useNostrProfileMetadataMany(normalizedPubkeys);

  return useMemo(
    () =>
      normalizedPubkeys.map((pubkey) => {
        const profile = metadata.get(pubkey);
        return {
          pubkey,
          metadata: profile,
          // A record can arrive name-only (seeded by a feed or a search) while
          // the fetch that carries the picture is still running. Holding the
          // row until the picture or the fetch lands shows placeholder → face,
          // never a fallback the fetch is about to replace.
          isLoading: isLoading && !profile?.picture,
        };
      }),
    [normalizedPubkeys, metadata, isLoading]
  );
}
