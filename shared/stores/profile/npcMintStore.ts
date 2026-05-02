import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { NPCClient, JWTAuthProvider } from 'npubcash-sdk';
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools';
import { z } from 'zod';
import { log, storeLog } from '@/shared/lib/logger';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

const NPC_BASE_URL = 'https://npubx.cash';
const NPC_DEFAULT_MINT_URL = 'https://mint.minibits.cash/Bitcoin';

interface NpcMintState {
  /** Persisted map of pubkey → NPC receive mint URL */
  mintUrls: Record<string, string | undefined>;
  /** Timestamp of last successful server sync per pubkey */
  lastSyncedAt: Record<string, number | undefined>;
  isSyncing: boolean;
  isUpdating: boolean;
}

interface NpcInfo {
  mintUrl?: string;
  mint_url?: string;
}

interface NpcMintActions {
  getActiveMintUrl: () => string | undefined;

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

function createNpcClient(privateKey: Uint8Array): NPCClient {
  const signer = async (eventTemplate: EventTemplate): Promise<VerifiedEvent> =>
    finalizeEvent(eventTemplate, privateKey);
  const authProvider = new JWTAuthProvider(NPC_BASE_URL, signer);
  return new NPCClient(NPC_BASE_URL, authProvider);
}

function getOrDefault(mintUrls: Record<string, string | undefined>, pubkey: string): string {
  return mintUrls[pubkey] ?? NPC_DEFAULT_MINT_URL;
}

function getActiveProfilePubkey(): string | undefined {
  const { activeAccountIndex, profiles } = useProfileStore.getState();
  return profiles.find((profile) => profile.accountIndex === activeAccountIndex)?.pubkey;
}

const PersistedNpcMintStore = z.object({
  mintUrls: z.record(z.string().max(128), z.string().max(2048).optional()).default({}),
  lastSyncedAt: z
    .record(z.string().max(128), z.number().int().nonnegative().optional())
    .default({}),
});

export const useNpcMintStore = create<NpcMintStore>()(
  persist(
    (set, get) => ({
      mintUrls: {},
      lastSyncedAt: {},
      isSyncing: false,
      isUpdating: false,

      getActiveMintUrl: () => {
        const pubkey = getActiveProfilePubkey();
        if (!pubkey) return undefined;
        return getOrDefault(get().mintUrls, pubkey);
      },

      syncFromServer: async (manager) => {
        const pubkey = getActiveProfilePubkey();
        if (!pubkey) return undefined;
        if (get().isSyncing) return getOrDefault(get().mintUrls, pubkey);

        storeLog.info('store.npc_mint.sync.start');
        const startTime = performance.now();
        set({ isSyncing: true });
        try {
          const npcApi = manager?.ext?.npc;
          if (!npcApi) return getOrDefault(get().mintUrls, pubkey);

          const npcInfo = await npcApi.getInfo();
          const mintUrl = npcInfo?.mintUrl ?? npcInfo?.mint_url;

          if (mintUrl) {
            storeLog.info('store.npc_mint.sync.success', {
              mintUrl,
              duration_ms: Math.round((performance.now() - startTime) * 100) / 100,
            });
            set((state) => ({
              mintUrls: { ...state.mintUrls, [pubkey]: mintUrl },
              lastSyncedAt: { ...state.lastSyncedAt, [pubkey]: Date.now() },
            }));
            return mintUrl;
          }

          return getOrDefault(get().mintUrls, pubkey);
        } catch (error) {
          log.warn('store.npc_mint.sync_failed', { error });
          return getOrDefault(get().mintUrls, pubkey);
        } finally {
          set({ isSyncing: false });
        }
      },

      updateServerMint: async (newMintUrl, privateKey) => {
        const pubkey = getActiveProfilePubkey();
        if (!pubkey) return false;
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
          set((state) => ({
            mintUrls: { ...state.mintUrls, [pubkey]: newMintUrl },
            lastSyncedAt: { ...state.lastSyncedAt, [pubkey]: Date.now() },
          }));
          return true;
        } catch (error) {
          log.error('store.npc_mint.update_failed', { error });
          return false;
        } finally {
          set({ isUpdating: false });
        }
      },
    }),
    {
      name: 'npc-mint-store',
      storage: createJSONStorage(() => createProfileScopedStorage()),
      version: 1,
      partialize: (state) => ({
        mintUrls: state.mintUrls,
        lastSyncedAt: state.lastSyncedAt,
      }),
      migrate: (state, _version) => state,
      merge: createMergeWithSchema('npc_mint', PersistedNpcMintStore),
    }
  )
);
