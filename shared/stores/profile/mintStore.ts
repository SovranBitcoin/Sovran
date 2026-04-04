import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { log, storeLog } from '@/shared/lib/logger';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';

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
          await profileStorage.removeItem('mint-store');
          set({ selectedMints: {} });
        } catch (error) {
          log.error('store.mint.clear_failed', { error });
          throw error;
        }
      },
    }),
    {
      name: 'mint-store',
      storage: createJSONStorage(() => profileStorage),
      partialize: (state) => ({
        selectedMints: state.selectedMints,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          log.warn('store.mint.rehydrate_failed', { error });
        }
      },
    }
  )
);
