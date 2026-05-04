import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { NPCClient, JWTAuthProvider } from 'npubcash-sdk';
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools';
import { z } from 'zod';
import { redactError, storeLog } from '@/shared/lib/logger';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

const NPC_BASE_URL = 'https://npubx.cash';
const NPC_DEFAULT_MINT_URL = 'https://mint.minibits.cash/Bitcoin';

interface NpcMintState {
  /** Persisted NPC receive mint URL for the active profile. */
  mintUrl: string | undefined;
  isSyncing: boolean;
  isUpdating: boolean;
}

interface NpcInfo {
  mintUrl?: string;
  mint_url?: string;
}

interface NpcMintActions {
  getActiveMintUrl: () => string;

  /**
   * Fetch the current mint URL from the NPC server and cache locally.
   * Returns the mint URL on success, or the cached/default value on failure.
   */
  syncFromServer: (manager: {
    ext?: { npc?: { getInfo: () => Promise<NpcInfo> } };
  }) => Promise<string | undefined>;

  /**
   * Update the NPC server with a new mint URL, then cache locally.
   * Returns true on success.
   */
  updateServerMint: (newMintUrl: string, privateKey: Uint8Array) => Promise<boolean>;
}

type NpcMintStore = NpcMintState & NpcMintActions;

type PersistedNpcShape = { mintUrl?: string };

function createNpcClient(privateKey: Uint8Array): NPCClient {
  const signer = async (eventTemplate: EventTemplate): Promise<VerifiedEvent> =>
    finalizeEvent(eventTemplate, privateKey);
  const authProvider = new JWTAuthProvider(NPC_BASE_URL, signer);
  return new NPCClient(NPC_BASE_URL, authProvider);
}

const PersistedNpcMintStore = z.object({
  mintUrl: z.string().max(2048).optional(),
});

// v1 -> v2: legacy shape was `mintUrls: Record<pubkey, url>` keyed by the
// active profile's pubkey inside a store already scoped by that pubkey via
// createProfileScopedStorage. Collapse to a scalar; the record holds at most
// one meaningful entry per profile.
function migrateNpcMintStore(state: unknown, version: number): PersistedNpcShape {
  if (version >= 2 && state && typeof state === 'object' && 'mintUrl' in state) {
    return { mintUrl: (state as PersistedNpcShape).mintUrl };
  }
  if (state && typeof state === 'object' && 'mintUrls' in state) {
    const map = (state as { mintUrls?: Record<string, string | undefined> }).mintUrls;
    const first = map
      ? Object.values(map).find((v): v is string => typeof v === 'string' && v.length > 0)
      : undefined;
    return { mintUrl: first };
  }
  return { mintUrl: undefined };
}

export const useNpcMintStore = create<NpcMintStore>()(
  persist(
    (set, get) => ({
      mintUrl: undefined,
      isSyncing: false,
      isUpdating: false,

      getActiveMintUrl: () => get().mintUrl ?? NPC_DEFAULT_MINT_URL,

      syncFromServer: async (manager) => {
        if (get().isSyncing) return get().mintUrl ?? NPC_DEFAULT_MINT_URL;

        storeLog.info('store.npc_mint.sync.start');
        const startTime = performance.now();
        set({ isSyncing: true });
        try {
          const npcApi = manager?.ext?.npc;
          if (!npcApi) return get().mintUrl ?? NPC_DEFAULT_MINT_URL;

          const npcInfo = await npcApi.getInfo();
          const mintUrl = npcInfo?.mintUrl ?? npcInfo?.mint_url;

          if (mintUrl) {
            storeLog.info('store.npc_mint.sync.success', {
              mintUrl,
              duration_ms: Math.round((performance.now() - startTime) * 100) / 100,
            });
            set({ mintUrl });
            return mintUrl;
          }

          return get().mintUrl ?? NPC_DEFAULT_MINT_URL;
        } catch (error) {
          storeLog.warn('store.npc_mint.sync_failed', { error: redactError(error) });
          return get().mintUrl ?? NPC_DEFAULT_MINT_URL;
        } finally {
          set({ isSyncing: false });
        }
      },

      updateServerMint: async (newMintUrl, privateKey) => {
        if (get().isUpdating) return false;

        storeLog.info('store.npc_mint.update.start', { newMintUrl });
        const startTime = performance.now();
        set({ isUpdating: true });
        try {
          const client = createNpcClient(privateKey);
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
);
