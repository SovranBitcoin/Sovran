/**
 * Opens the composer in "quote" mode for a feed event — the shared entry point
 * behind every Quote action (post cards, the image overlay, etc.) so they all
 * carry the quoted post + author into the composer identically.
 */
import { useCallback } from 'react';

import { useOpenComposer } from '@/features/composer/publish/useComposerActions';
import { tryNeventEncode } from '@/features/feed/components/nostr/feedParse';
import type { FeedEvent, ProfileInfo } from '@/features/feed/components/nostr/feedTypes';

export function useQuotePost(): (event: FeedEvent, profile?: ProfileInfo) => void {
  const openComposer = useOpenComposer();
  return useCallback(
    (event, profile) => {
      const nevent = tryNeventEncode(event.id, event.pubkey, event.kind);
      openComposer(
        {
          mode: 'quote',
          quotedId: event.id,
          quotedPubkey: event.pubkey,
          quotedNevent: nevent || undefined,
        },
        // Carry the quoted post + its author so the composer renders it under the
        // input, the same way reply mode renders the post being replied to.
        { parentEvent: event, parentProfile: profile }
      );
    },
    [openComposer]
  );
}
