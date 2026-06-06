import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

export const MAX_RECENT_PEOPLE = 20;

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

export interface RecentPersonEntry {
  pubkey: string;
  firstOpenedAt: number;
  lastOpenedAt: number;
}

interface RecentPeopleState {
  entries: RecentPersonEntry[];
  addRecentPerson: (pubkey: string, openedAt?: number) => void;
  clearRecentPeople: () => void;
}

export function normalizeRecentPersonPubkey(pubkey: string | null | undefined): string | null {
  const normalized = pubkey?.trim().toLowerCase();
  if (!normalized || !HEX_PUBKEY_RE.test(normalized)) return null;
  return normalized;
}

export function upsertRecentPerson(
  entries: readonly RecentPersonEntry[],
  pubkey: string,
  openedAt: number = Date.now()
): RecentPersonEntry[] {
  const normalized = normalizeRecentPersonPubkey(pubkey);
  if (!normalized) return [...entries];

  const existing = entries.find((entry) => entry.pubkey === normalized);
  const nextEntry: RecentPersonEntry = {
    pubkey: normalized,
    firstOpenedAt: existing?.firstOpenedAt ?? openedAt,
    lastOpenedAt: openedAt,
  };

  return [nextEntry, ...entries.filter((entry) => entry.pubkey !== normalized)].slice(
    0,
    MAX_RECENT_PEOPLE
  );
}

const PersistedRecentPersonEntry = z.looseObject({
  pubkey: z.string().regex(HEX_PUBKEY_RE),
  firstOpenedAt: z.number().int().nonnegative(),
  lastOpenedAt: z.number().int().nonnegative(),
});

const PersistedRecentPeopleStore = z.object({
  entries: z.array(PersistedRecentPersonEntry).max(MAX_RECENT_PEOPLE).default([]),
});

export const useRecentPeopleStore = create<RecentPeopleState>()(
  persist(
    (set) => ({
      entries: [],

      addRecentPerson: (pubkey, openedAt = Date.now()) => {
        const normalized = normalizeRecentPersonPubkey(pubkey);
        if (!normalized) return;
        storeLog.debug('store.recent_people.add', { pubkey: normalized.slice(0, 8) });
        set((state) => ({ entries: upsertRecentPerson(state.entries, normalized, openedAt) }));
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
