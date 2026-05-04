import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { storeLog } from '@/shared/lib/logger';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

const profileStorage = createProfileScopedStorage();

interface MintState {
  selectedMint: string | undefined;
}

interface MintActions {
  setSelectedMint: (mintUrl: string) => void;
}

type MintStore = MintState & MintActions;

type PersistedMintShape = { selectedMint?: string };

const PersistedMintStore = z.object({
  selectedMint: z.string().max(2048).optional(),
});

// v1 -> v2: the legacy `selectedMints: Record<pubkey, url>` was double-scoped
// inside an already-profile-scoped storage key, so the record holds at most
// one meaningful entry — the active profile's. Pick the first defined value.
function migrateMintStore(state: unknown, version: number): PersistedMintShape {
  if (version >= 2 && state && typeof state === 'object' && 'selectedMint' in state) {
    return { selectedMint: (state as PersistedMintShape).selectedMint };
  }
  if (state && typeof state === 'object' && 'selectedMints' in state) {
    const map = (state as { selectedMints?: Record<string, string | undefined> }).selectedMints;
    const first = map
      ? Object.values(map).find((v): v is string => typeof v === 'string' && v.length > 0)
      : undefined;
    return { selectedMint: first };
  }
  return { selectedMint: undefined };
}

export const useMintStore = create<MintStore>()(
  persist(
    (set) => ({
      selectedMint: undefined,

      setSelectedMint: (mintUrl: string) => {
        storeLog.info('store.mint.set_selected', { mintUrl });
        set({ selectedMint: mintUrl });
      },
    }),
    persistConfig({
      name: 'mint-store',
      storage: profileStorage,
      schema: PersistedMintStore,
      version: 2,
      migrate: migrateMintStore,
      partialize: (state) => ({ selectedMint: state.selectedMint }),
    })
  )
);
