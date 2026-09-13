import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

export const OwnProfileSnapshotSchema = z.object({
  content: z.record(z.string(), z.unknown()),
  createdAt: z.number().int().nonnegative(),
  eventId: z.string().length(64),
});
export type OwnProfileSnapshot = z.infer<typeof OwnProfileSnapshotSchema>;
export interface OwnProfilePatch {
  name?: string;
  picture?: string | null;
}
interface OwnProfileMetadataStore {
  latest: OwnProfileSnapshot | null;
  optimistic: (OwnProfilePatch & { createdAt: number; eventId: string }) | null;
  setLatest: (snapshot: OwnProfileSnapshot) => void;
  setOptimistic: (snapshot: OwnProfileMetadataStore['optimistic']) => void;
  clearOptimistic: (eventId: string) => void;
}
export const useOwnProfileMetadataStore = create<OwnProfileMetadataStore>()(
  persist(
    (set) => ({
      latest: null,
      optimistic: null,
      setLatest: (latest) =>
        set((state) =>
          state.latest &&
          (latest.createdAt < state.latest.createdAt || latest.eventId === state.latest.eventId)
            ? state
            : { latest }
        ),
      setOptimistic: (optimistic) => set({ optimistic }),
      clearOptimistic: (eventId) =>
        set((state) => (state.optimistic?.eventId === eventId ? { optimistic: null } : state)),
    }),
    persistConfig({
      name: 'own-profile-metadata-store',
      storage: createProfileScopedStorage(),
      schema: z.object({ latest: OwnProfileSnapshotSchema.nullable().default(null).catch(null) }),
      partialize: (state) => ({ latest: state.latest }),
    })
  )
);
