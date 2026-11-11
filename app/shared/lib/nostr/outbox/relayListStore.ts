/**
 * @fileoverview Profile-scoped NIP-65 relay-list store.
 *
 * Holds the active profile's own `kind:10002` relay entries (read/write
 * markers), the `created_at` of the list last ingested/published
 * (last-writer-wins), whether a list has ever been published for this profile,
 * and where the current state came from. Isolated per pubkey by
 * `createProfileScopedStorage` (no cross-profile bleed).
 */
import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { DEFAULT_RELAYS, safeNormalizeRelay } from '@/shared/lib/nostr/outbox/defaults';
import type { RelayListEntry } from '@/shared/lib/nostr/outbox/nip65';

/** Where the in-memory entries came from. `local` = edited, needs publishing. */
type RelayListSource = 'default' | 'relay' | 'local';

interface RelayListState {
  entries: RelayListEntry[];
  /** created_at of the last ingested/published list (epoch seconds). */
  updatedAt: number;
  /** True once a `kind:10002` has been published for this profile. */
  hasPublished: boolean;
  source: RelayListSource;
  /**
   * In memory only, never saved: the account whose relay-list sync found no
   * list on the network in this session, so the defaults are its real list.
   */
  noListFoundFor: string | null;
}

interface RelayListActions {
  /** Ingest a relay list parsed from a relay event (last-writer-wins). */
  setFromRelay: (entries: RelayListEntry[], createdAtSec: number) => void;
  /** Add or update a relay. False, and nothing changed, when it is a new one and the list is full. */
  addRelay: (url: string, marker: { read: boolean; write: boolean }) => boolean;
  removeRelay: (url: string) => void;
  setMarker: (url: string, marker: { read: boolean; write: boolean }) => void;
  restoreDefaults: () => void;
  markPublished: (createdAtSec: number) => void;
  /** This session's sync found no relay list for `pubkey` on the network. */
  markNoListFound: (pubkey: string) => void;
}

type RelayListStore = RelayListState & RelayListActions;

const entrySchema = z.object({
  url: z.string(),
  read: z.boolean(),
  write: z.boolean(),
});

/**
 * A new relay is refused once the list holds this many. Held by `addRelay`
 * and `setMarker` only: 0.1.3 appended with no cap, so a saved list may be
 * longer, and the reader takes it whole (a limit there would discard the
 * whole configuration). A list from a relay is taken whole too.
 */
export const MAX_RELAYS = 64;

const PersistedRelayListStore = z.object({
  entries: z.array(entrySchema).default([]),
  updatedAt: z.number().default(0),
  hasPublished: z.boolean().default(false),
  // `.catch('default')`: unknown provenance degrades to "unpinned" — the
  // next ingested kind:10002 wins (last-writer guard only applies to
  // source==='relay'), converging with the relay copy. Without it one bad
  // value wipes the whole store, entries included.
  source: z.enum(['default', 'relay', 'local']).default('default').catch('default'),
});

function defaultEntries(): RelayListEntry[] {
  return DEFAULT_RELAYS.map((url) => ({ url, read: true, write: true }));
}

/** Whether writing `url` would add a new relay to a list already holding `MAX_RELAYS`. */
function wouldOverfill(entries: readonly RelayListEntry[], url: string): boolean {
  if (entries.length < MAX_RELAYS) return false;
  const normalized = safeNormalizeRelay(url);
  return normalized !== null && !entries.some((e) => e.url === normalized);
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

export const useRelayListStore = create<RelayListStore>({
  name: 'nostr-relay-list-store',
  scope: 'profile',
})(
  persist(
    (set, get) => ({
      entries: [],
      updatedAt: 0,
      hasPublished: false,
      source: 'default',
      noListFoundFor: null,

      setFromRelay: (entries, createdAtSec) => {
        // Last-writer-wins: ignore an older or equal list than what we hold.
        if (createdAtSec <= get().updatedAt && get().source === 'relay') return;
        storeLog.info('nostr.relays.ingested', { count: entries.length, createdAtSec });
        set({ entries, updatedAt: createdAtSec, source: 'relay', hasPublished: true });
      },

      addRelay: (url, marker) => {
        if (wouldOverfill(get().entries, url)) {
          storeLog.warn('nostr.relays.add_at_capacity', { max: MAX_RELAYS });
          return false;
        }
        set({ entries: upsert(get().entries, url, marker), source: 'local' });
        return true;
      },

      removeRelay: (url) => {
        const normalized = safeNormalizeRelay(url) ?? url;
        set({ entries: get().entries.filter((e) => e.url !== normalized), source: 'local' });
      },

      setMarker: (url, marker) => {
        if (wouldOverfill(get().entries, url)) return;
        set({ entries: upsert(get().entries, url, marker), source: 'local' });
      },

      restoreDefaults: () => {
        storeLog.info('nostr.relays.restore_defaults');
        set({ entries: defaultEntries(), source: 'local' });
      },

      markPublished: (createdAtSec) => {
        set({ updatedAt: createdAtSec, hasPublished: true, source: 'relay' });
      },

      markNoListFound: (pubkey) => {
        set({ noListFoundFor: pubkey });
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

/**
 * `getOwnWriteRelays` once the account's relay list is known, otherwise
 * `null`. Known means loaded for it (saved, from a relay, or edited here), or
 * found missing on the network by this session's sync, so the defaults are the
 * real answer. A store that has not loaded holds no entries and reads as the
 * defaults, which may not be where the account's lists are.
 */
export function getKnownOwnWriteRelays(pubkey: string): string[] | null {
  if (!useRelayListStore.persist.hasHydrated()) return null;
  const { entries, source, noListFoundFor } = useRelayListStore.getState();
  const known = source !== 'default' || entries.length > 0 || noListFoundFor === pubkey;
  return known ? getOwnWriteRelays() : null;
}
