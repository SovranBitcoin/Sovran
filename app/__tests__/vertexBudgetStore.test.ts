import {
  createVertexBudgetStore,
  VERTEX_DAILY_CAP,
} from '@/shared/stores/profile/vertexBudgetStore';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';

const mockStorage = new Map<string, string>();
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: (owner: string) => ({
    getItem: async (key: string) => mockStorage.get(`${owner}:${key}`) ?? null,
    setItem: async (key: string, value: string) => {
      mockStorage.set(`${owner}:${key}`, value);
    },
    removeItem: async (key: string) => {
      mockStorage.delete(`${owner}:${key}`);
    },
  }),
}));
jest.mock('@/shared/lib/logger', () => ({
  storeLog: { warn: jest.fn(), info: jest.fn() },
  redactError: jest.fn(),
}));
const today = Date.parse('2026-09-13T12:00:00Z');
beforeEach(() => mockStorage.clear());

it('caps requests, rolls forward at UTC midnight, and prevents clock rollback grants', async () => {
  const store = createVertexBudgetStore('alice');
  await store.persist.rehydrate();
  for (let i = 0; i < VERTEX_DAILY_CAP; i++) expect(store.getState().reserve(today)).toBe(true);
  expect(store.getState().reserve(today)).toBe(false);
  expect(store.getState().reserve(today - 86_400_000)).toBe(false);
  expect(store.getState().reserve(Date.parse('2026-09-14T00:00:00Z'))).toBe(true);
  expect(store.getState()).toMatchObject({ day: '2026-09-14', used: 1 });
});

it('blocks until tomorrow, once, surviving hydration', async () => {
  const store = createVertexBudgetStore('alice');
  await store.persist.rehydrate();
  expect(store.getState().block(today)).toBe(true);
  expect(store.getState().block(today)).toBe(false);
  const restored = createVertexBudgetStore('alice');
  await restored.persist.rehydrate();
  expect(restored.getState().reserve(today)).toBe(false);
  expect(restored.getState().reserve(today + 86_400_000)).toBe(true);
});

it('isolates runtime and delayed persisted writes by captured owner', async () => {
  const alice = createVertexBudgetStore('alice');
  const bob = createVertexBudgetStore('bob');
  await Promise.all([alice.persist.rehydrate(), bob.persist.rehydrate()]);
  alice.getState().reserve(today);
  bob.getState().reserve(today);
  alice.getState().block(today);
  expect(bob.getState().blockedUntilDay).toBeUndefined();
  const restored = createVertexBudgetStore('alice');
  await restored.persist.rehydrate();
  expect(restored.getState()).toMatchObject({ used: 1, blockedUntilDay: '2026-09-14' });
});

it('round-trips populated data and tolerates corrupt counters without granting credits', async () => {
  const store = createVertexBudgetStore('alice');
  await store.persist.rehydrate();
  store.getState().reserve(today);
  store.getState().block(today);
  const entry = persistRegistry.find((e) => e.name === 'vertex-budget-store')!;
  const data = JSON.parse(JSON.stringify(store.persist.getOptions().partialize!(store.getState())));
  expect(entry.schema.parse(data)).toEqual({
    day: '2026-09-13',
    used: 1,
    blockedUntilDay: '2026-09-14',
  });
  expect(entry.schema.parse({ day: '2026-09-13', used: 'invalid' })).toMatchObject({ used: 20 });
});
