import { CTA_DEFINITIONS } from '@/shared/lib/cta/definitions';
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
  /** Bumps on every preview request so re-previewing the same id re-opens it. */
  previewSeq: number;
  preview: (id: CtaId | null) => void;
}
export const useCtaStore = create<CtaState>()(
  persist(
    (set) => ({
      dismissed: {},
      activeId: null,
      previewOverride: null,
      previewSeq: 0,
      closingId: null,
      backupStartedAt: null,
      closeActive: () => set((state) => ({ closingId: state.activeId })),
      startBackup: () => set({ backupStartedAt: Date.now() }),
      dismiss: (id, forever, version) =>
        set((state) => ({
          dismissed: {
            ...state.dismissed,
            [forever ? id : `${id}:snooze`]: {
              at: Date.now(),
              revision: CTA_DEFINITIONS.find((cta) => cta.id === id)?.revision ?? 1,
              ...(version ? { version } : {}),
            },
          },
        })),
      setActive: (activeId) => set({ activeId, closingId: null }),
      // A preview request must always open: clear any stranded active/closing
      // state from the previous CTA so CtaHost goes straight to the push branch.
      preview: (previewOverride) =>
        set((state) => ({
          previewOverride,
          previewSeq: state.previewSeq + 1,
          ...(previewOverride ? { activeId: null, closingId: null } : {}),
        })),
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
              revision: z.number().int().optional().catch(undefined),
            })
          )
          .default({})
          .catch({}),
      }),
      partialize: (state) => ({ dismissed: state.dismissed }),
    })
  )
);
