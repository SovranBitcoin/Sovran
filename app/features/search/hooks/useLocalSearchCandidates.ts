/**
 * @fileoverview Everything Tier-0 search can match without the network.
 *
 * People: everyone the person has paid, been paid by, looked up or stood near
 * (`useQuickPayPeople`, the same merge Send's recents show), then everyone
 * they follow, named from the profile cache. Only cached profiles are read:
 * matching a follow list never fetches thousands of kind-0s.
 *
 * Mints: the active account's mints, named from the mint metadata cache.
 */
import { useMemo } from 'react';
import { accountMintUrls } from 'wallet';

import { ownEntry } from '@/shared/lib/ownEntry';
import { useQuickPayPeople } from '@/features/send/hooks/useQuickPayPeople';
import { useProfileRecordsMany } from '@/shared/lib/nostr/useEntityCache';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useWalletContext } from '@/runtime/WalletProjection';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import type { LocalMintCandidate, LocalPersonCandidate } from '../lib/localSearch';

export function useLocalSearchCandidates(): {
  people: LocalPersonCandidate[];
  mints: LocalMintCandidate[];
} {
  const recents = useQuickPayPeople();
  const followingPubkeys = useNostrSocialStore((state) => state.followingPubkeys);
  const following = useMemo(() => Object.keys(followingPubkeys), [followingPubkeys]);
  const followedProfiles = useProfileRecordsMany(following);

  const people = useMemo<LocalPersonCandidate[]>(() => {
    const rows: LocalPersonCandidate[] = recents.map((person) => ({
      pubkey: person.pubkey,
      source: 'recent',
      displayName: person.displayName,
      nip05: person.nip05,
      lud16: person.lud16,
      picture: person.picture,
    }));
    for (const pubkey of following) {
      const profile = followedProfiles.get(pubkey);
      // A follow with no cached name has nothing to match on yet.
      if (!profile) continue;
      rows.push({
        pubkey,
        source: 'following',
        displayName: profile.displayName,
        name: profile.name,
        nip05: profile.nip05,
        lud16: profile.lud16,
        picture: profile.picture,
      });
    }
    return rows;
  }, [recents, following, followedProfiles]);

  const walletContext = useWalletContext();
  const byMintUrl = useMintMetadataStore((state) => state.byMintUrl);
  const mints = useMemo<LocalMintCandidate[]>(
    () =>
      accountMintUrls(walletContext).map((mintUrl) => {
        const entry = ownEntry(byMintUrl, normalizeMintUrlKey(mintUrl));
        return {
          mintUrl,
          displayName: entry?.displayName ?? null,
          iconUrl: entry?.iconUrl ?? null,
        };
      }),
    [walletContext, byMintUrl]
  );

  return { people, mints };
}
