import { defineVanillaStore as createStore } from '@/shared/lib/persist/defineStore';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { registerAccountScoped, liveStores } from '@/shared/lib/account/accountRegistry';
import { withSkippedPersistWrites } from '@/shared/lib/persist/profileWriteBarrier';
import { persistRegistry, persistConfig } from '@/shared/lib/persist/persistConfig';

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
  let disposed = false;
  const storage = createProfileScopedStorage(ownerPubkey);
  const writes = new Set<Promise<unknown>>();
  const store = createStore<Store>({ name: 'vertex-budget-store', scope: 'profile' })(
    persist(
      (set, get) => ({
        day: '',
        used: 0,
        reserve: (now = Date.now()) => {
          if (disposed) return false;
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
          if (disposed) return false;
          const tomorrow = dayAt(now + 86_400_000);
          const blockedUntilDay = get().blockedUntilDay;
          if (blockedUntilDay && blockedUntilDay >= tomorrow) return false;
          set({ blockedUntilDay: tomorrow });
          return true;
        },
      }),
      persistConfig({
        name: 'vertex-budget-store',
        storage: {
          ...storage,
          setItem: (name, value) => {
            const write = Promise.resolve(storage.setItem(name, value));
            writes.add(write);
            void write.then(
              () => writes.delete(write),
              () => writes.delete(write)
            );
            return write;
          },
        },
        schema,
        partialize: (state) => ({
          day: state.day,
          used: state.used,
          blockedUntilDay: state.blockedUntilDay,
        }),
      })
    )
  );
  const registration = liveStores.find((entry) => entry.store === store);
  const unregister = registerAccountScoped(
    'vertex.budget-instance',
    async () => {
      disposed = true;
      // Persist's adapter captures ownerPubkey; flush before detaching, never rehydrate as B.
      await Promise.all([...writes]);
      // Cancel any earlier hydration generation before clearing retained handles.
      await store.persist.rehydrate();
      if (!store.persist.hasHydrated()) throw new Error('Vertex budget hydration did not drain');
      withSkippedPersistWrites(() => store.setState(store.getInitialState(), true));
      store.persist.setOptions({ storage: undefined });
      if (registration) {
        const index = liveStores.indexOf(registration);
        if (index !== -1) liveStores.splice(index, 1);
      }
      for (let index = persistRegistry.length - 1; index >= 0; index--) {
        const entry = persistRegistry[index];
        if (entry?.store === store) persistRegistry.splice(index, 1);
      }
      unregister();
    },
    () => disposed && store.getState().used === 0
  );
  return store;
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

registerAccountScoped(
  'vertex.owner-stores',
  () => {
    stores.clear();
  },
  () => stores.size === 0
);
