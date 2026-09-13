import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import type { CtaDismissals, CtaId } from '@/shared/lib/cta/types';

interface CtaState {
  dismissed: CtaDismissals;
  activeId: CtaId | null;
  previewOverride: CtaId | null;
  closingId: CtaId | null;
  backupStartedAt: number | null;
  closeActive: () => void;
  startBackup: () => void;
  dismiss: (id: CtaId, forever: boolean, version?: string) => void;
  setActive: (id: CtaId | null) => void;
  preview: (id: CtaId | null) => void;
}
export const useCtaStore = create<CtaState>()(
  persist(
    (set) => ({
      dismissed: {},
      activeId: null,
      previewOverride: null,
      closingId: null,
      backupStartedAt: null,
      closeActive: () => set((state) => ({ closingId: state.activeId })),
      startBackup: () => set({ backupStartedAt: Date.now() }),
      dismiss: (id, forever, version) =>
        set((state) => ({
          dismissed: {
            ...state.dismissed,
            [forever ? id : `${id}:snooze`]: { at: Date.now(), ...(version ? { version } : {}) },
          },
        })),
      setActive: (activeId) => set({ activeId, closingId: null }),
      preview: (previewOverride) => set({ previewOverride }),
    }),
    persistConfig({
      name: 'cta-store',
      storage: AsyncStorage,
      schema: z.object({
        dismissed: z
          .record(
            z.string().max(64),
            z.object({
              at: z.number().int().nonnegative(),
              version: z.string().max(32).optional(),
            })
          )
          .default({})
          .catch({}),
      }),
      partialize: (state) => ({ dismissed: state.dismissed }),
    })
  )
);
