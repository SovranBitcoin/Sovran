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
import { fetchDmEnvelopes } from '../data/dmEnvelopeClient';
import { decryptDmEnvelopes } from '../data/dmDecryptPipeline';
import type { DmEnvelopePage, DmProtocol } from '../data/dmEnvelopeTypes';
import { useDmLastMessageStore } from '@/shared/stores/profile/dmLastMessageStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { isMockContactPubkey } from '@/shared/stores/runtime/mockDataStore';
import { paymentLog } from '@/shared/lib/logger';
import { dmThreadCache, dmThreadKey } from '../data/dmSnapshotCaches';
import { useDmEnvelopePages, type DmPageMeta } from './useDmEnvelopePages';

const PAGE_LIMIT = 50;

export interface DmThreadMessage {
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
  const cacheKey =
    viewerPubkey && counterparty ? dmThreadKey(viewerPubkey, protocol, counterparty) : null;
  // This session's snapshot of the conversation paints on the first frame; the
  // page walk revalidates behind it and merges by message id.
  const [initial] = useState<{ key: string | null; rows: DmThreadMessage[] }>(() => {
    const cached = cacheKey ? dmThreadCache.getEntry(cacheKey) : undefined;
    return cached && cached.viewerKey === viewerPubkey
      ? { key: cacheKey, rows: cached.data }
      : { key: cacheKey, rows: [] };
  });
  const [messages, setMessages] = useState<DmThreadMessage[]>(
    initial.key === cacheKey ? initial.rows : []
  );

  // The paging cursor walks ALL envelope wrap times (not the decrypted rumor
  // time, which uses a different clock); seenMsgIds dedups the messages
  // actually shown for this counterparty.
  const firstPageStartedAtRef = useRef<number | null>(null);
  const seenMsgIdsRef = useRef(new Set<string>(initial.rows.map((m) => m.id)));

  const onReset = useCallback(() => {
    firstPageStartedAtRef.current = Date.now();
    seenMsgIdsRef.current = new Set();
    setMessages([]);
  }, []);

  const onPage = useCallback(
    (page: DmEnvelopePage, _meta: DmPageMeta) => {
      if (!viewerPubkey || !viewerPrivateKey) return 0;
      const decrypted = decryptDmEnvelopes(page.envelopes, viewerPubkey, viewerPrivateKey);
      const profile = useProfileStore.getState();
      const isCurrentProfile = profile.profiles.some(
        (p) => p.accountIndex === profile.activeAccountIndex && p.pubkey === viewerPubkey
      );
      for (const dm of decrypted) {
        if (isCurrentProfile && !isMockContactPubkey(dm.counterparty)) {
          useDmLastMessageStore.getState().recordLastMessage(dm.counterparty, {
            protocol: dm.protocol,
            atSeconds: dm.createdAt,
            isOwn: dm.isOwn,
          });
        }
      }
      const relevant = decrypted.filter(
        (dm) => dm.counterparty === counterparty && dm.protocol === protocol
      );
      const fresh = relevant.filter((dm) => !seenMsgIdsRef.current.has(dm.id));
      if (firstPageStartedAtRef.current !== null) {
        paymentLog.info('dm.thread.first_page', {
          ms: Date.now() - firstPageStartedAtRef.current,
          count: fresh.length,
        });
        firstPageStartedAtRef.current = null;
      }
      if (fresh.length === 0) return 0;
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
        if (cacheKey) dmThreadCache.setEntry(cacheKey, merged, { viewerKey: viewerPubkey });
        return merged;
      });
      return fresh.length;
    },
    [counterparty, protocol, viewerPubkey, viewerPrivateKey, cacheKey]
  );

  const hydrate = useCallback(async () => {
    if (!viewerPubkey) return;
    if (!useDmLastMessageStore.persist.hasHydrated()) {
      await useDmLastMessageStore.persist.rehydrate();
    }
    await (protocol === 'nip04'
      ? nip04Cache.hydrate(viewerPubkey)
      : giftWrapCache.cache.hydrate(viewerPubkey));
  }, [protocol, viewerPubkey]);

  const fetchPage = useCallback(
    (args: { until?: number; refresh: boolean; signal?: AbortSignal }) =>
      fetchDmEnvelopes({
        viewer: viewerPubkey ?? '',
        limit: PAGE_LIMIT,
        ...args,
      }),
    [viewerPubkey]
  );

  const pages = useDmEnvelopePages({
    surface: 'dmThread',
    hasSnapshot: initial.key === cacheKey && initial.rows.length > 0,
    feedKey:
      viewerPubkey && viewerPrivateKey && counterparty
        ? `${viewerPubkey}:${protocol}:${counterparty}`
        : null,
    pageLimit: PAGE_LIMIT,
    hydrate,
    fetchPage,
    onPage,
    continueWhileEmpty: true,
    onReset,
    failureEvent: 'payment.dm.thread.failed',
  });

  return { messages, ...pages };
}
