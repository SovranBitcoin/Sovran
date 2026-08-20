/**
 * Fetches Nostr profile data (followers, reputation) for mint operators.
 *
 * Extracts the Nostr pubkey from each mint's NUT-06 contact info, then calls
 * the Sovran API to get follower count and reputation score. Results are
 * cached in the mint-metadata store so enrichment callbacks can read them
 * synchronously.
 */

import { useEffect, useRef } from 'react';
import { fetchNostrProfile } from '@/shared/lib/apiClient';
import {
  extractMintNostrPubkey,
  type MintInfoForNostr,
} from '@/shared/lib/nostr/extractMintNostrPubkey';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { cashuLog, mintUrlLogFields } from '@/shared/lib/logger';

interface MintWithInfo {
  url: string;
  mintInfo?: MintInfoForNostr;
}

/**
 * For a list of mints with their NUT-06 info, fetch Nostr profiles for any
 * mint operator that has a Nostr pubkey in their contacts. Populates
 * the mint-metadata store so the data is available to enrichment callbacks.
 */
export function useMintProfiles(mints: MintWithInfo[]): void {
  const inflightRef = useRef(new Set<string>());

  useEffect(() => {
    const { isStale } = useMintMetadataStore.getState();
    const controller = new AbortController();
    for (const mint of mints) {
      const pubkey = extractMintNostrPubkey(mint.mintInfo);
      if (!pubkey) continue;

      const key = normalizeMintUrlKey(mint.url);
      if (!isStale(key, 'social') || inflightRef.current.has(key)) continue;

      inflightRef.current.add(key);
      fetchNostrProfile(pubkey, { signal: controller.signal }).then(
        (result) => {
          inflightRef.current.delete(key);
          if (controller.signal.aborted) return;
          if (result.isOk()) {
            const { followers, score } = result.value;
            cashuLog.debug('mint.profile.resolved', {
              ...mintUrlLogFields(key),
              pubkeyLength: pubkey.length,
              followers,
              reputation: typeof score === 'number' ? Math.round(score) : null,
            });
            useMintMetadataStore.getState().setSocial(mint.url, followers, score);
          }
        },
        () => {
          inflightRef.current.delete(key);
        }
      );
    }
    return () => controller.abort();
  }, [mints]);
}
