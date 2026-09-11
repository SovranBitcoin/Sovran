import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { finalizeEvent } from 'nostr-tools/pure';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core';
import { z } from 'zod';
import { redactError, storeLog } from '@/shared/lib/logger';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { createNpcClient } from '@/shared/lib/cashu/npc';

import { DEFAULT_MINT_URL } from '@/shared/lib/cashu/defaultMints';

interface NpcMintState {
  /** Persisted NPC receive mint URL for the active profile. */
  mintUrl: string | undefined;
  isSyncing: boolean;
  isUpdating: boolean;
}

interface NpcMintActions {
  getActiveMintUrl: () => string;

  /**
   * Update the NPC server with a new mint URL, then cache locally.
   * Returns true on success.
   */
  updateServerMint: (newMintUrl: string, privateKey: Uint8Array) => Promise<boolean>;
}

type NpcMintStore = NpcMintState & NpcMintActions;

type V1Persisted = { mintUrls?: Record<string, string | undefined> };
type V2Persisted = { mintUrl?: string };

function npcClientForKey(privateKey: Uint8Array) {
  return createNpcClient(async (eventTemplate: EventTemplate): Promise<VerifiedEvent> =>
    finalizeEvent(eventTemplate, privateKey)
  );
}

const PersistedNpcMintStore = z.object({
  mintUrl: z.string().max(2048).optional(),
});

// v1 -> v2: legacy `mintUrls: Record<pubkey, url>` was double-scoped inside
// a store already partitioned by createProfileScopedStorage. Collapse to a
// scalar.
function v1ToV2(state: unknown): V2Persisted {
  if (!state || typeof state !== 'object' || !('mintUrls' in state)) {
    return { mintUrl: undefined };
  }
  const map = (state as V1Persisted).mintUrls;
  const first = map
    ? Object.values(map).find((v): v is string => typeof v === 'string' && v.length > 0)
    : undefined;
  return { mintUrl: first };
}

// Append-only migration chain. Zustand only calls migrate on version mismatch.
function migrateNpcMintStore(state: unknown, version: number): V2Persisted {
  let s: unknown = state;
  if (version < 2) s = v1ToV2(s);
  return s as V2Persisted;
}

export const useNpcMintStore = create<NpcMintStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        mintUrl: undefined,
        isSyncing: false,
        isUpdating: false,

        getActiveMintUrl: () => get().mintUrl ?? DEFAULT_MINT_URL,

        updateServerMint: async (newMintUrl, privateKey) => {
          if (get().isUpdating) return false;

          storeLog.info('store.npc_mint.update.start', { newMintUrl });
          const startTime = performance.now();
          set({ isUpdating: true });
          try {
            const client = npcClientForKey(privateKey);
            await client.settings.setMintUrl(newMintUrl);

            storeLog.info('store.npc_mint.update.success', {
              newMintUrl,
              duration_ms: Math.round((performance.now() - startTime) * 100) / 100,
            });
            set({ mintUrl: newMintUrl });
            return true;
          } catch (error) {
            storeLog.error('store.npc_mint.update_failed', { error: redactError(error) });
            return false;
          } finally {
            set({ isUpdating: false });
          }
        },
      }),
      persistConfig({
        name: 'npc-mint-store',
        storage: createProfileScopedStorage(),
        schema: PersistedNpcMintStore,
        logKey: 'npc_mint',
        version: 2,
        migrate: migrateNpcMintStore,
        partialize: (state) => ({ mintUrl: state.mintUrl }),
      })
    )
  )
);
