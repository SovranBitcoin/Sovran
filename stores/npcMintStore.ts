import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createProfileScopedStorage } from '@/helper/profileScopedStorage';
import { NPCClient, JWTAuthProvider } from 'npubcash-sdk';
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools';

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
  getMintUrl: (pubkey: string) => string | undefined;

  /**
   * Fetch the current mint URL from the NPC server and cache locally.
   * Returns the mint URL on success, or the cached/default value on failure.
   */
  syncFromServer: (
    pubkey: string,
    manager: { ext?: { npc?: { getInfo: () => Promise<NpcInfo> } } }
  ) => Promise<string | undefined>;

  /**
   * Update the NPC server with a new mint URL, then cache locally.
   * Returns true on success.
   */
  updateServerMint: (
    pubkey: string,
    newMintUrl: string,
    privateKey: Uint8Array
  ) => Promise<boolean>;
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

export const useNpcMintStore = create<NpcMintStore>()(
  persist(
    (set, get) => ({
      mintUrls: {},
      lastSyncedAt: {},
      isSyncing: false,
      isUpdating: false,

      getMintUrl: (pubkey) => getOrDefault(get().mintUrls, pubkey),

      syncFromServer: async (pubkey, manager) => {
        if (get().isSyncing) return getOrDefault(get().mintUrls, pubkey);

        set({ isSyncing: true });
        try {
          const npcApi = manager?.ext?.npc;
          if (!npcApi) return getOrDefault(get().mintUrls, pubkey);

          const npcInfo = await npcApi.getInfo();
          const mintUrl = npcInfo?.mintUrl ?? npcInfo?.mint_url;

          if (mintUrl) {
            set((state) => ({
              mintUrls: { ...state.mintUrls, [pubkey]: mintUrl },
              lastSyncedAt: { ...state.lastSyncedAt, [pubkey]: Date.now() },
            }));
            return mintUrl;
          }

          return getOrDefault(get().mintUrls, pubkey);
        } catch (error) {
          console.warn('npcMintStore: syncFromServer failed, returning cached value:', error);
          return getOrDefault(get().mintUrls, pubkey);
        } finally {
          set({ isSyncing: false });
        }
      },

      updateServerMint: async (pubkey, newMintUrl, privateKey) => {
        if (get().isUpdating) return false;

        set({ isUpdating: true });
        try {
          const client = createNpcClient(privateKey);
          await client.settings.setMintUrl(newMintUrl);

          set((state) => ({
            mintUrls: { ...state.mintUrls, [pubkey]: newMintUrl },
            lastSyncedAt: { ...state.lastSyncedAt, [pubkey]: Date.now() },
          }));
          return true;
        } catch (error) {
          console.error('npcMintStore: updateServerMint failed:', error);
          return false;
        } finally {
          set({ isUpdating: false });
        }
      },
    }),
    {
      name: 'npc-mint-store',
      storage: createJSONStorage(() => createProfileScopedStorage()),
      partialize: (state) => ({
        mintUrls: state.mintUrls,
        lastSyncedAt: state.lastSyncedAt,
      }),
    }
  )
);
