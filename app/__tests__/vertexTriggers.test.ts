import type NDK from '@nostr-dev-kit/ndk-mobile';
import { ok } from 'neverthrow';
import { refreshVertex, isVertexProfileStale } from '@/shared/lib/nostr/vertex/refreshVertex';
import { getVertexBudgetStore } from '@/shared/stores/profile/vertexBudgetStore';
import { nostrLog } from '@/shared/lib/logger';

let mockOwner = 'a'.repeat(64);
let mockEnabled = true;
let mockNaggEnabled = true;
let mockAutomation = false;
const mockSign = jest.fn();
const mockRest = jest.fn();
jest.mock('nostr', () => {
  const actual = jest.requireActual('nostr');
  return { ...actual, createNaggClient: () => ({ rest: mockRest }) };
});
jest.mock('@/shared/lib/nostr/vertex/signVertexRequest', () => ({
  signVertexRequest: (...args: unknown[]) => mockSign(...args),
  vertexAutomationDisabled: () => mockAutomation,
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ vertexCreditsEnabled: mockEnabled }) },
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({ activeAccountIndex: 0, profiles: [{ accountIndex: 0, pubkey: mockOwner }] }),
  },
}));
jest.mock('@/shared/lib/nostr/nostrTierConfig', () => ({
  getNostrTierConfig: () => ({
    nagg: { enabled: mockNaggEnabled, appViewBaseUrl: 'https://nagg.test' },
  }),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { info: jest.fn() },
  storeLog: { warn: jest.fn() },
  redactError: jest.fn(),
}));

const ndk = { signer: { user: async () => ({ pubkey: mockOwner }) } } as unknown as NDK;
const query = () => ({ kind: 'search' as const, query: 'alice', stale: true, ndk });
let counter = 0;
beforeEach(async () => {
  mockOwner = (++counter).toString(16).padStart(64, '0');
  mockEnabled = true;
  mockNaggEnabled = true;
  mockAutomation = false;
  mockSign
    .mockReset()
    .mockImplementation(async (event) =>
      ok({ ...event, pubkey: mockOwner, id: 'b'.repeat(64), sig: 'c'.repeat(128) })
    );
  mockRest.mockReset().mockResolvedValue(ok({ pubkeys: [], vertexFresh: true }));
  jest.mocked(nostrLog.info).mockClear();
  await getVertexBudgetStore(mockOwner).persist.rehydrate();
});

it('signs one stale search per normalized query, including concurrent callers', async () => {
  await Promise.all([refreshVertex(query()), refreshVertex({ ...query(), query: ' ALICE ' })]);
  await refreshVertex(query());
  expect(mockSign).toHaveBeenCalledTimes(1);
  expect(mockRest).toHaveBeenCalledTimes(1);
  expect(mockRest.mock.calls[0][0]).toMatchObject({
    path: '/nostr/search',
    refresh: true,
    searchParams: { svr: expect.any(String) },
  });
  expect(nostrLog.info).toHaveBeenCalledWith('nostr.vertex.client_request', {
    kind: 'search',
    reason: 'stale',
  });
});

it.each(['fresh', 'toggle', 'mock', 'nagg', 'budget', 'no-signer', 'cancelled'] as const)(
  'does not sign/send when %s gates the request',
  async (gate) => {
    mockEnabled = gate !== 'toggle';
    mockNaggEnabled = gate !== 'nagg';
    mockAutomation = gate === 'mock';
    if (gate === 'budget')
      getVertexBudgetStore(mockOwner).setState({
        day: new Date().toISOString().slice(0, 10),
        used: 20,
      });
    const controller = new AbortController();
    if (gate === 'cancelled') controller.abort();
    await refreshVertex({
      ...query(),
      stale: gate !== 'fresh',
      ndk: gate === 'no-signer' ? undefined : ndk,
      signal: controller.signal,
    });
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockRest).not.toHaveBeenCalled();
  }
);

it('blocks all later triggers after insufficient credits and logs exhaustion once', async () => {
  mockRest.mockResolvedValue(ok({ ok: false, reason: 'insufficient_credits' }));
  await refreshVertex(query());
  await refreshVertex({ kind: 'profile', target: 'f'.repeat(64), stale: true, ndk });
  expect(mockRest).toHaveBeenCalledTimes(1);
  expect(mockSign).toHaveBeenCalledTimes(1);
  expect(nostrLog.info).toHaveBeenCalledWith('nostr.vertex.credits_exhausted');
  expect(getVertexBudgetStore(mockOwner).getState().blockedUntilDay).toBeDefined();
});

it.each(['profile', 'consent', 'cancel'] as const)(
  'does not send after %s changes during signing',
  async (change) => {
    const controller = new AbortController();
    mockSign.mockImplementation(async (event) => {
      const owner = mockOwner;
      if (change === 'profile') mockOwner = 'e'.repeat(64);
      if (change === 'consent') mockEnabled = false;
      if (change === 'cancel') controller.abort();
      return ok({ ...event, pubkey: owner, id: 'signed', sig: 'signature' });
    });
    await refreshVertex({ ...query(), signal: controller.signal });
    expect(mockRest).not.toHaveBeenCalled();
  }
);

it('profile age uses seven days in seconds, and a stale profile signs once', async () => {
  expect(isVertexProfileStale(null)).toBe(true);
  expect(isVertexProfileStale(Math.floor(Date.now() / 1000))).toBe(false);
  expect(isVertexProfileStale(Math.floor(Date.now() / 1000) - 7 * 86400)).toBe(true);
  await refreshVertex({ kind: 'profile', target: 'f'.repeat(64), stale: true, ndk });
  await refreshVertex({ kind: 'profile', target: 'f'.repeat(64), stale: true, ndk });
  expect(mockSign).toHaveBeenCalledTimes(1);
  expect(mockSign.mock.calls[0][0].kind).toBe(5312);
});
