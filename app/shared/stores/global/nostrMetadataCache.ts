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
import type { facade } from '@sovranbitcoin/nagg-ts';
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

export const NOSTR_METADATA_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

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

interface NostrMetadataCacheState {
  /**
   * Durable mirror of the single owner (the nagg-ts entity cache). NOT read for
   * rendering — surfaces read the owner via `useCachedNostrProfile` /
   * `useProfileRecord`. This store only persists the owner's snapshot
   * (`persistOwnerSnapshot`, write-behind) so cold-start can boot-seed it back.
   */
  byPubkey: Record<string, NostrProfileMetadata>;

  /** Replace the persisted mirror with the owner's current snapshot (capped). */
  persistOwnerSnapshot: (records: Record<string, NostrProfileMetadata>) => void;

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

      persistOwnerSnapshot: (records) => {
        const next = { ...records };
        evictIfOverCap(next);
        set({ byPubkey: next });
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

/**
 * Map the single owner's CachedProfile (nagg-ts entity cache) to this module's
 * NostrProfileMetadata. `seenAt` plays `fetchedAt`'s staleness role. One place,
 * so the non-feed hooks and the persistence sidecar agree on the shape.
 */
export function cachedProfileToMetadata(
  record: facade.CachedProfile | undefined
): NostrProfileMetadata | undefined {
  if (!record) return undefined;
  return {
    name: record.name,
    displayName: record.displayName,
    picture: record.picture,
    banner: record.banner,
    nip05: record.nip05,
    lud16: record.lud16,
    website: record.website,
    about: record.about,
    fetchedAt: record.seenAt ?? 0,
  };
}

// `useCachedNostrProfile` lives in `useEntityCache` (it reads the entity-cache
// owner) so this store stays a light, dependency-free leaf — importing the
// data-layer graph here would drag it into every store consumer.
