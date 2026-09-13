/**
 * Server-backed Nostr DM conversation list. Fetches gift-wrap envelopes from nagg
 * (paginated by `useDmEnvelopePages`), decrypts them client-side (reusing the
 * proven `giftWrapCache` path), and buckets them per counterparty (latest
 * message wins).
 *
 * First paint never waits for the network: the previous snapshot (this
 * session) or the persisted last-message metadata (peer, protocol, time — no
 * text) seeds the rows, a refresh replaces them in place when its first page
 * lands, and while the list is on screen a live relay listener folds new
 * arrivals in through the same decrypt/bucket path.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { nip04Cache } from '@/shared/lib/nostr/nip04Cache';
import { fetchDmEnvelopes, subscribeDmEnvelopesLive } from '../data/dmEnvelopeClient';
import { decryptDmEnvelopes } from '../data/dmDecryptPipeline';
import type { DmEnvelopePage, DmProtocol } from '../data/dmEnvelopeTypes';
import { dmConversationsCache, dmConversationsKey } from '../data/dmSnapshotCaches';
import { useDmLastMessageStore } from '@/shared/stores/profile/dmLastMessageStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { isMockContactPubkey } from '@/shared/stores/runtime/mockDataStore';
import { useDmEnvelopePages, type DmPageMeta } from './useDmEnvelopePages';

/** Fetched DM kinds: NIP-04 (kind 4) + NIP-17 gift wraps (kind 1059). */
const DM_KINDS = [4, 1059];

export interface DmConversation {
  counterparty: string;
  lastMessagePreview: string;
  lastMessageIsOwn?: boolean;
  /** unix seconds */
  lastMessageAt: number;
  /** Protocol of the most recent message with this counterparty. */
  protocol: DmProtocol;
  /** Event id of the newest message (gift-wrap id for NIP-17, kind-4 id for
   *  NIP-04) — the key the dev-only source badge resolves its tier by. */
  newestMessageId: string;
  /** Seeded from last-message metadata: the preview text has not been decrypted yet. */
  previewPending?: boolean;
}

const PAGE_LIMIT = 100;

/** Rows from the persisted last-message metadata: who, when, which protocol — never text. */
function seedFromLastMessages(): DmConversation[] {
  const byPeer = useDmLastMessageStore.getState().byPeer;
  const out: DmConversation[] = [];
  for (const [counterparty, entry] of Object.entries(byPeer)) {
    if (entry.protocol !== 'nip04' && entry.protocol !== 'nip17') continue;
    if (isMockContactPubkey(counterparty)) continue;
    out.push({
      counterparty,
      lastMessagePreview: '',
      lastMessageIsOwn: entry.isOwn,
      lastMessageAt: entry.atSeconds,
      protocol: entry.protocol,
      newestMessageId: '',
      previewPending: true,
    });
  }
  return out.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

function sorted(bucket: Map<string, DmConversation>): DmConversation[] {
  return [...bucket.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export function useDmConversations(
  viewerPubkey?: string,
  viewerPrivateKey?: Uint8Array,
  options: { live?: boolean } = {}
) {
  const cacheKey = viewerPubkey ? dmConversationsKey(viewerPubkey) : null;
  // Snapshot from this session, else the last-message seed, else nothing.
  const [initial] = useState<{ key: string | null; rows: DmConversation[]; snapshot: boolean }>(
    () => {
      const cached = cacheKey ? dmConversationsCache.getEntry(cacheKey) : undefined;
      if (cached && cached.viewerKey === viewerPubkey) {
        return { key: cacheKey, rows: cached.data, snapshot: true };
      }
      const seed = viewerPubkey ? seedFromLastMessages() : [];
      return { key: cacheKey, rows: seed, snapshot: seed.length > 0 };
    }
  );
  const [conversations, setConversations] = useState<DmConversation[]>(
    initial.key === cacheKey ? initial.rows : []
  );

  // Accumulator persists across pages so cross-page bucketing keeps "latest wins".
  const bucketRef = useRef(new Map<string, DmConversation>());

  const onReset = useCallback(() => {
    bucketRef.current = new Map();
    setConversations([]);
  }, []);

  const onPage = useCallback(
    (page: DmEnvelopePage, meta: DmPageMeta) => {
      if (!viewerPubkey || !viewerPrivateKey) return;
      // A refresh's first page rebuilds the bucket; the seeded/snapshot rows
      // stay on screen until this replacement is set below.
      if (meta.first && meta.mode !== 'loadMore') bucketRef.current = new Map();
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
        // One conversation per counterparty across protocols; the most recent
        // message wins (and sets the displayed protocol). Per-protocol threads
        // are opened from the profile's send-message picker.
        const existing = bucketRef.current.get(dm.counterparty);
        if (!existing || dm.createdAt > existing.lastMessageAt) {
          bucketRef.current.set(dm.counterparty, {
            counterparty: dm.counterparty,
            lastMessagePreview: dm.content,
            lastMessageIsOwn: dm.isOwn,
            lastMessageAt: dm.createdAt,
            protocol: dm.protocol,
            newestMessageId: dm.id,
          });
        }
      }
      const rows = sorted(bucketRef.current);
      setConversations(rows);
      if (cacheKey) dmConversationsCache.setEntry(cacheKey, rows, { viewerKey: viewerPubkey });
    },
    [viewerPubkey, viewerPrivateKey, cacheKey]
  );

  const hydrate = useCallback(async () => {
    if (!viewerPubkey) return;
    if (!useDmLastMessageStore.persist.hasHydrated()) {
      await useDmLastMessageStore.persist.rehydrate();
    }
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

  const pages = useDmEnvelopePages({
    surface: 'dmConversations',
    hasSnapshot: initial.key === cacheKey && initial.snapshot,
    feedKey: viewerPubkey && viewerPrivateKey ? viewerPubkey : null,
    pageLimit: PAGE_LIMIT,
    hydrate,
    fetchPage,
    onPage,
    onReset,
    failureEvent: 'payment.dm.conversations.failed',
  });

  // Live arrivals while the list is on screen: same decrypt/bucket path, one
  // envelope at a time; latest-wins bucketing makes a duplicate harmless.
  const live = options.live ?? false;
  useEffect(() => {
    if (!live || !viewerPubkey || !viewerPrivateKey) return;
    return subscribeDmEnvelopesLive(viewerPubkey, (page) =>
      onPage(page, { first: false, mode: 'live' })
    );
  }, [live, viewerPubkey, viewerPrivateKey, onPage]);

  return { conversations, ...pages };
}
