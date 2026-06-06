/**
 * Server-backed Nostr DM conversation list. Fetches gift-wrap envelopes from nagg
 * (paginated), decrypts them client-side (reusing the proven `giftWrapCache`
 * path), and buckets them per counterparty (latest message wins). Scroll →
 * `loadMore()` fetches older envelopes via an envelope-wrap-time `until` cursor.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { nip04Cache } from '@/shared/lib/nostr/nip04Cache';
import { paymentLog } from '@/shared/lib/logger';
import { fetchDmEnvelopes, type DmEnvelopePage } from '../data/dmEnvelopeClient';
import { decryptDmEnvelopes, type DmProtocol } from '../data/dmDecryptPipeline';
import { CURSOR_SLACK_SECONDS, pageOldestWrapTs } from '../data/dmPagination';

/** Fetched DM kinds: NIP-04 (kind 4) + NIP-17 gift wraps (kind 1059). */
const DM_KINDS = [4, 1059];

export interface DmConversation {
  counterparty: string;
  lastMessagePreview: string;
  /** unix seconds */
  lastMessageAt: number;
  /** Protocol of the most recent message with this counterparty. */
  protocol: DmProtocol;
}

const PAGE_LIMIT = 100;

export function useDmConversations(viewerPubkey?: string, viewerPrivateKey?: Uint8Array) {
  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [loading, setLoading] = useState(false);
  // `loading` starts false and only flips true once the fetch effect runs, so a
  // consumer that gates a first-load spinner on `!loading` would hide it on the
  // very first render (before the fetch starts) and flash partial data. This
  // latches true only after the first real fetch settles, so the contacts list
  // can wait for genuine results instead of rendering early.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Accumulators persist across pages so cross-page bucketing keeps "latest wins".
  const bucketRef = useRef(new Map<string, DmConversation>());
  const seenWrapIdsRef = useRef(new Set<string>());
  const oldestWrapTsRef = useRef<number | undefined>(undefined);
  const loadingMoreRef = useRef(false);

  // Bucket a page; returns the number of fresh (unseen) envelopes ingested.
  const ingest = useCallback(
    (page: DmEnvelopePage, viewer: string, privateKey: Uint8Array): number => {
      let fresh = 0;
      for (const envelope of page.envelopes) {
        if (!seenWrapIdsRef.current.has(envelope.id)) {
          seenWrapIdsRef.current.add(envelope.id);
          fresh += 1;
        }
      }
      const oldest = pageOldestWrapTs(page);
      if (oldest !== undefined) {
        oldestWrapTsRef.current =
          oldestWrapTsRef.current === undefined
            ? oldest
            : Math.min(oldestWrapTsRef.current, oldest);
      }
      const decrypted = decryptDmEnvelopes(page.envelopes, viewer, privateKey);
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
          });
        }
      }
      const list = [...bucketRef.current.values()].sort(
        (a, b) => b.lastMessageAt - a.lastMessageAt
      );
      setConversations(list);
      return fresh;
    },
    []
  );

  useEffect(() => {
    if (!viewerPubkey || !viewerPrivateKey) {
      setConversations([]);
      setHasMore(false);
      return;
    }
    const controller = new AbortController();
    bucketRef.current = new Map();
    seenWrapIdsRef.current = new Set();
    oldestWrapTsRef.current = undefined;
    setConversations([]);
    setError(null);
    setLoading(true);
    void (async () => {
      await Promise.all([
        giftWrapCache.cache.hydrate(viewerPubkey),
        nip04Cache.hydrate(viewerPubkey),
      ]);
      const page = await fetchDmEnvelopes({
        viewer: viewerPubkey,
        kinds: DM_KINDS,
        limit: PAGE_LIMIT,
        refresh: refreshKey > 0,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      ingest(page, viewerPubkey, viewerPrivateKey);
      if (!controller.signal.aborted) setHasMore(page.envelopes.length >= PAGE_LIMIT);
    })()
      .catch((e) => {
        if (controller.signal.aborted) return;
        const err = e instanceof Error ? e : new Error(String(e));
        paymentLog.warn('payment.dm.conversations.failed', { error: err.message });
        setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setHasLoadedOnce(true);
        }
      });
    return () => controller.abort();
  }, [viewerPubkey, viewerPrivateKey, refreshKey, ingest]);

  const loadMore = useCallback(async () => {
    if (
      loadingMoreRef.current ||
      !hasMore ||
      !viewerPubkey ||
      !viewerPrivateKey ||
      oldestWrapTsRef.current === undefined
    ) {
      return;
    }
    loadingMoreRef.current = true;
    try {
      const until = oldestWrapTsRef.current + CURSOR_SLACK_SECONDS;
      const page = await fetchDmEnvelopes({
        viewer: viewerPubkey,
        kinds: DM_KINDS,
        until,
        limit: PAGE_LIMIT,
      });
      const fresh = ingest(page, viewerPubkey, viewerPrivateKey);
      // Stop on a short page (end) OR a full page with nothing new (server ignored
      // `until` / we've drained this window) so the spinner never loops forever.
      setHasMore(page.envelopes.length >= PAGE_LIMIT && fresh > 0);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      loadingMoreRef.current = false;
    }
  }, [hasMore, viewerPubkey, viewerPrivateKey, ingest]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { conversations, loading, hasLoadedOnce, hasMore, loadMore, refresh, error };
}
