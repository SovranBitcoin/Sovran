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
    useDmConversations(nostrKeys?.pubkey, nostrKeys?.privateKey);

  const displayContacts = useMemo<RecentContact[]>(() => {
    const recent: RecentContact[] = conversations.map((c) => ({
      type: 'contact',
      pubkey: c.counterparty,
      // Already-decrypted preview from nagg — no client decrypt needed here.
      dmEvent: { content: c.lastMessagePreview },
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
    // Mock demo rows + allowlisted pubkeys (rendered with real kind-0 metadata),
    // deduped against real conversations by pubkey. Mirrors the legacy hook.
    const realKeys = new Set(base.map((c) => c.pubkey));
    const mocks = getMockContacts();
    const allowlistRows: RecentContact[] = [...MOCK_ALLOWED_PUBKEYS_HEX]
      .filter((pk) => !realKeys.has(pk))
      .map((pk) => ({
        type: 'contact',
        pubkey: pk,
        dmEvent: null,
        nip17Content: undefined,
        timestamp: 0,
        isDefault: true,
      }));
    return [...mocks.filter((m) => !realKeys.has(m.pubkey)), ...allowlistRows, ...base];
  }, [conversations, mockMode]);

  const contactPubkeys = useMemo(
    () => displayContacts.map((c) => c.pubkey).filter(Boolean),
    [displayContacts]
  );

  return {
    displayContacts,
    contactPubkeys,
    conversations,
    loading,
    hasLoadedOnce,
    hasMore,
    loadMore,
    refresh,
    error,
  };
}
