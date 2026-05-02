import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';
import { redactError, storeLog } from '@/shared/lib/logger';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

const profileStorage = createProfileScopedStorage();

interface MintState {
  selectedMints: Record<string, string | undefined>;
}

interface MintActions {
  setSelectedMint: (pubkey: string, mintUrl: string) => void;
  getSelectedMint: (pubkey: string) => string | undefined;
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
