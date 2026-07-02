import { useEffect, useMemo, useState } from 'react';

import { fetchRecentPeopleProfiles } from '@/features/feed/data/recentPeopleProfiles';
import { feedLog } from '@/shared/lib/logger';
import {
  NOSTR_METADATA_STALE_TTL_MS,
  cachedProfileToMetadata,
  type NostrProfileMetadata,
} from '@/shared/stores/global/nostrMetadataCache';
import { ingestResolvedProfiles, useProfileRecordsMany } from '@/shared/lib/nostr/useEntityCache';
import { normalizeRecentPersonPubkey } from '@/shared/stores/profile/recentPeopleStore';

export type RecentPeopleProfileRow = {
  pubkey: string;
  metadata?: NostrProfileMetadata;
  isLoading: boolean;
};

export function useRecentPeopleProfiles(pubkeys: readonly string[]): RecentPeopleProfileRow[] {
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

  // Read the single owner (entity cache) for this set.
  const records = useProfileRecordsMany(normalizedPubkeys);

  useEffect(() => {
    if (normalizedPubkeys.length === 0) return;
    const now = Date.now();
    const missingOrStale = normalizedPubkeys.filter((pubkey) => {
      const record = records.get(pubkey);
      return !record || now - (record.seenAt ?? 0) > NOSTR_METADATA_STALE_TTL_MS;
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
          ingestResolvedProfiles(result.value);
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
  }, [normalizedPubkeys, records]);

  const loadingPubkeys = useMemo(
    () => new Set(loadingKey ? loadingKey.split(',') : []),
    [loadingKey]
  );

  return useMemo(
    () =>
      normalizedPubkeys.map((pubkey) => ({
        pubkey,
        metadata: cachedProfileToMetadata(records.get(pubkey)),
        isLoading: loadingPubkeys.has(pubkey),
      })),
    [normalizedPubkeys, records, loadingPubkeys]
  );
}
