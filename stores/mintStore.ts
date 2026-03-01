import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createProfileScopedStorage } from '@/helper/profileScopedStorage';

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
        set((state) => ({
          selectedMints: { ...state.selectedMints, [pubkey]: mintUrl },
        }));
      },

      getSelectedMint: (pubkey: string) => get().selectedMints[pubkey],

      clearSelectedMint: (pubkey: string) => {
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
          console.error('MintStore: Error clearing data:', error);
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
          console.warn('MintStore: Failed to rehydrate:', error);
        }
      },
    }
  )
);
