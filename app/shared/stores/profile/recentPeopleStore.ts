import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import {
  isNostrPubkeyHex,
  NostrPubkeyHexSchema,
  type NostrPubkeyHex,
} from '@/shared/lib/protocolIds';

export const MAX_RECENT_PEOPLE = 20;

/**
 * Why a person is in this store — its provenance. The store owns ONLY the two
 * provenances that have no other home:
 *   • `search` — we opened their profile (the original "recently viewed" use,
 *     shown in the feed search strip);
 *   • `peer`   — we resolved their Nostr identity over the Nut Drop mesh (the
 *     live BLE list is session-only, so we remember them here).
 *
 * Sent/received history is NOT stored here — it already lives as counterparty
 * metadata on the transaction annotations (single source of truth). The Send
 * modal's quick-pay tier consolidates both via `useQuickPayPeople`.
 *
 * Entries persisted before this field existed rehydrate as `search`.
 */
type RecentPersonReason = 'search' | 'peer';

// Higher wins. A later profile view (`search`) must not downgrade the fact that
// we stood near someone over the mesh (`peer`), which is the stronger quick-pay
// signal — so a stored reason only ever climbs.
const REASON_PRECEDENCE: Record<RecentPersonReason, number> = {
  search: 0,
  peer: 1,
};

interface RecentPersonEntry {
  pubkey: string;
  firstOpenedAt: number;
  lastOpenedAt: number;
  reason: RecentPersonReason;
  /**
   * Best-known name at capture. Peers carry their BLE nickname here — their
   * only human-readable name, since most have no published kind-0 profile to
   * fetch later. Lets the Send modal's quick-pay tier render immediately
   * instead of showing "Unknown" until a (often nonexistent) profile resolves.
   */
  displayName?: string;
}

interface AddRecentPersonOptions {
  /** Provenance for this touch. @default 'search' */
  reason?: RecentPersonReason;
  /** Timestamp (ms). @default Date.now() */
  at?: number;
  /** Best-known name at capture (e.g. a peer's BLE nickname). */
  displayName?: string;
}

interface RecentPeopleState {
  entries: RecentPersonEntry[];
  addRecentPerson: (pubkey: string, opts?: AddRecentPersonOptions) => void;
  clearRecentPeople: () => void;
}

export function normalizeRecentPersonPubkey(
  pubkey: string | null | undefined
): NostrPubkeyHex | null {
  const normalized = pubkey?.trim().toLowerCase();
  if (!normalized || !isNostrPubkeyHex(normalized)) return null;
  return normalized;
}

export function upsertRecentPerson(
  entries: readonly RecentPersonEntry[],
  pubkey: string,
  reason: RecentPersonReason = 'search',
  openedAt: number = Date.now(),
  displayName?: string
): RecentPersonEntry[] {
  const normalized = normalizeRecentPersonPubkey(pubkey);
  if (!normalized) return [...entries];

  const existing = entries.find((entry) => entry.pubkey === normalized);
  // Keep whichever reason ranks higher so provenance never silently downgrades.
  const nextReason =
    existing && REASON_PRECEDENCE[existing.reason] >= REASON_PRECEDENCE[reason]
      ? existing.reason
      : reason;
  // Keep the freshest name we've seen; never drop a known one for a blank.
  const nextDisplayName = displayName?.trim() || existing?.displayName;
  const nextEntry: RecentPersonEntry = {
    pubkey: normalized,
    firstOpenedAt: existing?.firstOpenedAt ?? openedAt,
    lastOpenedAt: openedAt,
    reason: nextReason,
    ...(nextDisplayName ? { displayName: nextDisplayName } : {}),
  };

  return [nextEntry, ...entries.filter((entry) => entry.pubkey !== normalized)].slice(
    0,
    MAX_RECENT_PEOPLE
  );
}

/**
 * Everyone the store remembers — searched/viewed people AND nearby-mesh peers —
 * newest first. The Send modal's quick-pay tier merges these (each tagged by its
 * `reason`) with sent/received history from the transaction annotations.
 */
export function selectRecentPeople(
  entries: readonly RecentPersonEntry[],
  limit = MAX_RECENT_PEOPLE
): RecentPersonEntry[] {
  return [...entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, limit);
}

// `.default('search')` backfills entries persisted before `reason` existed;
// `.catch('search')` degrades an unknown future value rather than failing parse
// (a thrown element would make createMergeWithSchema discard the whole blob).
const RecentPersonReasonSchema = z.enum(['search', 'peer']).default('search').catch('search');

const PersistedRecentPersonEntry = z.looseObject({
  pubkey: NostrPubkeyHexSchema,
  firstOpenedAt: z.number().int().nonnegative(),
  lastOpenedAt: z.number().int().nonnegative(),
  reason: RecentPersonReasonSchema,
  displayName: z.string().optional(),
});

const PersistedRecentPeopleStore = z.object({
  entries: z.array(PersistedRecentPersonEntry).max(MAX_RECENT_PEOPLE).default([]),
});

export const useRecentPeopleStore = create<RecentPeopleState>()(
  persist(
    (set) => ({
      entries: [],

      addRecentPerson: (pubkey, opts) => {
        const normalized = normalizeRecentPersonPubkey(pubkey);
        if (!normalized) return;
        const reason = opts?.reason ?? 'search';
        const at = opts?.at ?? Date.now();
        storeLog.debug('store.recent_people.add', { pubkey: normalized.slice(0, 8), reason });
        set((state) => ({
          entries: upsertRecentPerson(state.entries, normalized, reason, at, opts?.displayName),
        }));
      },

      clearRecentPeople: () => set({ entries: [] }),
    }),
    persistConfig({
      name: 'recent-people-store',
      storage: createProfileScopedStorage(),
      schema: PersistedRecentPeopleStore,
      logKey: 'recent_people',
      partialize: (state) => ({ entries: state.entries }),
    })
  )
);
