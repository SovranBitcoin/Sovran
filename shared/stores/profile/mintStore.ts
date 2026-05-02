import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';
import { redactError, storeLog } from '@/shared/lib/logger';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { clearPersistedStore } from '@/shared/lib/persist/clearPersistedStore';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

const profileStorage = createProfileScopedStorage();

interface MintState {
  selectedMints: Record<string, string | undefined>;
}

interface MintActions {
  setSelectedMint: (pubkey: string, mintUrl: string) => void;
  getSelectedMint: (pubkey: string) => string | undefined;
  clearSelectedMint: (pubkey: string) => void;
  getAllSelectedMints: () => Record<string, string | undefined>;
  clearAllData: () => Promise<void>;
}

type MintStore = MintState & MintActions;

const PersistedMintStore = z.object({
  selectedMints: z.record(z.string().max(128), z.string().max(2048).optional()).default({}),
});

export const useMintStore = create<MintStore>()(
  persist(
    (set, get) => ({
      selectedMints: {},

      setSelectedMint: (pubkey: string, mintUrl: string) => {
        storeLog.info('store.mint.set_selected', { mintUrl });
        set((state) => ({
          selectedMints: { ...state.selectedMints, [pubkey]: mintUrl },
        }));
      },

      getSelectedMint: (pubkey: string) => get().selectedMints[pubkey],

      clearSelectedMint: (pubkey: string) => {
        storeLog.info('store.mint.clear_selected');
        set((state) => {
          const { [pubkey]: _, ...rest } = state.selectedMints;
          return { selectedMints: rest };
        });
      },

      getAllSelectedMints: () => get().selectedMints,

      clearAllData: async () => {
        try {
          await clearPersistedStore(useMintStore, { selectedMints: {} });
        } catch (error) {
          storeLog.error('store.mint.clear_failed', { error: redactError(error) });
          throw error;
        }
      },
    }),
    {
      name: 'mint-store',
      storage: createJSONStorage(() => profileStorage),
      version: 1,
      partialize: (state) => ({
        selectedMints: state.selectedMints,
      }),
      migrate: (state, _version) => state,
      merge: createMergeWithSchema('mint', PersistedMintStore),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          storeLog.warn('store.mint.rehydrate_failed', { error: redactError(error) });
        }
      },
    }
  )
);
