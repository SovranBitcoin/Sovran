/**
 * @fileoverview NIP-46 Activity Store
 *
 * Persisted, profile-scoped log of signer request outcomes, newest first.
 * Capped at ACTIVITY_CAP (tail-evict oldest) plus a 30-day prune after
 * rehydration.
 *
 * Redaction contract: entries structurally cannot carry request params,
 * plaintexts, ciphertexts, or full event JSON — only the engine-supplied
 * `summary` (≤120 chars, normal-class sign_event only) and the signed
 * event id ever land here.
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
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

const profileStorage = createProfileScopedStorage();

const MAX_SUMMARY_LENGTH = 120;
const ACTIVITY_MAX_AGE_MS = ACTIVITY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export interface Nip46ActivityEntry {
  id: string;
  clientPubkey: string;
  method: Nip46Method;
  kind?: number;
  verdict: ActivityVerdict;
  /** Engine-curated display snippet — never raw params. */
  summary?: string;
  /** Signed event id, for normal-class sign_event detail views. */
  eventId?: string;
  at: number;
}

// `isNostrPubkeyHex` is a generic 64-hex-char gate — event ids share the shape.
const Hex64Schema = z.custom<string>(isNostrPubkeyHex, 'invalid 64-hex id');

const PersistedActivityEntry = z.looseObject({
  id: z.string().max(128),
  clientPubkey: Hex64Schema,
  method: Nip46MethodSchema,
  kind: EventKindSchema.optional(),
  verdict: ActivityVerdictSchema,
  summary: z.string().max(MAX_SUMMARY_LENGTH).optional(),
  eventId: Hex64Schema.optional(),
  at: z.int().min(0),
});

const PersistedActivityStore = z.object({
  entries: z.array(PersistedActivityEntry).max(ACTIVITY_CAP).default([]),
});

export type LogActivityInput = Omit<Nip46ActivityEntry, 'id' | 'at'> & { at?: number };

interface Nip46ActivityState {
  entries: Nip46ActivityEntry[];
}

interface Nip46ActivityActions {
  logActivity: (input: LogActivityInput) => void;
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
        const { at, summary, ...rest } = input;
        const entry: Nip46ActivityEntry = {
          ...rest,
          ...(summary !== undefined && { summary: summary.slice(0, MAX_SUMMARY_LENGTH) }),
          id: mintLocalId('nip46'),
          at: at ?? Date.now(),
        };
        set((state) => ({ entries: [entry, ...state.entries].slice(0, ACTIVITY_CAP) }));
      },
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
