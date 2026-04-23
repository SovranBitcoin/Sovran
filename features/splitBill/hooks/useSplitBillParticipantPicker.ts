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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BLEPeer } from 'bitchat-module';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Metadata } from 'nostr-tools/kinds';
import { useBLEPeers } from '@/features/bitchat/hooks/useBLEPeers';
import { useRecentContacts } from '@/features/payments/hooks/useRecentContacts';
import { useContactSearch } from '@/features/payments/hooks/useContactSearch';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';
import { prefetchImages } from '@/shared/lib/imageCache';
import { getUsername } from '@/shared/lib/username';
import { resolveDisplayName } from '@/shared/lib/profile';
import { walletLog } from '@/shared/lib/logger';
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
  /**
   * True when this candidate's kind-0 profile metadata hasn't landed yet.
   * Row renders a loading skeleton for title/subtitle/avatar instead of
   * showing the truncated-pubkey fallback — mirrors ContactListItem. BLE
   * candidates are never loading (they carry their own nickname and icon).
   */
  isLoadingProfile?: boolean;
  /**
   * Only set on `source: 'self'` candidates. Identifies the one profile
   * whose keys are currently loaded in `NostrKeysProvider` so the row
   * can render a "Current" badge and the hook can pre-select it.
   */
  isActive?: boolean;
  /**
   * Optional Nostr reputation score (0-100) from `/nostr/search`. The
   * server computes this from the DVM's pagerank output on every search
   * response, so it's always present for search-sourced candidates;
   * DM-sourced (Recent) rows don't carry it. Surfaced in the row's
   * accent slot when available.
   */
  score?: number;
  /**
   * Optional follower count — populated by the API when a /profile
   * record was cached for this pubkey. Sparse by design (only pubkeys
   * the server has recently fetched carry this). Row renders "N
   * followers" when present.
   */
  followerCount?: number;
  /**
   * Optional following count — paired with `followerCount`, same cache-only
   * sourcing from `/nostr/search`'s enrichment of cached `/profile` records.
   * Surfaced as a second stat pill when present.
   */
  followingCount?: number;
  /**
   * NIP-05 handle from the kind-0 event (when set). Surfaced as the trailing
   * pill on the row's accent line; blue check on valid, dim on invalid.
   * Present for `source: 'nostr' | 'search'` candidates whose profile
   * carries it. Validation state is unknown at picker time — the row just
   * renders the handle; a NIP-05 resolver elsewhere can flip the valid flag.
   */
  nip05?: string;
  /**
   * Server-side NIP-05 verification flag from `/nostr/search`. Drives the
   * blue-vs-dim color of the NIP-05 pill in `ContactRow` — without it the
   * pill renders gray as if unverified even when the server knew better.
   */
  nip05Valid?: boolean;
}

// Source → delivery channel. Fixed; no runtime choice.
function channelFor(source: SplitBillParticipantSource): SplitBillDeliveryChannel {
  if (source === 'ble') return 'ble-dm';
  if (source === 'nostr') return 'nostr-dm';
  return 'qr-only';
}

/**
 * Shallow equality across every field of two PickerCandidates. Used by the
 * selection-refresh effect to skip work when a fresh candidate matches the
 * already-selected snapshot. Iterates both keysets so a new field added to
 * `PickerCandidate` participates automatically — no silent regression when
 * the shape grows.
 */
function shallowEqualCandidate(a: PickerCandidate, b: PickerCandidate): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof PickerCandidate>;
  for (const k of keys) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

/** Shape of the JSON blob in a kind-0 event's `content`. Nostr profile
 *  metadata uses both camelCase and snake_case historically; the shared
 *  `resolveDisplayName` handles both. */
interface ProfileMetadata {
  name?: string;
  displayName?: string;
  display_name?: string;
  picture?: string;
  nip05?: string;
  nip05Valid?: boolean;
}

/** Reputation / social-proof stats the `/nostr/search` endpoint includes
 *  alongside each result (when the server can populate them cheaply). All
 *  fields are independently optional. `score` is always present for
 *  search-sourced candidates; `followers` / `follows` flow through only
 *  when the server has a cached `/profile` for that pubkey. */
interface SearchHitStats {
  score?: number;
  followers?: number;
  follows?: number;
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
 *  — `useRecentContacts` itself only returns pubkeys. `stats` carries any
 *  session-cached reputation data we've seen for this pubkey (typically
 *  from a prior `/nostr/search` hit), so a Recent row can render the
 *  same shield/followers pills as a freshly-searched result. */
function nostrCandidate(
  pubkey: string,
  profile: ProfileMetadata | undefined,
  stats: SearchHitStats | undefined,
): PickerCandidate {
  const nickname = resolveDisplayName(profile);
  return {
    id: `nostr:${pubkey}`,
    source: 'nostr',
    channel: 'nostr-dm',
    pubkey,
    nickname,
    avatarUrl: profile?.picture,
    // NIP-05 is rendered as a pill on the accent row by `ContactRow` — we no
    // longer duplicate it in the subtitle slot.
    subtitle: undefined,
    isLoadingProfile: !profile,
    score: stats?.score,
    followerCount: stats?.followers,
    followingCount: stats?.follows,
    nip05: profile?.nip05,
    nip05Valid: profile?.nip05Valid,
  };
}

/**
 * Build a self-source candidate from a stored `ProfileEntry`. Self rows
 * are driven entirely by locally-cached fields — no relay round-trip — so
 * they never enter the loading state. The `isActive` flag marks the one
 * profile whose keys are currently mounted in `NostrKeysProvider`.
 */
function selfCandidate(profile: ProfileEntry, isActive: boolean): PickerCandidate {
  const nickname = profile.cachedDisplayName || getUsername(profile.pubkey);
  return {
    id: `self:${profile.pubkey}`,
    source: 'self',
    channel: 'self',
    pubkey: profile.pubkey,
    nickname,
    avatarUrl: profile.cachedPicture,
    subtitle: isActive ? 'Your current account' : 'Your other account',
    isActive,
    isLoadingProfile: false,
  };
}

/**
 * Build a candidate from a Nostr profile-search REST hit. Collapsed into
 * the `nostr` source/channel so ids unify with the Recent section — the
 * moment the user selects a search hit we want it to live alongside
 * real DM-derived contacts in the main picker (same id lets selection
 * state + dedupe keep tracking across surfaces).
 *
 * If the recipient doesn't have a NIP-17 mailbox, delivery may silently
 * fail at send time — that's fine, the orchestrator's per-participant
 * error handling will mark it `failed` and the user can retry or share
 * via QR from the detail screen.
 */
function searchCandidate(
  pubkey: string,
  profile: ProfileMetadata | undefined,
  stats?: SearchHitStats
): PickerCandidate {
  const nickname = resolveDisplayName(profile);
  return {
    id: `nostr:${pubkey}`,
    source: 'nostr',
    channel: 'nostr-dm',
    pubkey,
    nickname,
    avatarUrl: profile?.picture,
    // NIP-05 is rendered as a pill on the accent row by `ContactRow`; no
    // subtitle fallback — avoids the duplicate URL and drops the
    // "Found on Nostr" filler.
    subtitle: undefined,
    isLoadingProfile: !profile,
    nip05: profile?.nip05,
    nip05Valid: profile?.nip05Valid,
    score: stats?.score,
    followerCount: stats?.followers,
    followingCount: stats?.follows,
  };
}

// ---------------------------------------------------------------------------

interface Section {
  title: string;
  data: PickerCandidate[];
}

export interface UseSplitBillParticipantPickerResult {
  /** Grouped sections for rendering a sectioned list on the main picker
   *  screen. Excludes the Search section — search results live in a
   *  separate modal route and are exposed via `searchCandidates`. */
  sections: Section[];
  /** Flat list of all visible candidates (for LegendList without sections). */
  flatCandidates: PickerCandidate[];
  /** Nostr search results — displayed exclusively inside the search modal. */
  searchCandidates: PickerCandidate[];
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

  // --- Self candidates — the user's own profiles (one entry per account
  //     in `profileStore`). Rendered in the "Your Accounts" section at
  //     the top of the picker. The active profile is pre-selected.
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);
  const selfCandidates = useMemo(
    () => profiles.map((p) => selfCandidate(p, p.accountIndex === activeAccountIndex)),
    [profiles, activeAccountIndex]
  );
  const selfPubkeys = useMemo(() => new Set(profiles.map((p) => p.pubkey)), [profiles]);

  // --- Promoted pubkeys — every Nostr pubkey the user has ever toggled
  //     during THIS picker session (typically discovered via the search
  //     modal). Promoted pubkeys fold into the Recent section so the
  //     user can re-toggle them without re-opening search. Session-only
  //     by design; lost when the picker's context provider unmounts
  //     (normally when the flow exits).
  const [promotedPubkeys, setPromotedPubkeys] = useState<Set<string>>(() => new Set());

  // --- Recent-contact pubkeys — from DMs + promoted search hits. Dedupe
  //     against ALL self pubkeys (not just the active account) so another
  //     of the user's own profiles doesn't appear twice if it's been
  //     DM-active. Promoted entries append after real DM contacts so the
  //     "most recent DM" ordering is preserved for the common case.
  const recentPubkeys = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of displayContacts) {
      const pk = (c as { pubkey?: string }).pubkey;
      if (!pk || selfPubkeys.has(pk) || seen.has(pk)) continue;
      seen.add(pk);
      out.push(pk);
    }
    for (const pk of promotedPubkeys) {
      if (selfPubkeys.has(pk) || seen.has(pk)) continue;
      seen.add(pk);
      out.push(pk);
    }
    return out;
  }, [displayContacts, selfPubkeys, promotedPubkeys]);

  // --- Subscribe to kind-0 metadata for recent contacts + `search` results.
  //     `useContactSearch` already returns profiles inline via the REST
  //     search API — but those profiles can be stale / partial, so layering
  //     a relay subscription on top lets freshly-updated metadata overwrite
  //     the REST snapshot as it arrives. The filter is capped at 100
  //     authors to keep the subscription small; realistic split bills
  //     pick from <20 contacts.
  // Ref-stable author list. Without this, tapping a Recent row mutates
  // `promotedPubkeys` → `recentPubkeys` memo rebuilds into a new array
  // that is *shallow-equal* to the previous one (the tapped pubkey was
  // already in `displayContacts`), but the fresh ref flows into
  // `profileFilters`, `useSubscribe` re-subscribes, `profileEvents` drops
  // to empty during the resubscribe window, and every Recent row falls
  // back to `isLoadingProfile: true` for a few frames — the mass
  // skeleton flash. We canonicalise: sort the authors, and keep the
  // previous array reference when the content is unchanged.
  const authorsRef = useRef<string[]>([]);
  const profileSubscriptionAuthors = useMemo(() => {
    const authors = new Set<string>(recentPubkeys);
    for (const r of displayResults) {
      if (r.pubkey && !r.pubkey.startsWith('placeholder-')) authors.add(r.pubkey);
    }
    const next = Array.from(authors).sort().slice(0, 100);
    const prev = authorsRef.current;
    if (prev.length === next.length && prev.every((v, i) => v === next[i])) {
      return prev;
    }
    authorsRef.current = next;
    return next;
  }, [recentPubkeys, displayResults]);

  const profileFilters = useMemo(() => {
    if (profileSubscriptionAuthors.length === 0) return null;
    return [{ kinds: [Metadata], authors: profileSubscriptionAuthors }];
  }, [profileSubscriptionAuthors]);

  const { events: profileEvents } = useSubscribe({ filters: profileFilters });

  // Track profile-event arrival volume — relays often return dozens of
  // kind-0 rows per pubkey so this is the biggest churn source in the hook.
  const prevProfileEventCount = useRef(0);
  useEffect(() => {
    const count = profileEvents?.length ?? 0;
    if (count !== prevProfileEventCount.current) {
      walletLog.debug('split_bill.picker.profile_events_changed', {
        count,
        delta: count - prevProfileEventCount.current,
        authorsSubscribed: profileSubscriptionAuthors.length,
      });
      prevProfileEventCount.current = count;
    }
  }, [profileEvents, profileSubscriptionAuthors.length]);

  /** Newest kind-0 per pubkey. Relays often return multiple copies. */
  const profilesByPubkey = useMemo(() => {
    const t0 = performance.now();
    const map = new Map<string, ProfileMetadata>();
    const newestAt = new Map<string, number>();
    let skipped = 0;
    profileEvents?.forEach((event) => {
      try {
        const ts = event.created_at ?? 0;
        if ((newestAt.get(event.pubkey) ?? -1) >= ts) {
          skipped++;
          return;
        }
        const parsed = JSON.parse(event.content) as ProfileMetadata;
        map.set(event.pubkey, parsed);
        newestAt.set(event.pubkey, ts);
      } catch {
        // Skip invalid profile JSON
      }
    });
    walletLog.debug('split_bill.picker.profiles_rebuilt', {
      events: profileEvents?.length ?? 0,
      unique: map.size,
      skippedOlder: skipped,
      duration_ms: Math.round((performance.now() - t0) * 100) / 100,
    });
    return map;
  }, [profileEvents]);

  // Fallback profile index drawn from REST `/nostr/search` hits. When the
  // user taps a search result, the hit's pubkey gets promoted to the
  // Recent section. If the relay subscription hasn't yet surfaced a kind-0
  // for that pubkey, `profilesByPubkey.get(pk)` returns undefined and the
  // newly-built Recent candidate would render its loading skeleton — a
  // visible "flash" on select. Seeding from `displayResults` keeps the row
  // populated through the transition.
  const searchProfilesByPubkey = useMemo(() => {
    const map = new Map<string, ProfileMetadata>();
    for (const r of displayResults) {
      if (!r?.pubkey || r.pubkey.startsWith('placeholder-')) continue;
      if (map.has(r.pubkey)) continue;
      map.set(r.pubkey, {
        name: r.profile?.name,
        display_name: r.profile?.display_name,
        displayName: r.profile?.displayName,
        picture: r.profile?.picture,
        nip05: r.profile?.nip05,
        nip05Valid: r.profile?.nip05Valid,
      });
    }
    return map;
  }, [displayResults]);

  // Resolve a profile preferring fresh relay metadata, falling back to the
  // REST search snapshot. Callers treat the result as a stable input for
  // candidate memoization below.
  const resolveProfile = useCallback(
    (pubkey: string): ProfileMetadata | undefined =>
      profilesByPubkey.get(pubkey) ?? searchProfilesByPubkey.get(pubkey),
    [profilesByPubkey, searchProfilesByPubkey],
  );

  // Session-scoped reputation cache. `/nostr/search` responses inline
  // `score` / `followers` / `follows` when the server has a cached
  // `/profile` for that pubkey — free data the DVM already paid for. We
  // accumulate every hit seen during the picker session so a contact the
  // user found via search keeps its shield + follower pill when they
  // later appear in Recent. (DM-only contacts never searched end up
  // without these pills — acceptable; it's opportunistic display.)
  //
  // Shape stays as `state` rather than a ref so a fresh stat arriving for
  // a pubkey triggers the candidate memo to re-run via a stable identity
  // change.
  const [statsByPubkey, setStatsByPubkey] = useState<Map<string, SearchHitStats>>(
    () => new Map(),
  );
  useEffect(() => {
    setStatsByPubkey((prev) => {
      let next: Map<string, SearchHitStats> | undefined;
      for (const r of displayResults) {
        if (!r?.pubkey || r.pubkey.startsWith('placeholder-')) continue;
        const fresh: SearchHitStats = {
          score: r.profile?.score,
          followers: r.profile?.followers,
          follows: r.profile?.follows,
        };
        if (fresh.score === undefined && fresh.followers === undefined && fresh.follows === undefined) continue;
        const existing = prev.get(r.pubkey);
        if (
          existing &&
          existing.score === fresh.score &&
          existing.followers === fresh.followers &&
          existing.follows === fresh.follows
        ) continue;
        if (!next) next = new Map(prev);
        next.set(r.pubkey, fresh);
      }
      return next ?? prev;
    });
  }, [displayResults]);

  const resolveStats = useCallback(
    (pubkey: string): SearchHitStats | undefined => statsByPubkey.get(pubkey),
    [statsByPubkey],
  );

  // Warm the expo-image cache with every profile picture we know about.
  // Mirrors ContactsScreen — without this the first render of a picker row
  // triggers the image fetch inline and the PFP appears to "pop in" a beat
  // after the row mounts.
  useEffect(() => {
    prefetchImages(Array.from(profilesByPubkey.values()).map((p) => p?.picture));
  }, [profilesByPubkey]);

  // --- Build candidates per source. Dedup across sources by pubkey / peerID. ---

  const bleCandidates = useMemo(() => {
    const t0 = performance.now();
    // Sort: connected first, then recent
    const sorted = [...blePeers].sort((a, b) => {
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return b.lastSeen - a.lastSeen;
    });
    const out = sorted.map(bleCandidate);
    walletLog.debug('split_bill.picker.ble_candidates_built', {
      peers: blePeers.length,
      connected: blePeers.filter((p) => p.isConnected).length,
      duration_ms: Math.round((performance.now() - t0) * 100) / 100,
    });
    return out;
  }, [blePeers]);

  // Candidate-ref cache so unchanged (pubkey, profile, stats) tuples keep
  // the same `PickerCandidate` reference across renders. That lets the
  // memoed `ParticipantRow` skip re-render on every tick except when the
  // row's own data actually moves. Invalidates naturally: a new kind-0
  // event flips the profile ref for that one pubkey and rebuilds its
  // candidate; a new search-hit stat flips the stats ref similarly.
  // Other pubkeys keep their refs and reuse the cached candidate.
  const nostrCandidateCache = useRef(
    new Map<
      string,
      {
        profile: ProfileMetadata | undefined;
        stats: SearchHitStats | undefined;
        candidate: PickerCandidate;
      }
    >(),
  );

  const nostrCandidates = useMemo(() => {
    const t0 = performance.now();
    const cache = nostrCandidateCache.current;
    const out: PickerCandidate[] = new Array(recentPubkeys.length);
    const seen = new Set<string>();
    let reused = 0;
    for (let i = 0; i < recentPubkeys.length; i++) {
      const pubkey = recentPubkeys[i];
      seen.add(pubkey);
      const profile = resolveProfile(pubkey);
      const stats = resolveStats(pubkey);
      const cached = cache.get(pubkey);
      if (cached && Object.is(cached.profile, profile) && Object.is(cached.stats, stats)) {
        out[i] = cached.candidate;
        reused++;
      } else {
        const fresh = nostrCandidate(pubkey, profile, stats);
        cache.set(pubkey, { profile, stats, candidate: fresh });
        out[i] = fresh;
      }
    }
    // GC entries for pubkeys that dropped out of Recent so the cache
    // doesn't grow unbounded across a long session.
    for (const pk of cache.keys()) if (!seen.has(pk)) cache.delete(pk);
    walletLog.debug('split_bill.picker.nostr_candidates_built', {
      recentPubkeys: recentPubkeys.length,
      withProfile: out.filter((c) => !c.isLoadingProfile).length,
      reused,
      duration_ms: Math.round((performance.now() - t0) * 100) / 100,
    });
    return out;
  }, [recentPubkeys, resolveProfile, resolveStats]);

  // Pubkeys we treat as "already a recent contact" for dedupe purposes —
  // i.e. only the REAL DM-derived recents, NOT promoted ones. Promoted
  // pubkeys (from search taps) intentionally STAY visible in the search
  // modal so the user can see the row's checkmark flip and toggle
  // again without it vanishing from their current view. They also show
  // up in Recent on the main screen — both places, same `nostr:<pubkey>`
  // id, selection state shared.
  const originalRecentPubkeys = useMemo(
    () =>
      new Set(
        displayContacts.map((c: { pubkey?: string }) => c.pubkey).filter((p): p is string => !!p)
      ),
    [displayContacts]
  );

  const searchCandidates = useMemo(() => {
    if (!hasSearched) return [];
    // Note: we intentionally no longer gate on `searchLoading` — `useContactSearch`
    // now keeps the prior results in `displayResults` while a new query is in
    // flight (stale-while-revalidate), so dropping to [] here would cause the
    // list to flash empty on every keystroke.
    const t0 = performance.now();
    const out = displayResults
      .filter((r) => r.profile && r.pubkey && !r.pubkey.startsWith('placeholder-'))
      // Dedupe against actual DM history + own profiles. Promoted pubkeys
      // (previously tapped in search) are NOT excluded — they stay in the
      // results list so the row's check stays visible as the user toggles.
      .filter((r) => !originalRecentPubkeys.has(r.pubkey) && !selfPubkeys.has(r.pubkey))
      .map((r) => {
        // Prefer fresh relay metadata over REST snapshot when both exist.
        const relayProfile = profilesByPubkey.get(r.pubkey);
        const merged = { ...(r.profile as ProfileMetadata | undefined), ...relayProfile };
        // Reputation stats come from the REST hit. `/nostr/search` inlines
        // `followers` / `follows` / `score` / `created_at` from the server's
        // cached `/profile` records (cache-only — the server never fetches
        // per search hit), so each field flows through as an optional.
        const stats: SearchHitStats = {
          score: r.profile?.score,
          followers: r.profile?.followers,
          follows: r.profile?.follows,
        };
        return searchCandidate(r.pubkey, merged, stats);
      });
    walletLog.debug('split_bill.picker.search_candidates_built', {
      displayResults: displayResults.length,
      keptAfterFilter: out.length,
      dedupedByRecent: displayResults.length - out.length,
      duration_ms: Math.round((performance.now() - t0) * 100) / 100,
    });
    return out;
  }, [
    displayResults,
    hasSearched,
    originalRecentPubkeys,
    selfPubkeys,
    profilesByPubkey,
  ]);

  // Main-screen sections: Your Accounts / Bluetooth / Recent. Search
  // results live in the dedicated search modal and are exposed separately
  // as `searchCandidates` on the hook return.
  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    if (selfCandidates.length > 0) out.push({ title: 'Your Accounts', data: selfCandidates });
    if (bleCandidates.length > 0) out.push({ title: 'Bluetooth', data: bleCandidates });
    if (nostrCandidates.length > 0) out.push({ title: 'Recent', data: nostrCandidates });
    return out;
  }, [selfCandidates, bleCandidates, nostrCandidates]);

  // Pool used by the selection-refresh effect below. Includes search
  // results even though they don't appear in `sections` — otherwise a
  // selected search-hit whose kind-0 metadata lands later wouldn't get
  // the fresh nickname / avatar flowed into the stored entry.
  const flatCandidates = useMemo(
    () => [...sections.flatMap((s) => s.data), ...searchCandidates],
    [sections, searchCandidates]
  );

  // --- Selection state. Keeps insertion order for chip strip. ---
  //
  // Pre-seeded with the active profile so the user lands on the screen with
  // themselves already in the split — matches the "include my share by
  // default" intent. Initialised via the `useState` lazy form so we don't
  // recompute on every render. Subsequent profile rehydration (active-index
  // change after app restart, cachedDisplayName landing, etc.) flows in via
  // the flatCandidates refresh effect below.
  const [selectedList, setSelectedList] = useState<PickerCandidate[]>(() => {
    const active = profiles.find((p) => p.accountIndex === activeAccountIndex);
    return active ? [selfCandidate(active, true)] : [];
  });
  const selectedIds = useMemo(() => new Set(selectedList.map((c) => c.id)), [selectedList]);

  // Refresh selected items whenever the underlying candidate pool changes —
  // a user can tap a nostr contact before their kind-0 event has been seen,
  // and we want the selection to pick up the profile (name / avatar / nip05)
  // as soon as it arrives. Without this, `startGroup` stores the stale
  // `pubkey.slice(0,12)` nickname instead of the real display name.
  useEffect(() => {
    const t0 = performance.now();
    setSelectedList((prev) => {
      const pool = new Map<string, PickerCandidate>();
      for (const c of flatCandidates) pool.set(c.id, c);
      let changed = 0;
      let orphaned = 0;
      const next = prev.map((s) => {
        const fresh = pool.get(s.id);
        if (!fresh) {
          orphaned++;
          return s;
        }
        if (shallowEqualCandidate(fresh, s)) return s;
        changed++;
        return fresh;
      });
      walletLog.debug('split_bill.picker.selection_refresh', {
        selectedCount: prev.length,
        poolSize: pool.size,
        updated: changed,
        orphaned,
        duration_ms: Math.round((performance.now() - t0) * 100) / 100,
      });
      return changed > 0 ? next : prev;
    });
  }, [flatCandidates]);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((candidate: PickerCandidate) => {
    setSelectedList((prev) => {
      const wasSelected = prev.some((c) => c.id === candidate.id);
      const next = wasSelected ? prev.filter((c) => c.id !== candidate.id) : [...prev, candidate];
      walletLog.debug('split_bill.picker.toggle', {
        id: candidate.id,
        source: candidate.source,
        action: wasSelected ? 'deselect' : 'select',
        newCount: next.length,
      });
      return next;
    });
    // Remember every Nostr pubkey ever toggled so it appears in the
    // Recent section even after the user deselects it (and even across
    // search-modal close/reopen). Set.add dedupes against pubkeys already
    // in the promoted or recent-DM pool, so this stays cheap.
    if (candidate.source === 'nostr' && candidate.pubkey) {
      const pubkey = candidate.pubkey;
      setPromotedPubkeys((prev) => {
        if (prev.has(pubkey)) return prev;
        const out = new Set(prev);
        out.add(pubkey);
        return out;
      });
    }
  }, []);

  const remove = useCallback((id: string) => {
    setSelectedList((prev) => {
      const next = prev.filter((c) => c.id !== id);
      walletLog.debug('split_bill.picker.remove', {
        id,
        removed: next.length !== prev.length,
        newCount: next.length,
      });
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelectedList([]), []);

  return {
    sections,
    flatCandidates,
    searchCandidates,
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
