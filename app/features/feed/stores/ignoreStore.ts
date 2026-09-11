import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import {
  isNewerMuteList,
  mutedValues,
  normalizeDmWords,
  reconcileBlockedPeople,
  type MuteList,
} from '../lib/moderation';

const HEX64_RE = /^[0-9a-f]{64}$/;
const MAX_IGNORED_PUBKEYS = 5_000;
const MAX_IGNORED_EVENT_IDS = 10_000;

type FeedIgnoreState = {
  ignoredPubkeys: string[];
  ignoredEventIds: string[];
  muteList: MuteList | null;
  blockOverrides: Record<string, boolean>;
  dmFilterEnabled: boolean;
  dmFilterWords: string[];
};

type FeedIgnoreActions = {
  ignorePubkey: (pubkey: string) => void;
  unignorePubkey: (pubkey: string) => void;
  ignoreEvent: (eventId: string) => void;
  unignoreEvent: (eventId: string) => void;
  clearIgnoredFeedItems: () => void;
  receiveMuteList: (list: MuteList, settled?: Record<string, boolean>) => void;
  setDmFilterEnabled: (enabled: boolean) => void;
  setDmFilterWords: (words: string) => void;
};

type FeedIgnoreStore = FeedIgnoreState & FeedIgnoreActions;

export function normalizeIgnoreHex(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !HEX64_RE.test(normalized)) return null;
  return normalized;
}

function addHex(values: readonly string[], value: string, max: number): string[] {
  const normalized = normalizeIgnoreHex(value);
  if (!normalized) return normalizeHexList(values, max);
  return normalizeHexList([normalized, ...values], max);
}

function removeHex(values: readonly string[], value: string, max: number): string[] {
  const normalized = normalizeIgnoreHex(value);
  if (!normalized) return normalizeHexList(values, max);
  return normalizeHexList(
    values.filter((current) => current !== normalized),
    max
  );
}

function normalizeHexList(values: readonly string[], max: number): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const normalized = normalizeIgnoreHex(value);
    if (normalized) out.add(normalized);
    if (out.size >= max) break;
  }
  return Array.from(out);
}

export const PersistedFeedIgnoreStore = z.object({
  ignoredPubkeys: z.array(z.string().regex(HEX64_RE)).max(MAX_IGNORED_PUBKEYS).default([]),
  ignoredEventIds: z.array(z.string().regex(HEX64_RE)).max(MAX_IGNORED_EVENT_IDS).default([]),
  muteList: z
    .object({
      id: z.string().regex(HEX64_RE),
      createdAt: z.number().int().nonnegative(),
      tags: z.array(z.array(z.string())),
      privateTags: z.array(z.array(z.string())),
    })
    .nullable()
    .default(null),
  blockOverrides: z.record(z.string().regex(HEX64_RE), z.boolean()).default({}),
  dmFilterEnabled: z.boolean().default(false),
  dmFilterWords: z.array(z.string().max(100)).max(100).default([]),
});

export const useFeedIgnoreStore = create<FeedIgnoreStore>()(
  persist(
    (set, get) => ({
      ignoredPubkeys: [],
      ignoredEventIds: [],
      muteList: null,
      blockOverrides: {},
      dmFilterEnabled: false,
      dmFilterWords: [],
      setDmFilterEnabled: (dmFilterEnabled) => set({ dmFilterEnabled }),
      setDmFilterWords: (words) => set({ dmFilterWords: normalizeDmWords(words) }),
      receiveMuteList: (list, settled) => {
        const current = get();
        if (list.id !== current.muteList?.id && !isNewerMuteList(list, current.muteList)) return;
        const blockOverrides = { ...current.blockOverrides };
        for (const [pubkey, blocked] of Object.entries(settled ?? {})) {
          if (blockOverrides[pubkey] === blocked) delete blockOverrides[pubkey];
        }
        const ignoredPubkeys = reconcileBlockedPeople(
          current.ignoredPubkeys,
          current.muteList,
          list,
          blockOverrides,
          MAX_IGNORED_PUBKEYS
        );
        const previousEvents = new Set(mutedValues(current.muteList, 'e'));
        set({
          muteList: list,
          blockOverrides,
          ignoredPubkeys,
          ignoredEventIds: normalizeHexList(
            current.ignoredEventIds
              .filter((id) => !previousEvents.has(id))
              .concat(mutedValues(list, 'e')),
            MAX_IGNORED_EVENT_IDS
          ),
        });
      },

      ignorePubkey: (pubkey) => {
        const key = normalizeIgnoreHex(pubkey);
        if (!key) return;
        if (
          !get().ignoredPubkeys.includes(key) &&
          get().ignoredPubkeys.length >= MAX_IGNORED_PUBKEYS
        )
          throw new Error('Block list is full');
        const ignoredPubkeys = addHex(get().ignoredPubkeys, pubkey, MAX_IGNORED_PUBKEYS);
        storeLog.info('feed.ignore.pubkey', {
          pubkey: normalizeIgnoreHex(pubkey)?.slice(0, 8),
          count: ignoredPubkeys.length,
        });
        set({ ignoredPubkeys, blockOverrides: { ...get().blockOverrides, [key]: true } });
      },

      unignorePubkey: (pubkey) => {
        const key = normalizeIgnoreHex(pubkey);
        if (!key) return;
        const ignoredPubkeys = removeHex(get().ignoredPubkeys, pubkey, MAX_IGNORED_PUBKEYS);
        storeLog.info('feed.ignore.pubkey.clear', {
          pubkey: normalizeIgnoreHex(pubkey)?.slice(0, 8),
          count: ignoredPubkeys.length,
        });
        set({ ignoredPubkeys, blockOverrides: { ...get().blockOverrides, [key]: false } });
      },

      ignoreEvent: (eventId) => {
        const ignoredEventIds = addHex(get().ignoredEventIds, eventId, MAX_IGNORED_EVENT_IDS);
        storeLog.info('feed.ignore.event', {
          eventId: normalizeIgnoreHex(eventId)?.slice(0, 8),
          count: ignoredEventIds.length,
        });
        set({ ignoredEventIds });
      },

      unignoreEvent: (eventId) => {
        const ignoredEventIds = removeHex(get().ignoredEventIds, eventId, MAX_IGNORED_EVENT_IDS);
        storeLog.info('feed.ignore.event.clear', {
          eventId: normalizeIgnoreHex(eventId)?.slice(0, 8),
          count: ignoredEventIds.length,
        });
        set({ ignoredEventIds });
      },

      clearIgnoredFeedItems: () => set({ ignoredPubkeys: [], ignoredEventIds: [] }),
    }),
    persistConfig({
      name: 'feed-ignore-store',
      storage: createProfileScopedStorage(),
      schema: PersistedFeedIgnoreStore,
      logKey: 'feed_ignore',
      partialize: (state) => ({
        ignoredPubkeys: state.ignoredPubkeys,
        ignoredEventIds: state.ignoredEventIds,
        muteList: state.muteList,
        blockOverrides: state.blockOverrides,
        dmFilterEnabled: state.dmFilterEnabled,
        dmFilterWords: state.dmFilterWords,
      }),
    })
  )
);
