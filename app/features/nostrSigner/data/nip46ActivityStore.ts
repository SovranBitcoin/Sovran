/**
 * @fileoverview NIP-46 Activity Store
 *
 * Persisted, profile-scoped log of signer request outcomes, newest first.
 * Capped at ACTIVITY_CAP (tail-evict oldest) plus a 30-day prune after
 * rehydration.
 *
 * Redaction contract: entries structurally cannot carry request params,
 * plaintexts, ciphertexts, or full event JSON — only the engine-supplied
 * `summary`/`contentPreview` (curated, bounded display copy) and the signed
 * event id ever land here. The store applies its own MAX_SUMMARY_LENGTH = 120
 * ceiling purely as a persistence-boundary sanity bound on whatever it is
 * handed.
 *
 * `summary.refPubkey` (the decrypt conversation peer, for the detail
 * screen's "who" rendering) is deliberate metadata-at-rest: local-only,
 * profile-scoped, never logged.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import {
  ACTIVITY_CAP,
  ACTIVITY_MAX_AGE_DAYS,
  ActivityVerdictSchema,
  EventKindSchema,
  Nip46MethodSchema,
  type ActivityVerdict,
  type Nip46Method,
} from '@/features/nostrSigner/lib/nip46Types';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { mintLocalId } from '@/shared/lib/id';
import { NostrEventIdSchema, NostrPubkeyHexSchema } from '@/shared/lib/protocolIds';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantArray } from '@/shared/lib/persist/tolerant';

const profileStorage = createProfileScopedStorage();

const MAX_SUMMARY_LENGTH = 120;
const ACTIVITY_MAX_AGE_MS = ACTIVITY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/** Structured human-readable summary, computed by the engine at log time. */
export interface Nip46ActivitySummary {
  /** Headline override ("Liked a post" headline form, ≤64 chars). */
  headline?: string;
  /** Plain activity line ("Loaded its app settings", ≤120 chars). */
  line?: string;
  /** Referenced note id (reaction/repost/reply target) for detail previews. */
  refEventId?: string;
  /** Decrypt conversation peer for detail rendering. Local-only metadata. */
  refPubkey?: string;
}

export interface Nip46ActivityEntry {
  id: string;
  clientPubkey: string;
  method: Nip46Method;
  kind?: number;
  verdict: ActivityVerdict;
  /** Structured summary — the primary display copy. */
  summary?: Nip46ActivitySummary;
  /** Engine-curated raw-content snippet (never raw params) — the detail
   *  screen's fallback line for kinds `summarizeRequest` has no copy for. */
  contentPreview?: string;
  /** Signed event id, for normal-class sign_event detail views. */
  eventId?: string;
  at: number;
}

const PersistedSummary = z.looseObject({
  headline: z.string().max(64).optional(),
  line: z.string().max(MAX_SUMMARY_LENGTH).optional(),
  refEventId: NostrEventIdSchema.optional(),
  refPubkey: NostrPubkeyHexSchema.optional(),
});

const PersistedActivityEntry = z.looseObject({
  id: z.string().max(128),
  clientPubkey: NostrPubkeyHexSchema,
  method: Nip46MethodSchema,
  kind: EventKindSchema.optional(),
  verdict: ActivityVerdictSchema,
  summary: PersistedSummary.optional(),
  contentPreview: z.string().max(MAX_SUMMARY_LENGTH).optional(),
  eventId: NostrEventIdSchema.optional(),
  at: z.int().min(0),
});

const PersistedActivityStore = z.object({
  // Tolerant: this is an audit log, and `method`/`verdict` are enums that grow
  // with the protocol. Bare, a single row carrying a value this build does not
  // know — a method added in a later version, a verdict retired in an earlier
  // one — rejects the array and `createMergeWithSchema` throws the ENTIRE log
  // away. Neither field has a neutral member that could be guessed without
  // misreporting what the signer actually did, so the row is what gets dropped.
  entries: tolerantArray(PersistedActivityEntry, ACTIVITY_CAP).default([]),
});

type LogActivityInput = Omit<Nip46ActivityEntry, 'id' | 'at'> & { at?: number };

interface Nip46ActivityState {
  entries: Nip46ActivityEntry[];
}

interface Nip46ActivityActions {
  logActivity: (input: LogActivityInput) => void;
  /** Wipes the log — the hub's Reset Remote Login. */
  clearAll: () => void;
}

type Nip46ActivityStore = Nip46ActivityState & Nip46ActivityActions;

function pruneExpired(entries: Nip46ActivityEntry[], nowMs: number): Nip46ActivityEntry[] {
  const cutoff = nowMs - ACTIVITY_MAX_AGE_MS;
  return entries.filter((entry) => entry.at >= cutoff);
}

export const useNip46ActivityStore = create<Nip46ActivityStore>()(
  persist(
    (set) => ({
      entries: [],

      logActivity: (input) => {
        const { at, summary, contentPreview, ...rest } = input;
        const entry: Nip46ActivityEntry = {
          ...rest,
          ...(summary !== undefined && {
            summary: {
              ...(summary.headline !== undefined && {
                headline: summary.headline.slice(0, 64),
              }),
              ...(summary.line !== undefined && {
                line: summary.line.slice(0, MAX_SUMMARY_LENGTH),
              }),
              ...(summary.refEventId !== undefined && { refEventId: summary.refEventId }),
              ...(summary.refPubkey !== undefined && { refPubkey: summary.refPubkey }),
            },
          }),
          ...(contentPreview !== undefined && {
            contentPreview: contentPreview.slice(0, MAX_SUMMARY_LENGTH),
          }),
          id: mintLocalId('nip46'),
          at: at ?? Date.now(),
        };
        set((state) => ({ entries: [entry, ...state.entries].slice(0, ACTIVITY_CAP) }));
      },

      clearAll: () => set({ entries: [] }),
    }),
    persistConfig({
      name: 'nip46-activity-store',
      storage: profileStorage,
      schema: PersistedActivityStore,
      version: 1,
      partialize: (state) => ({ entries: state.entries }),
      afterHydrate: (state) => {
        if (!state) return;
        const pruned = pruneExpired(state.entries, Date.now());
        if (pruned.length !== state.entries.length) {
          useNip46ActivityStore.setState({ entries: pruned });
        }
      },
    })
  )
);
