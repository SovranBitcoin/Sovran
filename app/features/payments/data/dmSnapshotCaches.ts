/**
 * In-memory, viewer-scoped snapshots of the two DM feeds, so re-entering the
 * Contacts tab or a conversation paints what was on screen last time while the
 * paging engine revalidates. Never persisted: decrypted previews and message
 * text stay in memory only and are dropped on profile switch (hunch rule nostr/private-dms).
 * The paging engine owns fetching; these are read-through snapshots, not the
 * fetch cache.
 */
import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
import type { DmConversation } from '@/features/payments/hooks/useDmConversations';
import type { DmThreadMessage } from '@/features/payments/hooks/useDmThread';
import type { DmProtocol } from './dmEnvelopeTypes';

export const dmConversationsCache = createQueryCacheStore<DmConversation[]>({
  name: 'dm-conversations-cache',
  logKey: 'dm_conversations_cache',
  staleTtlMs: 60 * 1000,
  maxEntries: 4,
  persist: false,
});

export function dmConversationsKey(viewer: string): string {
  return `dmconv:${viewer}`;
}

export const dmThreadCache = createQueryCacheStore<DmThreadMessage[]>({
  name: 'dm-thread-cache',
  logKey: 'dm_thread_cache',
  staleTtlMs: 60 * 1000,
  maxEntries: 6,
  persist: false,
});

export function dmThreadKey(viewer: string, protocol: DmProtocol, counterparty: string): string {
  return `dmthread:${viewer}:${protocol}:${counterparty}`;
}
