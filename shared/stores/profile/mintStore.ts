import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { debugLog } from '@/shared/lib/debugLog';

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
        const before = get().selectedMints;
        debugLog({
          location: 'mintStore.setSelectedMint',
          message: 'setSelectedMint called',
          phase: 'before',
          data: {
            pubkey: pubkey.slice(0, 8) + '...',
            mintUrl,
            cacheBefore: { ...before },
          },
        });
        set((state) => ({
          selectedMints: { ...state.selectedMints, [pubkey]: mintUrl },
        }));
        const after = get().selectedMints;
        debugLog({
          location: 'mintStore.setSelectedMint',
          message: 'selectedMints updated',
          phase: 'after',
          data: { mintUrl, cacheAfter: { ...after } },
        });
      },

      getSelectedMint: (pubkey: string) => get().selectedMints[pubkey],

      clearSelectedMint: (pubkey: string) => {
        const before = get().selectedMints;
        debugLog({
          location: 'mintStore.clearSelectedMint',
          message: 'clearSelectedMint called',
          phase: 'before',
          data: { pubkey: pubkey.slice(0, 8) + '...', cacheBefore: { ...before } },
        });
        set((state) => {
          const { [pubkey]: _, ...rest } = state.selectedMints;
          return { selectedMints: rest };
        });
        const after = get().selectedMints;
        debugLog({
          location: 'mintStore.clearSelectedMint',
          message: 'selectedMint cleared',
          phase: 'after',
          data: { cacheAfter: { ...after } },
        });
      },

      getAllSelectedMints: () => get().selectedMints,

      clearAllData: async () => {
        const before = get().selectedMints;
        debugLog({
          location: 'mintStore.clearAllData',
          message: 'clearAllData called — clearing profile-scoped mint store',
          phase: 'before',
          data: { cacheBefore: { ...before } },
        });
        try {
          await profileStorage.removeItem('mint-store');
          set({ selectedMints: {} });
          debugLog({
            location: 'mintStore.clearAllData',
            message: 'mint store cleared',
            phase: 'after',
            data: { cacheAfter: {} },
          });
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
