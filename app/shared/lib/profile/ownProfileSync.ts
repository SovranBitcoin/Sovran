/**
 * Own-account profile sync. On launch (non-blocking) this refreshes each of the
 * user's OWN accounts — kind-0 metadata plus follower/following counts — via the
 * existing `/nostr/profile` app-view endpoint, and writes them into the shared
 * caches so the drawer, account switcher, and profile header stay fresh.
 *
 * Scope is deliberately the user's own accounts only (profileStore.profiles),
 * NOT the follow graph.
 */
import { fetchNostrProfile } from '@/shared/lib/apiClient';
import { log } from '@/shared/lib/logger';
import { ownProfileStatsCache } from '@/shared/lib/profile/ownProfileStatsStore';
import { ingestResolvedProfiles } from '@/shared/lib/nostr/useEntityCache';
import { useProfileStore } from '@/shared/stores/global/profileStore';

export async function syncOwnProfiles(signal?: AbortSignal): Promise<void> {
  const profiles = useProfileStore.getState().profiles;
  if (profiles.length === 0) return;

  const metadataEntries: Record<string, { displayName?: string; name?: string; picture?: string }> =
    {};
  let synced = 0;

  await Promise.all(
    profiles.map(async (profile) => {
      if (signal?.aborted) return;
      const result = await fetchNostrProfile(profile.pubkey, { signal });
      if (result.isErr()) {
        log.debug('own_profile_sync.account_failed', {
          pubkeyPreview: profile.pubkey.slice(0, 12),
          error: result.error.message,
        });
        return;
      }
      const remote = result.value;
      synced += 1;

      const displayName = remote.displayName ?? remote.name ?? undefined;
      const picture = remote.picture ?? undefined;
      metadataEntries[profile.pubkey] = { displayName, name: remote.name ?? undefined, picture };

      // Keep the account switcher's cached label/picture fresh.
      useProfileStore.getState().updateProfileMetadata(profile.accountIndex, displayName, picture);

      // Cache follower/following counts for the profile header.
      if (typeof remote.followers === 'number' && typeof remote.follows === 'number') {
        ownProfileStatsCache.setEntry(
          profile.pubkey,
          { followers: remote.followers, follows: remote.follows },
          { viewerKey: '' }
        );
      }
    })
  );

  if (Object.keys(metadataEntries).length > 0) {
    ingestResolvedProfiles(metadataEntries);
  }
  log.info('own_profile_sync.done', { accounts: profiles.length, synced });
}
