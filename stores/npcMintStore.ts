import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createProfileScopedStorage } from '@/helper/profileScopedStorage';
import { NPCClient, JWTAuthProvider } from 'npubcash-sdk';
import { finalizeEvent } from 'nostr-tools';

const NPC_BASE_URL = 'https://npubx.cash';
const NPC_DEFAULT_MINT_URL = 'https://mint.minibits.cash/Bitcoin';

interface NpcMintState {
  /** Persisted map of pubkey → NPC receive mint URL */
  mintUrls: Record<string, string | undefined>;
  /** Timestamp of last successful server sync per pubkey */
  lastSyncedAt: Record<string, number | undefined>;
  /** Whether a sync from server is in progress */
  isSyncing: boolean;
  /** Whether an update to the server is in progress */
  isUpdating: boolean;
}

interface NpcMintActions {
  /** Read the locally cached NPC mint URL (works offline) */
  getMintUrl: (pubkey: string) => string | undefined;

  /**
   * Fetch the current mint URL from the NPC server and cache it locally.
   * Returns the mint URL on success, or the cached value on failure.
   */
  syncFromServer: (pubkey: string, manager: any) => Promise<string | undefined>;

  /**
   * Update the NPC server with a new mint URL, then cache it locally.
   * Returns true on success, false on failure.
   */
  updateServerMint: (
    pubkey: string,
    newMintUrl: string,
    privateKey: Uint8Array
  ) => Promise<boolean>;
}

type NpcMintStore = NpcMintState & NpcMintActions;

/** Build an authenticated NPCClient from a Nostr private key */
function createNpcClient(privateKey: Uint8Array): NPCClient {
  const signer = async (eventTemplate: any) => finalizeEvent(eventTemplate, privateKey);
  const authProvider = new JWTAuthProvider(NPC_BASE_URL, signer);
  return new NPCClient(NPC_BASE_URL, authProvider);
}

export const useNpcMintStore = create<NpcMintStore>()(
  persist(
    (set, get) => ({
      // --- persisted state ---
      mintUrls: {},
      lastSyncedAt: {},

      // --- transient state ---
      isSyncing: false,
      isUpdating: false,

      // --- actions ---
      getMintUrl: (pubkey: string) => get().mintUrls[pubkey] ?? NPC_DEFAULT_MINT_URL,

      syncFromServer: async (pubkey: string, manager: any) => {
        const { isSyncing } = get();
        if (isSyncing) return get().mintUrls[pubkey] ?? NPC_DEFAULT_MINT_URL;

        set({ isSyncing: true });
        try {
          const npcApi = manager?.ext?.npc;
          if (!npcApi) return get().mintUrls[pubkey] ?? NPC_DEFAULT_MINT_URL;

          const npcInfo = await npcApi.getInfo();
          const mintUrl: string | undefined =
            (npcInfo as any)?.mintUrl ?? (npcInfo as any)?.mint_url;

          if (mintUrl) {
            set((state) => ({
              mintUrls: { ...state.mintUrls, [pubkey]: mintUrl },
              lastSyncedAt: { ...state.lastSyncedAt, [pubkey]: Date.now() },
            }));
            return mintUrl;
          }

          return get().mintUrls[pubkey] ?? NPC_DEFAULT_MINT_URL;
        } catch (error) {
          console.warn('npcMintStore: syncFromServer failed, returning cached value:', error);
          return get().mintUrls[pubkey] ?? NPC_DEFAULT_MINT_URL;
        } finally {
          set({ isSyncing: false });
        }
      },

      updateServerMint: async (
        pubkey: string,
        newMintUrl: string,
        privateKey: Uint8Array
      ): Promise<boolean> => {
        const { isUpdating } = get();
        if (isUpdating) return false;

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
