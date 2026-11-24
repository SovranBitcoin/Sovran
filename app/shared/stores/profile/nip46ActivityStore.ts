/**
 * @fileoverview Remote Login (NIP-46) activity log, kept inert.
 *
 * The signer was removed (ADR 0035). This store stays declared under its
 * released name, storage, version and schema so an install that used it
 * still loads, keeps and wipes that saved log like any other per-profile
 * store (`releasedPersistedSurface.test.ts`). Nothing writes it; loading
 * still drops entries older than 30 days, as the released store did.
 */

import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { NostrEventIdSchema, NostrPubkeyHexSchema } from '@/shared/lib/protocolIds';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantArray } from '@/shared/lib/persist/tolerant';

const profileStorage = createProfileScopedStorage();

const ACTIVITY_CAP = 500;
const ACTIVITY_MAX_AGE_DAYS = 30;
const MAX_SUMMARY_LENGTH = 120;
const ACTIVITY_MAX_AGE_MS = ACTIVITY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const MAX_EVENT_KIND = 65535;

const EventKindSchema = z.int().min(0).max(MAX_EVENT_KIND);

// ast-grep-ignore: persisted-enum-needs-catch
const Nip46MethodSchema = z.enum([
  'connect',
  'sign_event',
  'ping',
  'get_public_key',
  'nip04_encrypt',
  'nip04_decrypt',
  'nip44_encrypt',
  'nip44_decrypt',
]);

// ast-grep-ignore: persisted-enum-needs-catch
const ActivityVerdictSchema = z.enum([
  'approved_once',
  'approved_pairing',
  'auto_approved_grant',
  'auto_approved_session',
  'auto_approved_peer_grant',
  'auto_approved_method',
  'denied_once',
  'auto_denied_blocked',
  'auto_denied_grant',
  'auto_denied_forbidden',
  'auto_denied_unauthorized',
  'auto_denied_rate_limited',
  'auto_denied_malformed',
  'expired',
]);

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

type Nip46ActivityEntry = z.output<typeof PersistedActivityStore>['entries'][number];

interface Nip46ActivityState {
  entries: Nip46ActivityEntry[];
}

function pruneExpired(entries: Nip46ActivityEntry[], nowMs: number): Nip46ActivityEntry[] {
  const cutoff = nowMs - ACTIVITY_MAX_AGE_MS;
  return entries.filter((entry) => entry.at >= cutoff);
}

export const useNip46ActivityStore = create<Nip46ActivityState>({
  name: 'nip46-activity-store',
  scope: 'profile',
})(
  persist(
    (): Nip46ActivityState => ({ entries: [] }),
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
