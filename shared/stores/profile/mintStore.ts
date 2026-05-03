import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { storeLog } from '@/shared/lib/logger';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

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
    persistConfig({
      name: 'mint-store',
      storage: profileStorage,
      schema: PersistedMintStore,
      partialize: (state) => ({
        selectedMints: state.selectedMints,
      }),
    })
  )
);
