/**
 * Recent Nostr DM contacts, backed by nagg (NIP-17 only). Replaces the legacy
 * relay-subscription `useRecentContacts`: it wraps the paginated, server-backed
 * `useDmConversations` (envelopes fetched from nagg, decrypted client-side and
 * bucketed per counterparty) and maps the result to the `RecentContact` shape
 * the contacts UI already consumes — plus the default "Sovran" support row and
 * the mock-mode demo/allowlist rows.
 */
import { useMemo } from 'react';
import { PUBLIC_KEYS } from '@/shared/lib/constants';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { getMockContacts, MOCK_ALLOWED_PUBKEYS_HEX } from '@/shared/stores/runtime/mockDataStore';
import type { RecentContact } from '../data/recentContactTypes';
import { useDmConversations } from './useDmConversations';

const DEFAULT_CONTACTS = [{ pubkey: PUBLIC_KEYS.SUPPORT, label: 'Sovran' }] as const;

interface NostrKeys {
  pubkey?: string;
  privateKey?: Uint8Array;
}

export function useNip17RecentContacts(nostrKeys: NostrKeys | null) {
  const mockMode = useSettingsStore((s) => s.mockMode);
  const { conversations, loading, hasLoadedOnce, hasMore, loadMore, refresh, error } =
    useDmConversations(
      mockMode ? undefined : nostrKeys?.pubkey,
      mockMode ? undefined : nostrKeys?.privateKey
    );

  const displayContacts = useMemo<RecentContact[]>(() => {
    const recent: RecentContact[] = conversations.map((c) => ({
      type: 'contact',
      pubkey: c.counterparty,
      // Already-decrypted preview from nagg — no client decrypt needed here.
      dmEvent: { content: c.lastMessagePreview, isOwn: c.lastMessageIsOwn },
      nip17Content: c.lastMessagePreview,
      timestamp: c.lastMessageAt,
      protocol: c.protocol,
      newestMessageId: c.newestMessageId,
    }));

    const existing = new Set(recent.map((c) => c.pubkey));
    const defaults: RecentContact[] = DEFAULT_CONTACTS.filter((dc) => !existing.has(dc.pubkey)).map(
      (dc) => ({
        type: 'contact',
        pubkey: dc.pubkey,
        dmEvent: null,
        nip17Content: undefined,
        timestamp: 0,
        isDefault: true,
      })
    );
    const base = [...recent, ...defaults];

    if (!mockMode) return base;
    // Never merge a real private conversation into the presentation fixture.
    const publicRows: RecentContact[] = [...MOCK_ALLOWED_PUBKEYS_HEX].map((pubkey) => ({
      type: 'contact',
      pubkey,
      dmEvent: null,
      nip17Content: undefined,
      timestamp: 0,
      isDefault: true,
    }));
    return [...getMockContacts(), ...publicRows];
  }, [conversations, mockMode]);

  const contactPubkeys = useMemo(
    () => displayContacts.map((c) => c.pubkey).filter(Boolean),
    [displayContacts]
  );

  return {
    displayContacts,
    contactPubkeys,
    conversations: mockMode ? [] : conversations,
    loading: mockMode ? false : loading,
    hasLoadedOnce: mockMode || hasLoadedOnce,
    hasMore: !mockMode && hasMore,
    loadMore,
    refresh,
    error,
  };
}
