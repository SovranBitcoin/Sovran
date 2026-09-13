import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

export const VERTEX_DAILY_CAP = 20;
const dayAt = (now: number) => new Date(now).toISOString().slice(0, 10);
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  day: daySchema.or(z.literal('')).default('').catch('9999-12-31'),
  used: z.number().int().nonnegative().default(0).catch(VERTEX_DAILY_CAP),
  blockedUntilDay: daySchema.optional().catch('9999-12-31'),
});
type Budget = z.infer<typeof schema>;
type Store = Budget & {
  reserve: (now?: number) => boolean;
  block: (now?: number) => boolean;
};

/** Each instance captures its storage owner before any async work or hydration. */
export function createVertexBudgetStore(ownerPubkey: string) {
  return createStore<Store>()(
    persist(
      (set, get) => ({
        day: '',
        used: 0,
        reserve: (now = Date.now()) => {
          const today = dayAt(now);
          const state = get();
          if (state.blockedUntilDay && today < state.blockedUntilDay) return false;
          // Clock rollback must not grant a second allowance for an earlier day.
          if (state.day > today) return false;
          const used = state.day === today || state.day === '' ? state.used : 0;
          if (used >= VERTEX_DAILY_CAP) return false;
          set({ day: today, used: used + 1, blockedUntilDay: undefined });
          return true;
        },
        block: (now = Date.now()) => {
          const tomorrow = dayAt(now + 86_400_000);
          const blockedUntilDay = get().blockedUntilDay;
          if (blockedUntilDay && blockedUntilDay >= tomorrow) return false;
          set({ blockedUntilDay: tomorrow });
          return true;
        },
      }),
      persistConfig({
        name: 'vertex-budget-store',
        storage: createProfileScopedStorage(ownerPubkey),
        schema,
        partialize: (state) => ({
          day: state.day,
          used: state.used,
          blockedUntilDay: state.blockedUntilDay,
        }),
      })
    )
  );
}

const stores = new Map<string, ReturnType<typeof createVertexBudgetStore>>();
export function getVertexBudgetStore(ownerPubkey: string) {
  let store = stores.get(ownerPubkey);
  if (!store) {
    store = createVertexBudgetStore(ownerPubkey);
    stores.set(ownerPubkey, store);
  }
  return store;
}
