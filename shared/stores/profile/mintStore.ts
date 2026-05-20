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

type V1Persisted = { selectedMints?: Record<string, string | undefined> };
type V2Persisted = { selectedMint?: string };

const PersistedMintStore = z.object({
  selectedMint: z.string().max(2048).optional(),
});

// v1 -> v2: the storage seam (createProfileScopedStorage) already partitions
// by profile pubkey, so the inner `selectedMints` record held at most one
// meaningful entry per profile. Collapse to a scalar.
function v1ToV2(state: unknown): V2Persisted {
  if (!state || typeof state !== 'object' || !('selectedMints' in state)) {
    return { selectedMint: undefined };
  }
  const map = (state as V1Persisted).selectedMints;
  const first = map
    ? Object.values(map).find((v): v is string => typeof v === 'string' && v.length > 0)
    : undefined;
  return { selectedMint: first };
}

// Append-only migration chain. Each guard fires when the persisted blob is
// older than the step it gates. Zustand only calls migrate on a version
// mismatch, so an "already current" branch would be unreachable.
function migrateMintStore(state: unknown, version: number): V2Persisted {
  let s: unknown = state;
  if (version < 2) s = v1ToV2(s);
  return s as V2Persisted;
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
