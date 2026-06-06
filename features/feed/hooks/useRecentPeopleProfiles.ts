import { useEffect, useMemo, useState } from 'react';

import { fetchRecentPeopleProfiles } from '@/features/feed/data/recentPeopleProfiles';
import { feedLog } from '@/shared/lib/logger';
import {
  NOSTR_METADATA_STALE_TTL_MS,
  useNostrMetadataCache,
  type NostrProfileMetadata,
} from '@/shared/stores/global/nostrMetadataCache';
import { normalizeRecentPersonPubkey } from '@/shared/stores/profile/recentPeopleStore';

export type RecentPeopleProfileRow = {
  pubkey: string;
  metadata?: NostrProfileMetadata;
  isLoading: boolean;
};

export function useRecentPeopleProfiles(pubkeys: readonly string[]): RecentPeopleProfileRow[] {
  const byPubkey = useNostrMetadataCache((state) => state.byPubkey);
  const setManyProfiles = useNostrMetadataCache((state) => state.setManyProfiles);
  const [loadingKey, setLoadingKey] = useState('');

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

  useEffect(() => {
    if (normalizedPubkeys.length === 0) return;
    const now = Date.now();
    const missingOrStale = normalizedPubkeys.filter((pubkey) => {
      const cached = byPubkey[pubkey];
      return !cached || now - cached.fetchedAt > NOSTR_METADATA_STALE_TTL_MS;
    });
    if (missingOrStale.length === 0) {
      setLoadingKey('');
      return;
    }

    const requestKey = missingOrStale.join(',');
    const controller = new AbortController();
    let active = true;
    setLoadingKey(requestKey);

    void fetchRecentPeopleProfiles(missingOrStale, { signal: controller.signal })
      .then((result) => {
        if (!active || controller.signal.aborted) return;
        if (result.isOk()) {
          setManyProfiles(result.value);
          return;
        }
        feedLog.warn('feed.recent_people_profiles.fetch_failed', { error: result.error });
      })
      .finally(() => {
        if (active) setLoadingKey((current) => (current === requestKey ? '' : current));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [normalizedPubkeys, byPubkey, setManyProfiles]);

  const loadingPubkeys = useMemo(
    () => new Set(loadingKey ? loadingKey.split(',') : []),
    [loadingKey]
  );

  return useMemo(
    () =>
      normalizedPubkeys.map((pubkey) => ({
        pubkey,
        metadata: byPubkey[pubkey],
        isLoading: loadingPubkeys.has(pubkey),
      })),
    [normalizedPubkeys, byPubkey, loadingPubkeys]
  );
}
