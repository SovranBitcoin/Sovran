/**
 * @fileoverview Profile-scoped Blossom media server config.
 *
 * Where the composer uploads images/videos. Defaults to a public Blossom
 * server; user-configurable. Blossom (sha256-addressed blobs) is the default
 * because the content address maps directly to the imeta `x` field and the user
 * can point at any server (including self-hosted).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

/** Default Blossom server (BUD-02). */
const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net';

interface MediaServerState {
  server: string;
  setServer: (server: string) => void;
  restoreDefault: () => void;
}

const PersistedMediaServerStore = z.object({
  server: z.string().url().default(DEFAULT_BLOSSOM_SERVER),
});

function normalizeServer(server: string): string {
  const trimmed = server.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const useMediaServerStore = create<MediaServerState>()(
  persist(
    (set) => ({
      server: DEFAULT_BLOSSOM_SERVER,
      setServer: (server) => set({ server: normalizeServer(server) }),
      restoreDefault: () => set({ server: DEFAULT_BLOSSOM_SERVER }),
    }),
    persistConfig({
      name: 'nostr-media-server-store',
      storage: createProfileScopedStorage(),
      schema: PersistedMediaServerStore,
      logKey: 'nostr_media_server',
      partialize: (state) => ({ server: state.server }),
    })
  )
);

/** The active Blossom server, read outside React. */
export function getMediaServer(): string {
  return useMediaServerStore.getState().server;
}
