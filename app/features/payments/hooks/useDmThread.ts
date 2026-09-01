/**
 * Server-backed message history for one Nostr DM conversation. Pages the shared
 * gift-wrap inbox via `useDmEnvelopePages` and decrypts client-side (reusing
 * `giftWrapCache`). Because the inbox is shared and counterparties are opaque
 * server-side, the whole inbox is paged and messages are filtered to this
 * counterparty after decryption, then deduped by id.
 */
import { useCallback, useRef, useState } from 'react';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { nip04Cache } from '@/shared/lib/nostr/nip04Cache';
import { fetchDmConversation } from '../data/dmEnvelopeClient';
import { decryptDmEnvelopes } from '../data/dmDecryptPipeline';
import type { DmEnvelopePage, DmProtocol } from '../data/dmEnvelopeTypes';
import { useDmEnvelopePages } from './useDmEnvelopePages';

const PAGE_LIMIT = 50;

interface DmThreadMessage {
  id: string;
  content: string;
  senderPubkey: string;
  /** unix seconds */
  createdAt: number;
  isOwn: boolean;
}

export function useDmThread(
  counterparty: string,
  viewerPubkey?: string,
  viewerPrivateKey?: Uint8Array,
  protocol: DmProtocol = 'nip17'
) {
  const [messages, setMessages] = useState<DmThreadMessage[]>([]);

  // The paging cursor walks ALL envelope wrap times (not the decrypted rumor
  // time, which uses a different clock); seenMsgIds dedups the messages
  // actually shown for this counterparty.
  const seenMsgIdsRef = useRef(new Set<string>());

  const onReset = useCallback(() => {
    seenMsgIdsRef.current = new Set();
    setMessages([]);
  }, []);

  const onPage = useCallback(
    (page: DmEnvelopePage) => {
      if (!viewerPubkey || !viewerPrivateKey) return;
      const decrypted = decryptDmEnvelopes(page.envelopes, viewerPubkey, viewerPrivateKey);
      const relevant = decrypted.filter(
        (dm) => dm.counterparty === counterparty && dm.protocol === protocol
      );
      const fresh = relevant.filter((dm) => !seenMsgIdsRef.current.has(dm.id));
      if (fresh.length === 0) return;
      fresh.forEach((dm) => seenMsgIdsRef.current.add(dm.id));
      setMessages((prev) => {
        const merged = [
          ...prev,
          ...fresh.map((dm) => ({
            id: dm.id,
            content: dm.content,
            senderPubkey: dm.senderPubkey,
            createdAt: dm.createdAt,
            isOwn: dm.isOwn,
          })),
        ];
        merged.sort((a, b) => a.createdAt - b.createdAt);
        return merged;
      });
    },
    [counterparty, protocol, viewerPubkey, viewerPrivateKey]
  );

  const hydrate = useCallback(async () => {
    if (!viewerPubkey) return;
    await (protocol === 'nip04'
      ? nip04Cache.hydrate(viewerPubkey)
      : giftWrapCache.cache.hydrate(viewerPubkey));
  }, [protocol, viewerPubkey]);

  const fetchPage = useCallback(
    (args: { until?: number; refresh: boolean; signal?: AbortSignal }) =>
      fetchDmConversation({
        viewer: viewerPubkey ?? '',
        counterparty,
        kinds: protocol === 'nip04' ? [4] : [1059],
        limit: PAGE_LIMIT,
        ...args,
      }),
    [counterparty, protocol, viewerPubkey]
  );

  const { loading, hasMore, loadMore, refresh, error } = useDmEnvelopePages({
    feedKey:
      viewerPubkey && viewerPrivateKey && counterparty
        ? `${viewerPubkey}:${protocol}:${counterparty}`
        : null,
    pageLimit: PAGE_LIMIT,
    hydrate,
    fetchPage,
    onPage,
    onReset,
    failureEvent: 'payment.dm.thread.failed',
  });

  return { messages, loading, hasMore, loadMore, refresh, error };
}
