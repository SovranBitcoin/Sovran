import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantArray } from '@/shared/lib/persist/tolerant';
import type { ServerProvider } from '@/shared/lib/routstr/providers';

/**
 * @fileoverview nagg's AI provider directory, kept between openings.
 *
 * The provider list used to paint from whatever `routstrStore.knownProviders`
 * happened to hold and then re-seat itself when nagg's directory landed a
 * moment later — so every single open showed one list, then a different one.
 * The rows were never wrong; they were just being ranked twice in front of
 * the user, because the ORDER and the server's own health verdict were the one
 * thing the app threw away on unmount.
 *
 * So the directory is persisted, and the second open starts where the first
 * one finished: nagg's order, nagg's status, nagg's follower counts, all
 * present in the very first frame. The network read still happens and still
 * wins — this is a cache, and `checkedAt` is a timestamp, not a promise — but
 * it now refines a list the user is already reading instead of replacing one
 * they have only just started to.
 *
 * Deliberately NOT merged into `routstrStore`. That store owns what the user
 * has DONE — which provider they chose, what credentials they hold, what the
 * app learned first-hand about a node. This owns one server's opinion about
 * the whole network, wholesale-replaced on every read and disposable at any
 * time. Losing this costs a re-fetch; losing that costs the user something.
 */

/** nagg caps its own payload at 256 rows; match it rather than guess. */
const MAX_PROVIDERS = 256;

/**
 * How long a persisted directory is worth painting.
 *
 * Long enough that reopening the picker minutes later is instant, short enough
 * that a week-old snapshot of who was up is never shown as if it were news.
 * Past this the rows still exist in `knownProviders` — only the server's
 * ranking and its status claims expire.
 */
const DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Every field is `.catch`-tolerant and the array is per-row tolerant, so a
 * shape nagg changes underneath us costs at most the rows that changed — not
 * the blob, and not the neighbouring stores. There is no rename here to
 * migrate: this is a new key, and a future one has to bump `version`.
 */
const PersistedServerProvider = z.looseObject({
  baseUrl: z.string().min(1).max(512),
  name: z.string().max(200).optional().catch(undefined),
  pubkey: z.string().max(128).optional().catch(undefined),
  /** Absent when nagg could not resolve the operator's reach. A measured zero
   *  is a different fact and survives as `0`. */
  followers: z.number().int().nonnegative().optional().catch(undefined),
  followersSource: z.enum(['graph', 'vertex', 'relays']).optional().catch(undefined),
  modelCount: z.number().int().nonnegative().optional().catch(undefined),
  encryptedModelCount: z.number().int().nonnegative().optional().catch(undefined),
  mints: z
    .array(z.string().max(512))
    .max(64)
    .default([])
    .catch(() => []),
  status: z.enum(['online', 'offline', 'unknown']).default('unknown').catch('unknown'),
  latencyMs: z.number().nonnegative().optional().catch(undefined),
});

const PersistedAiProviderDirectory = z.object({
  providers: tolerantArray(PersistedServerProvider, MAX_PROVIDERS).default([]),
  /** Epoch ms of the read that produced `providers`, or `null` when nothing
   *  has ever been read. Never a `Date` — this blob is JSON. */
  fetchedAt: z.number().int().nonnegative().nullable().default(null).catch(null),
});

interface AiProviderDirectoryState {
  providers: ServerProvider[];
  fetchedAt: number | null;
}

interface AiProviderDirectoryActions {
  /** Replace the directory wholesale. nagg serves the complete list every
   *  time, so merging would keep providers it has since dropped. An EMPTY
   *  list is ignored: a failed or truncated read must not erase a good
   *  snapshot the way it would if it were treated as "nobody is out there". */
  rememberDirectory: (providers: readonly ServerProvider[]) => void;
}

type AiProviderDirectoryStore = AiProviderDirectoryState & AiProviderDirectoryActions;

export const useAiProviderDirectoryStore = create<AiProviderDirectoryStore>()(
  persist(
    (set) => ({
      providers: [],
      fetchedAt: null,

      rememberDirectory: (providers) => {
        if (providers.length === 0) return;
        set({ providers: providers.slice(0, MAX_PROVIDERS), fetchedAt: Date.now() });
      },
    }),
    persistConfig({
      name: 'ai-provider-directory-store',
      storage: createProfileScopedStorage(),
      schema: PersistedAiProviderDirectory,
      logKey: 'ai_provider_directory',
      partialize: (state) => ({
        providers: state.providers,
        fetchedAt: state.fetchedAt,
      }),
    })
  )
);

/** Nothing at all, shared, so a component that has no directory yet is not
 *  handed a new array identity on every render. */
const NO_PROVIDERS: readonly ServerProvider[] = [];

/**
 * The last directory worth painting.
 *
 * Returns the empty list rather than stale rows once `DIRECTORY_TTL_MS` has
 * passed, so an old snapshot of who was reachable can never be drawn as if
 * somebody had just checked.
 */
export function useAiProviderDirectory(nowMs: number): readonly ServerProvider[] {
  return useAiProviderDirectoryStore((state) =>
    state.fetchedAt != null && nowMs - state.fetchedAt <= DIRECTORY_TTL_MS
      ? state.providers
      : NO_PROVIDERS
  );
}
