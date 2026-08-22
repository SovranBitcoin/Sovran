/**
 * Server-backed message history for one Nostr DM conversation, with
 * scroll-to-load-older pagination. Fetches gift-wrap envelopes for the viewer
 * from nagg and decrypts client-side (reusing `giftWrapCache`). Because the
 * gift-wrap inbox is shared and counterparties are opaque server-side, the whole
 * inbox is paged (by envelope wrap-time `until` cursor) and messages are filtered
 * to this counterparty after decryption and deduped by id.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { nip04Cache } from '@/shared/lib/nostr/nip04Cache';
import { paymentLog } from '@/shared/lib/logger';
import { fetchDmConversation } from '../data/dmEnvelopeClient';
import { decryptDmEnvelopes, type DecryptedDm, type DmProtocol } from '../data/dmDecryptPipeline';
import { createDmEnvelopeCursor } from '../data/dmPagination';

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
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // The cursor walks ALL envelope wrap times (not the decrypted rumor time,
  // which uses a different clock) and detects "no progress"; seenMsgIds dedups
  // the messages actually shown for this counterparty.
  const cursorRef = useRef(createDmEnvelopeCursor());
  const seenMsgIdsRef = useRef(new Set<string>());
  const loadingMoreRef = useRef(false);

  const ingestMessages = useCallback(
    (decrypted: DecryptedDm[]) => {
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
    [counterparty, protocol]
  );

  useEffect(() => {
    if (!viewerPubkey || !viewerPrivateKey || !counterparty) {
      setMessages([]);
      setHasMore(false);
      return;
    }
    const controller = new AbortController();
    cursorRef.current.reset();
    seenMsgIdsRef.current = new Set();
    setMessages([]);
    setError(null);
    setLoading(true);
    void (async () => {
      await (protocol === 'nip04'
        ? nip04Cache.hydrate(viewerPubkey)
        : giftWrapCache.cache.hydrate(viewerPubkey));
      const page = await fetchDmConversation({
        viewer: viewerPubkey,
        counterparty,
        kinds: protocol === 'nip04' ? [4] : [1059],
        limit: PAGE_LIMIT,
        refresh: refreshKey > 0,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      cursorRef.current.track(page);
      ingestMessages(decryptDmEnvelopes(page.envelopes, viewerPubkey, viewerPrivateKey));
      if (!controller.signal.aborted) setHasMore(page.envelopes.length >= PAGE_LIMIT);
    })()
      .catch((e) => {
        if (controller.signal.aborted) return;
        const err = e instanceof Error ? e : new Error(String(e));
        paymentLog.warn('payment.dm.thread.failed', { error: err.message });
        setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [counterparty, protocol, viewerPubkey, viewerPrivateKey, refreshKey, ingestMessages]);

  const loadMore = useCallback(async () => {
    const until = cursorRef.current.nextUntil();
    if (
      loadingMoreRef.current ||
      !hasMore ||
      !viewerPubkey ||
      !viewerPrivateKey ||
      until === undefined
    ) {
      return;
    }
    loadingMoreRef.current = true;
    try {
      const page = await fetchDmConversation({
        viewer: viewerPubkey,
        counterparty,
        kinds: protocol === 'nip04' ? [4] : [1059],
        until,
        limit: PAGE_LIMIT,
      });
      const freshEnvelopes = cursorRef.current.track(page);
      ingestMessages(decryptDmEnvelopes(page.envelopes, viewerPubkey, viewerPrivateKey));
      // Keep paging while envelopes are full (a page may hold no messages for THIS
      // counterparty yet still have older ones behind it); stop on a short page or
      // when the server stops returning new envelopes.
      setHasMore(page.envelopes.length >= PAGE_LIMIT && freshEnvelopes > 0);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      loadingMoreRef.current = false;
    }
  }, [hasMore, viewerPubkey, viewerPrivateKey, counterparty, protocol, ingestMessages]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { messages, loading, hasMore, loadMore, refresh, error };
}
