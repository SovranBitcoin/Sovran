/**
 * @fileoverview Multi-select participant picker state for Split Bill.
 *
 * Aggregates three data sources into a single flat list of candidates for
 * the picker screen, plus holds the "selected" set. One participant source
 * per row:
 *   - `source: 'ble'`     → live bitchat BLE peers from `useBLEPeers`
 *   - `source: 'nostr'`   → recent Nostr DM contacts from `useRecentContacts`
 *   - `source: 'search'`  → Nostr profile search hits from `useContactSearch`
 *
 * The `channel` for each candidate is fixed at discovery time so the
 * orchestrator knows how to deliver the BOLT11:
 *   - ble    → ble-dm
 *   - nostr  → nostr-dm
 *   - search → qr-only (no established DM channel)
 *
 * Search hits only appear while the searchbar has ≥2 chars (matches the
 * behaviour of `useContactSearch` itself).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BLEPeer } from 'bitchat-module';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Metadata } from 'nostr-tools/kinds';
import { useBLEPeers } from '@/features/bitchat/hooks/useBLEPeers';
import { useRecentContacts } from '@/features/payments/hooks/useRecentContacts';
import { useContactSearch } from '@/features/payments/hooks/useContactSearch';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import type {
  SplitBillDeliveryChannel,
  SplitBillParticipantSource,
} from '@/shared/stores/profile/splitBillTransactionsStore';

// ---------------------------------------------------------------------------
// Candidate shape — what the picker rows render
// ---------------------------------------------------------------------------

export interface PickerCandidate {
  /** Stable id for this row (used by LegendList keys + selection set). */
  id: string;
  source: SplitBillParticipantSource;
  channel: SplitBillDeliveryChannel;
  /** For source='nostr' | 'search'. Hex pubkey. */
  pubkey?: string;
  /** For source='ble'. 16-hex bitchat peerID. */
  peerID?: string;
  nickname?: string;
  avatarUrl?: string;
  /** Arbitrary sub-text for the row. */
  subtitle?: string;
}

// Source → delivery channel. Fixed; no runtime choice.
function channelFor(source: SplitBillParticipantSource): SplitBillDeliveryChannel {
  if (source === 'ble') return 'ble-dm';
  if (source === 'nostr') return 'nostr-dm';
  return 'qr-only';
}

/** Shape of the JSON blob in a kind-0 event's `content`. Nostr profile
 *  metadata uses both camelCase and snake_case historically, so we check
 *  both when resolving display name. */
interface ProfileMetadata {
  name?: string;
  displayName?: string;
  display_name?: string;
  picture?: string;
  nip05?: string;
}

function bleCandidate(peer: BLEPeer): PickerCandidate {
  const nickname = peer.nickname?.trim() || peer.peerID.slice(0, 12);
  return {
    id: `ble:${peer.peerID}`,
    source: 'ble',
    channel: 'ble-dm',
    peerID: peer.peerID,
    nickname,
    subtitle: peer.isConnected
      ? `Bluetooth · connected`
      : `Bluetooth · #${peer.peerID.slice(0, 8)}`,
  };
}

/** `profile` is the parsed kind-0 metadata JSON (name / display_name /
 *  picture / nip05). It's populated by the subscription in the hook below
 *  — `useRecentContacts` itself only returns pubkeys. */
function nostrCandidate(
  pubkey: string,
  profile: ProfileMetadata | undefined
): PickerCandidate {
  const nickname =
    profile?.display_name ||
    profile?.displayName ||
    profile?.name ||
    pubkey.slice(0, 12);
  return {
    id: `nostr:${pubkey}`,
    source: 'nostr',
    channel: 'nostr-dm',
    pubkey,
    nickname,
    avatarUrl: profile?.picture,
    subtitle: profile?.nip05 || 'Recent on Nostr',
  };
}

function searchCandidate(
  pubkey: string,
  profile: ProfileMetadata | undefined
): PickerCandidate {
  const nickname =
    profile?.display_name ||
    profile?.displayName ||
    profile?.name ||
    pubkey.slice(0, 12);
  return {
    id: `search:${pubkey}`,
    source: 'search',
    channel: 'qr-only',
    pubkey,
    nickname,
    avatarUrl: profile?.picture,
    subtitle: profile?.nip05 || 'Found on Nostr · QR only',
  };
}

// ---------------------------------------------------------------------------

interface Section {
  title: string;
  data: PickerCandidate[];
}

export interface UseSplitBillParticipantPickerResult {
  /** Grouped sections for rendering a sectioned list. */
  sections: Section[];
  /** Flat list of all visible candidates (for LegendList without sections). */
  flatCandidates: PickerCandidate[];
  /** Currently-selected candidates, in selection order. */
  selected: PickerCandidate[];
  selectedIds: Set<string>;

  isSelected: (id: string) => boolean;
  toggle: (candidate: PickerCandidate) => void;
  remove: (id: string) => void;
  clear: () => void;

  /** Controlled search query for the searchbar. */
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  /** Loading flags for UI skeletons. */
  searchLoading: boolean;
}

export function useSplitBillParticipantPicker(): UseSplitBillParticipantPickerResult {
  const { keys: nostrKeys } = useNostrKeysContext();
  const { peers: blePeers } = useBLEPeers();
  const { displayContacts } = useRecentContacts(nostrKeys);
  const [searchQuery, setSearchQuery] = useState('');
  const { displayResults, searchLoading, hasSearched } = useContactSearch(searchQuery);

  // --- Recent-contact pubkeys — from DMs, stored as plain pubkeys. No
  //     profile metadata comes with them, so we subscribe separately below.
  const recentPubkeys = useMemo(
    () =>
      displayContacts
        .map((c: any) => c.pubkey as string | undefined)
        .filter((p): p is string => !!p && p !== nostrKeys?.pubkey),
    [displayContacts, nostrKeys?.pubkey]
  );

  // --- Subscribe to kind-0 metadata for recent contacts + `search` results.
  //     `useContactSearch` already returns profiles inline via the REST
  //     search API — but those profiles can be stale / partial, so layering
  //     a relay subscription on top lets freshly-updated metadata overwrite
  //     the REST snapshot as it arrives. The filter is capped at 100
  //     authors to keep the subscription small; realistic split bills
  //     pick from <20 contacts.
  const profileSubscriptionAuthors = useMemo(() => {
    const authors = new Set<string>(recentPubkeys);
    for (const r of displayResults) {
      if (r.pubkey && !r.pubkey.startsWith('placeholder-')) authors.add(r.pubkey);
    }
    return Array.from(authors).slice(0, 100);
  }, [recentPubkeys, displayResults]);

  const profileFilters = useMemo(() => {
    if (profileSubscriptionAuthors.length === 0) return null;
    return [{ kinds: [Metadata], authors: profileSubscriptionAuthors }];
  }, [profileSubscriptionAuthors]);

  const { events: profileEvents } = useSubscribe({ filters: profileFilters });

  /** Newest kind-0 per pubkey. Relays often return multiple copies. */
  const profilesByPubkey = useMemo(() => {
    const map = new Map<string, ProfileMetadata>();
    const newestAt = new Map<string, number>();
    profileEvents?.forEach((event) => {
      try {
        const ts = event.created_at ?? 0;
        if ((newestAt.get(event.pubkey) ?? -1) >= ts) return;
        const parsed = JSON.parse(event.content) as ProfileMetadata;
        map.set(event.pubkey, parsed);
        newestAt.set(event.pubkey, ts);
      } catch {
        // Skip invalid profile JSON
      }
    });
    return map;
  }, [profileEvents]);

  // --- Build candidates per source. Dedup across sources by pubkey / peerID. ---

  const bleCandidates = useMemo(() => {
    // Sort: connected first, then recent
    const sorted = [...blePeers].sort((a, b) => {
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return b.lastSeen - a.lastSeen;
    });
    return sorted.map(bleCandidate);
  }, [blePeers]);

  const nostrCandidates = useMemo(() => {
    return recentPubkeys.map((pubkey) => nostrCandidate(pubkey, profilesByPubkey.get(pubkey)));
  }, [recentPubkeys, profilesByPubkey]);

  const nostrPubkeys = useMemo(
    () => new Set(nostrCandidates.map((c) => c.pubkey).filter(Boolean) as string[]),
    [nostrCandidates]
  );

  const searchCandidates = useMemo(() => {
    if (!hasSearched || searchLoading) return [];
    return displayResults
      .filter((r) => r.profile && r.pubkey && !r.pubkey.startsWith('placeholder-'))
      // Dedup: if this pubkey is already a recent contact, drop it from search.
      .filter((r) => !nostrPubkeys.has(r.pubkey))
      .map((r) => {
        // Prefer fresh relay metadata over REST snapshot when both exist.
        const relayProfile = profilesByPubkey.get(r.pubkey);
        const merged = { ...(r.profile as ProfileMetadata | undefined), ...relayProfile };
        return searchCandidate(r.pubkey, merged);
      });
  }, [displayResults, hasSearched, searchLoading, nostrPubkeys, profilesByPubkey]);

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    if (bleCandidates.length > 0) out.push({ title: 'Bluetooth', data: bleCandidates });
    if (nostrCandidates.length > 0) out.push({ title: 'Recent', data: nostrCandidates });
    if (searchCandidates.length > 0) out.push({ title: 'Search', data: searchCandidates });
    return out;
  }, [bleCandidates, nostrCandidates, searchCandidates]);

  const flatCandidates = useMemo(
    () => sections.flatMap((s) => s.data),
    [sections]
  );

  // --- Selection state. Keeps insertion order for chip strip. ---

  const [selectedList, setSelectedList] = useState<PickerCandidate[]>([]);
  const selectedIds = useMemo(() => new Set(selectedList.map((c) => c.id)), [selectedList]);

  // Refresh selected items whenever the underlying candidate pool changes —
  // a user can tap a nostr contact before their kind-0 event has been seen,
  // and we want the selection to pick up the profile (name / avatar / nip05)
  // as soon as it arrives. Without this, `startGroup` stores the stale
  // `pubkey.slice(0,12)` nickname instead of the real display name.
  useEffect(() => {
    setSelectedList((prev) => {
      const pool = new Map<string, PickerCandidate>();
      for (const c of flatCandidates) pool.set(c.id, c);
      let changed = false;
      const next = prev.map((s) => {
        const fresh = pool.get(s.id);
        if (!fresh) return s;
        if (
          fresh.nickname === s.nickname &&
          fresh.avatarUrl === s.avatarUrl &&
          fresh.subtitle === s.subtitle
        ) {
          return s;
        }
        changed = true;
        return fresh;
      });
      return changed ? next : prev;
    });
  }, [flatCandidates]);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((candidate: PickerCandidate) => {
    setSelectedList((prev) =>
      prev.some((c) => c.id === candidate.id)
        ? prev.filter((c) => c.id !== candidate.id)
        : [...prev, candidate]
    );
  }, []);

  const remove = useCallback((id: string) => {
    setSelectedList((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clear = useCallback(() => setSelectedList([]), []);

  return {
    sections,
    flatCandidates,
    selected: selectedList,
    selectedIds,
    isSelected,
    toggle,
    remove,
    clear,
    searchQuery,
    setSearchQuery,
    searchLoading,
  };
}
