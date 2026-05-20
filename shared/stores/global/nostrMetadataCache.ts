/**
 * Shared cache for *counterparty* Nostr kind-0 metadata. Sibling to
 * `profileStore` (which owns the user's *own* accounts and their wallet
 * state) — kept separate so the contact graph doesn't bloat the active
 * profile's serialized state and confuse its semantics.
 *
 * SWR: reads return synchronously from cache; entries older than
 * `STALE_TTL_MS` trigger a background refresh via `useNostrProfileMetadata`.
 *
 * Persisted blob is profile-scoped via `createProfileScopedStorage` so
 * profile-A's contact metadata doesn't leak into profile-B's view.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

export interface NostrProfileMetadata {
  displayName?: string;
  name?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
  about?: string;
  /** ms since epoch. `0` marks an entry as immediately stale (search seeds). */
  fetchedAt: number;
}

/** All optional metadata fields. One source of truth so adding a new
 *  field is a single-line edit instead of synchronized changes across
 *  setProfile / seedManyProfilesLowConfidence equality + merge logic. */
const METADATA_FIELDS = [
  'displayName',
  'name',
  'picture',
  'banner',
  'nip05',
  'lud16',
  'website',
  'about',
] as const;

type MetadataPartial = Partial<Omit<NostrProfileMetadata, 'fetchedAt'>>;

const STALE_TTL_MS = 24 * 60 * 60 * 1000;
/** Once an entry is this fresh, identical kind-0 events skip the write. */
const FETCHED_AT_GRACE_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;

function fieldsEqual(a: MetadataPartial, b: MetadataPartial): boolean {
  for (const k of METADATA_FIELDS) if (a[k] !== b[k]) return false;
  return true;
}

function fillMissing(existing: MetadataPartial, partial: MetadataPartial): MetadataPartial {
  const out: MetadataPartial = {};
  for (const k of METADATA_FIELDS) out[k] = existing[k] ?? partial[k];
  return out;
}

function evictIfOverCap(byPubkey: Record<string, NostrProfileMetadata>): void {
  if (Object.keys(byPubkey).length <= MAX_ENTRIES) return;
  const evictCount = Math.floor(MAX_ENTRIES * 0.1);
  const sorted = Object.entries(byPubkey).sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  for (let i = 0; i < evictCount; i++) delete byPubkey[sorted[i][0]];
  storeLog.debug('store.nostr_metadata.evicted', {
    evicted: evictCount,
    remaining: Object.keys(byPubkey).length,
  });
}

/** Subset of `NostrSearchResult` from `@sovranbitcoin/schemas` we read off
 *  search results. Declared narrowly here to keep the store decoupled
 *  from the API client's full schema. */
interface SearchResultLike {
  pubkey: string;
  profile: MetadataPartial;
}

interface NostrMetadataCacheState {
  byPubkey: Record<string, NostrProfileMetadata>;

  setProfile: (pubkey: string, metadata: MetadataPartial) => void;

  setManyProfiles: (entries: Record<string, MetadataPartial>) => void;

  /**
   * Low-confidence bulk seed for server-side search / recommendation
   * responses. Two invariants vs `setManyProfiles`:
   *   - Never overwrites existing fields — relay-sourced kind-0 always
   *     wins because it's authoritative.
   *   - New entries get `fetchedAt: 0` so the next consumer treats them
   *     as immediately stale and triggers a real kind-0 fetch. The
   *     search snapshot is a first-paint hint, not a substitute.
   */
  seedFromSearchResults: (results: SearchResultLike[]) => void;

  removeProfile: (pubkey: string) => void;

  clear: () => void;
}

/**
 * Wire shape of a Nostr kind-0 metadata event's `content` after
 * `JSON.parse`. Same fields as `NostrProfileMetadata` plus the snake_case
 * `display_name` alias the spec permits. `looseObject` ignores unknown
 * keys (relays serve all sorts of vendor extensions on kind-0). Field
 * caps come from the persisted-cache schema below — keep the two in sync.
 *
 * Exported so the runtime parse path in `useNostrProfileMetadata` shares
 * one definition with the persisted-cache validator instead of casting
 * `JSON.parse` output as a TS type.
 */
export const Kind0MetadataSchema = z.looseObject({
  display_name: z.string().max(512).optional(),
  displayName: z.string().max(512).optional(),
  name: z.string().max(512).optional(),
  picture: z.string().max(2048).optional(),
  banner: z.string().max(2048).optional(),
  nip05: z.string().max(512).optional(),
  lud16: z.string().max(512).optional(),
  website: z.string().max(2048).optional(),
  about: z.string().max(4096).optional(),
});

const PersistedNostrMetadataEntry = z.looseObject({
  displayName: z.string().max(512).optional(),
  name: z.string().max(512).optional(),
  picture: z.string().max(2048).optional(),
  banner: z.string().max(2048).optional(),
  nip05: z.string().max(512).optional(),
  lud16: z.string().max(512).optional(),
  website: z.string().max(2048).optional(),
  about: z.string().max(4096).optional(),
  fetchedAt: z.number().int().nonnegative(),
});

const PersistedNostrMetadataCache = z.object({
  byPubkey: z.record(z.string().max(128), PersistedNostrMetadataEntry).default({}),
});

export const useNostrMetadataCache = create<NostrMetadataCacheState>()(
  persist(
    (set) => ({
      byPubkey: {},

      setProfile: (pubkey, metadata) => {
        set((state) => {
          const existing = state.byPubkey[pubkey];
          if (
            existing &&
            fieldsEqual(existing, metadata) &&
            Date.now() - existing.fetchedAt < FETCHED_AT_GRACE_MS
          ) {
            return state;
          }
          const next = {
            ...state.byPubkey,
            [pubkey]: { ...metadata, fetchedAt: Date.now() },
          };
          evictIfOverCap(next);
          return { byPubkey: next };
        });
      },

      setManyProfiles: (entries) => {
        set((state) => {
          const now = Date.now();
          const next = { ...state.byPubkey };
          for (const [pubkey, metadata] of Object.entries(entries)) {
            next[pubkey] = { ...metadata, fetchedAt: now };
          }
          evictIfOverCap(next);
          return { byPubkey: next };
        });
      },

      seedFromSearchResults: (results) => {
        set((state) => {
          const next = { ...state.byPubkey };
          let changed = 0;
          let inserted = 0;
          for (const r of results) {
            if (!r.pubkey) continue;
            const existing = next[r.pubkey];
            if (existing) {
              const filled = fillMissing(existing, r.profile);
              if (!fieldsEqual(filled, existing)) {
                next[r.pubkey] = { ...filled, fetchedAt: existing.fetchedAt };
                changed++;
              }
            } else {
              next[r.pubkey] = { ...r.profile, fetchedAt: 0 };
              inserted++;
            }
          }
          if (changed === 0 && inserted === 0) return state;
          evictIfOverCap(next);
          storeLog.debug('store.nostr_metadata.seeded_from_search', {
            inserted,
            filled: changed,
          });
          return { byPubkey: next };
        });
      },

      removeProfile: (pubkey) => {
        set((state) => {
          if (!state.byPubkey[pubkey]) return state;
          const next = { ...state.byPubkey };
          delete next[pubkey];
          return { byPubkey: next };
        });
      },

      clear: () => set({ byPubkey: {} }),
    }),
    persistConfig({
      name: 'nostr-metadata-cache',
      storage: createProfileScopedStorage(),
      schema: PersistedNostrMetadataCache,
      logKey: 'nostr_metadata',
      partialize: (state) => ({ byPubkey: state.byPubkey }),
    })
  )
);

export function useCachedNostrProfile(pubkey: string): {
  metadata: NostrProfileMetadata | undefined;
  isStale: boolean;
  isMissing: boolean;
} {
  const metadata = useNostrMetadataCache((s) => s.byPubkey[pubkey]);
  const isMissing = !metadata;
  const isStale = !!metadata && Date.now() - metadata.fetchedAt > STALE_TTL_MS;
  return { metadata, isStale, isMissing };
}
