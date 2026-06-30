/**
 * @fileoverview Person display (name + picture) — relay cache first, nagg fallback
 *
 * `useNostrProfileMetadata` resolves from the shared kind-0 metadata cache
 * (NDK-backed, authoritative). When that comes back empty — no name AND no
 * picture — this hook fires ONE nagg `/nostr/profile` lookup per pubkey per
 * app session and seeds the result into the shared cache via
 * `seedFromSearchResults`, the fill-missing API that stamps entries
 * `fetchedAt: 0` so the next NDK pass still treats server data as a hint,
 * not authority (`setManyProfiles` would mark it relay-fresh and suppress
 * the real kind-0 refresh for 24h).
 *
 * Failed/empty lookups stay marked attempted — nagg is never hammered.
 */

import { useEffect } from 'react';

import { profileToMetadataPartial } from '@/shared/hooks/nostrPersonMapping';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { fetchNostrProfile } from '@/shared/lib/apiClient';
import { seedLowConfidenceProfiles } from '@/shared/lib/nostr/useEntityCache';

/** Pubkeys already looked up (in flight, succeeded, or failed) this session. */
const attempted = new Set<string>();

interface NostrPersonDisplay {
  /** displayName ?? name, trimmed; undefined when unknown (caller falls back to shortPubkey). */
  name: string | undefined;
  picture: string | undefined;
  isLoading: boolean;
}

export function useNostrPersonDisplay(pubkey: string | undefined): NostrPersonDisplay {
  const { metadata, isLoading } = useNostrProfileMetadata(pubkey);

  const name = metadata?.displayName?.trim() || metadata?.name?.trim() || undefined;
  const picture = metadata?.picture;
  const cacheEmpty = name === undefined && (picture === undefined || picture.length === 0);

  useEffect(() => {
    if (pubkey === undefined || isLoading || !cacheEmpty || attempted.has(pubkey)) return;
    attempted.add(pubkey);
    void fetchNostrProfile(pubkey).then((result) => {
      if (result.isErr()) return;
      const partial = profileToMetadataPartial(result.value);
      // Low-confidence (fill-missing, seenAt 0) so a later authoritative kind-0
      // still overrides — preserving the original seedFromSearchResults intent.
      seedLowConfidenceProfiles({
        [pubkey]: {
          ...(partial.displayName || partial.name
            ? { name: partial.displayName ?? partial.name }
            : {}),
          ...(partial.picture ? { picture: partial.picture } : {}),
        },
      });
    });
  }, [pubkey, isLoading, cacheEmpty]);

  return {
    name,
    picture: picture !== undefined && picture.length > 0 ? picture : undefined,
    isLoading,
  };
}
