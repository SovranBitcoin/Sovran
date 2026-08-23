/**
 * Server-backed Nostr DM conversation list. Fetches gift-wrap envelopes from nagg
 * (paginated by `useDmEnvelopePages`), decrypts them client-side (reusing the
 * proven `giftWrapCache` path), and buckets them per counterparty (latest
 * message wins).
 */
import { useCallback, useRef, useState } from 'react';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { nip04Cache } from '@/shared/lib/nostr/nip04Cache';
import { fetchDmEnvelopes, type DmEnvelopePage } from '../data/dmEnvelopeClient';
import { decryptDmEnvelopes, type DmProtocol } from '../data/dmDecryptPipeline';
import { useDmEnvelopePages } from './useDmEnvelopePages';

/** Fetched DM kinds: NIP-04 (kind 4) + NIP-17 gift wraps (kind 1059). */
const DM_KINDS = [4, 1059];

export interface DmConversation {
  counterparty: string;
  lastMessagePreview: string;
  /** unix seconds */
  lastMessageAt: number;
  /** Protocol of the most recent message with this counterparty. */
  protocol: DmProtocol;
  /** Event id of the newest message (gift-wrap id for NIP-17, kind-4 id for
   *  NIP-04) — the key the dev-only source badge resolves its tier by. */
  newestMessageId: string;
}

const PAGE_LIMIT = 100;

export function useDmConversations(viewerPubkey?: string, viewerPrivateKey?: Uint8Array) {
  const [conversations, setConversations] = useState<DmConversation[]>([]);

  // Accumulator persists across pages so cross-page bucketing keeps "latest wins".
  const bucketRef = useRef(new Map<string, DmConversation>());

  const onReset = useCallback(() => {
    bucketRef.current = new Map();
    setConversations([]);
  }, []);

  const onPage = useCallback(
    (page: DmEnvelopePage) => {
      if (!viewerPubkey || !viewerPrivateKey) return;
      const decrypted = decryptDmEnvelopes(page.envelopes, viewerPubkey, viewerPrivateKey);
      for (const dm of decrypted) {
        // One conversation per counterparty across protocols; the most recent
        // message wins (and sets the displayed protocol). Per-protocol threads
        // are opened from the profile's send-message picker.
        const existing = bucketRef.current.get(dm.counterparty);
        if (!existing || dm.createdAt > existing.lastMessageAt) {
          bucketRef.current.set(dm.counterparty, {
            counterparty: dm.counterparty,
            lastMessagePreview: dm.content,
            lastMessageAt: dm.createdAt,
            protocol: dm.protocol,
            newestMessageId: dm.id,
          });
        }
      }
      setConversations(
        [...bucketRef.current.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      );
    },
    [viewerPubkey, viewerPrivateKey]
  );

  const hydrate = useCallback(async () => {
    if (!viewerPubkey) return;
    await Promise.all([
      giftWrapCache.cache.hydrate(viewerPubkey),
      nip04Cache.hydrate(viewerPubkey),
    ]);
  }, [viewerPubkey]);

  const fetchPage = useCallback(
    (args: { until?: number; refresh: boolean; signal?: AbortSignal }) =>
      fetchDmEnvelopes({
        viewer: viewerPubkey ?? '',
        kinds: DM_KINDS,
        limit: PAGE_LIMIT,
        ...args,
      }),
    [viewerPubkey]
  );

  const { loading, hasLoadedOnce, hasMore, loadMore, refresh, error } = useDmEnvelopePages({
    feedKey: viewerPubkey && viewerPrivateKey ? viewerPubkey : null,
    pageLimit: PAGE_LIMIT,
    hydrate,
    fetchPage,
    onPage,
    onReset,
    failureEvent: 'payment.dm.conversations.failed',
  });

  return { conversations, loading, hasLoadedOnce, hasMore, loadMore, refresh, error };
}
