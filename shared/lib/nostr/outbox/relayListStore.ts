/**
 * @fileoverview Profile-scoped NIP-65 relay-list store.
 *
 * Holds the active profile's own `kind:10002` relay entries (read/write
 * markers), the `created_at` of the list last ingested/published
 * (last-writer-wins), whether a list has ever been published for this profile,
 * and where the current state came from. Isolated per pubkey by
 * `createProfileScopedStorage` (no cross-profile bleed).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { DEFAULT_RELAYS, safeNormalizeRelay } from '@/shared/lib/nostr/outbox/defaults';
import type { RelayListEntry } from '@/shared/lib/nostr/outbox/nip65';

/** Where the in-memory entries came from. `local` = edited, needs publishing. */
export type RelayListSource = 'default' | 'relay' | 'local';

interface RelayListState {
  entries: RelayListEntry[];
  /** created_at of the last ingested/published list (epoch seconds). */
  updatedAt: number;
  /** True once a `kind:10002` has been published for this profile. */
  hasPublished: boolean;
  source: RelayListSource;
}

interface RelayListActions {
  /** Ingest a relay list parsed from a relay event (last-writer-wins). */
  setFromRelay: (entries: RelayListEntry[], createdAt: number) => void;
  addRelay: (url: string, marker: { read: boolean; write: boolean }) => void;
  removeRelay: (url: string) => void;
  setMarker: (url: string, marker: { read: boolean; write: boolean }) => void;
  restoreDefaults: () => void;
  markPublished: (createdAt: number) => void;
}

type RelayListStore = RelayListState & RelayListActions;

const entrySchema = z.object({
  url: z.string(),
  read: z.boolean(),
  write: z.boolean(),
});

const PersistedRelayListStore = z.object({
  entries: z.array(entrySchema).max(64).default([]),
  updatedAt: z.number().default(0),
  hasPublished: z.boolean().default(false),
  source: z.enum(['default', 'relay', 'local']).default('default'),
});

function defaultEntries(): RelayListEntry[] {
  return DEFAULT_RELAYS.map((url) => ({ url, read: true, write: true }));
}

function upsert(
  entries: readonly RelayListEntry[],
  url: string,
  marker: { read: boolean; write: boolean }
): RelayListEntry[] {
  const normalized = safeNormalizeRelay(url);
  if (!normalized) return [...entries];
  const next = entries.filter((e) => e.url !== normalized);
  if (marker.read || marker.write) {
    next.push({ url: normalized, read: marker.read, write: marker.write });
  }
  return next;
}

export const useRelayListStore = create<RelayListStore>()(
  persist(
    (set, get) => ({
      entries: [],
      updatedAt: 0,
      hasPublished: false,
      source: 'default',

      setFromRelay: (entries, createdAt) => {
        // Last-writer-wins: ignore an older or equal list than what we hold.
        if (createdAt <= get().updatedAt && get().source === 'relay') return;
        storeLog.info('nostr.relays.ingested', { count: entries.length, createdAt });
        set({ entries, updatedAt: createdAt, source: 'relay', hasPublished: true });
      },

      addRelay: (url, marker) => {
        set({ entries: upsert(get().entries, url, marker), source: 'local' });
      },

      removeRelay: (url) => {
        const normalized = safeNormalizeRelay(url) ?? url;
        set({ entries: get().entries.filter((e) => e.url !== normalized), source: 'local' });
      },

      setMarker: (url, marker) => {
        set({ entries: upsert(get().entries, url, marker), source: 'local' });
      },

      restoreDefaults: () => {
        storeLog.info('nostr.relays.restore_defaults');
        set({ entries: defaultEntries(), source: 'local' });
      },

      markPublished: (createdAt) => {
        set({ updatedAt: createdAt, hasPublished: true, source: 'relay' });
      },
    }),
    persistConfig({
      name: 'nostr-relay-list-store',
      storage: createProfileScopedStorage(),
      schema: PersistedRelayListStore,
      logKey: 'nostr_relay_list',
      partialize: (state) => ({
        entries: state.entries,
        updatedAt: state.updatedAt,
        hasPublished: state.hasPublished,
        source: state.source,
      }),
    })
  )
);

/**
 * The active profile's write relays, or the default bootstrap set when the
 * profile has no list yet. Read outside React via `getState()`.
 */
export function getOwnWriteRelays(): string[] {
  const { entries } = useRelayListStore.getState();
  const write = entries.filter((e) => e.write).map((e) => e.url);
  return write.length > 0 ? write : [...DEFAULT_RELAYS];
}
