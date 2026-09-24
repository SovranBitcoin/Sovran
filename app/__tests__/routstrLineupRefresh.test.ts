/* eslint-disable @typescript-eslint/no-require-imports -- Each case resets modules to exercise the runtime refresh throttle and hydration independently. */
import { ok, err } from 'neverthrow';
import type { RoutstrModel } from '@/shared/lib/routstr/api';
import fixture from './fixtures/routstr-models.fixture.json';

const mockGetAiLineup = jest.fn();
let mockProfile = 0;
jest.mock('@/shared/lib/apiClient', () => ({
  getAiLineup: (...args: unknown[]) => mockGetAiLineup(...args),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: () => ({ activeAccountIndex: mockProfile }) },
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { apiLog: log, aiLog: log, storeLog: log, log, applyFileLogging: jest.fn() };
});
jest.mock('@/shared/lib/http/requestSignal', () => ({ buildAbortSignal: () => undefined }));

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const payload = {
  version: 1,
  updatedAt: NOW,
  node: { baseUrl: 'https://active.example', authMode: 'x-cashu', fallbackUsed: true },
  providers: [
    {
      id: 'openai',
      vendor: 'openai',
      models: [
        {
          tier: 'auto',
          id: 'new-model',
          name: 'New model',
          inputModalities: ['text'],
          pricing: { maxCost: 1 },
        },
      ],
    },
  ],
};
async function load() {
  const { useRoutstrStore } =
    require('@/shared/stores/profile/routstrStore') as typeof import('@/shared/stores/profile/routstrStore');
  const { refreshRoutstrLineup } =
    require('@/shared/lib/routstr/refreshLineup') as typeof import('@/shared/lib/routstr/refreshLineup');
  const { NaggAiLineupSchema, lineupFromNaggPayload } =
    require('@/shared/lib/routstr/lineup') as typeof import('@/shared/lib/routstr/lineup');
  const parsed = NaggAiLineupSchema.parse(payload);
  const mapped = lineupFromNaggPayload(parsed);
  await useRoutstrStore.persist.rehydrate();
  useRoutstrStore.setState({
    apiKey: 'sk-test',
    nodeBaseUrl: null,
    serverLineupAt: null,
    lineup: null,
    lastKnownLineup: null,
  });
  mockGetAiLineup.mockResolvedValue(ok(parsed));
  return {
    store: useRoutstrStore,
    refresh: refreshRoutstrLineup,
    mapped,
    schema: NaggAiLineupSchema,
  };
}

jest.mock('@/shared/lib/routstr/payment', () => ({
  mintRequestPayment: jest.fn(async (amountSats: number) => ({
    encoded: 'cashuB-request-payment',
    operationId: 'op-1',
    mintUrl: 'https://mint.example',
    amountSats,
  })),
  receiveChange: jest.fn(async () => undefined),
  reclaimUnspentPayment: jest.fn(async () => undefined),
}));

describe('Routstr lineup refresh policy', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetAiLineup.mockReset();
    mockProfile = 0;
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([null, NOW - DAY_MS - 1])(
    'fetches a missing/stale lineup (%s) and applies node/auth mode',
    async (serverLineupAt) => {
      const { store, refresh } = await load();
      store.setState({ serverLineupAt });
      expect(await refresh()).toBe(true);
      expect(mockGetAiLineup).toHaveBeenCalledTimes(1);
      expect(store.getState()).toMatchObject({
        serverLineupAt: NOW,
        nodeBaseUrl: 'https://active.example',
        authMode: 'x-cashu',
        lastKnownLineup: { nodeBaseUrl: 'https://active.example' },
      });
    }
  );

  it('skips fresh lineups and refreshes on the next daily foreground', async () => {
    const { store, refresh } = await load();
    store.setState({ serverLineupAt: NOW });
    expect(await refresh()).toBe(false);
    expect(mockGetAiLineup).not.toHaveBeenCalled();
    jest.spyOn(Date, 'now').mockReturnValue(NOW + DAY_MS + 1);
    expect(await refresh()).toBe(true);
    expect(await refresh()).toBe(false);
    expect(mockGetAiLineup).toHaveBeenCalledTimes(1);
  });

  it.each([6, 8])(
    'failed refresh allows derivation only after seven days (age %s)',
    async (ageDays) => {
      const { store, refresh, mapped } = await load();
      store.getState().setServerLineup({ ...mapped, lineup: mapped.lineup! });
      store.setState({ serverLineupAt: NOW - ageDays * DAY_MS });
      mockGetAiLineup.mockResolvedValue(err(new Error('offline')));
      expect(await refresh()).toBe(false);
      expect(store.getState().serverLineupAt).toBe(ageDays > 7 ? null : NOW - ageDays * DAY_MS);
      store.getState().setCachedModels([]);
      expect(store.getState().lineup?.openai.auto?.lastKnown).toBe(ageDays > 7 ? true : undefined);
      expect(require('@/shared/lib/logger').aiLog.warn).toHaveBeenCalledWith(
        'routstr.lineup.refresh_failed'
      );
    }
  );

  it('deduplicates overlapping requests and limits forced refresh to once per five minutes', async () => {
    const { store, refresh, schema } = await load();
    store.setState({ serverLineupAt: NOW });
    let resolve!: (value: unknown) => void;
    mockGetAiLineup.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const first = refresh('failure');
    const second = refresh('failure');
    await Promise.resolve();
    resolve(ok(schema.parse(payload)));
    await Promise.all([first, second]);
    expect(await refresh('failure')).toBe(false);
    expect(mockGetAiLineup).toHaveBeenCalledTimes(1);
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 5 * 60 * 1000);
    mockGetAiLineup.mockResolvedValue(ok(schema.parse(payload)));
    expect(await refresh('failure')).toBe(true);
  });

  it.each(['catalog', 'invalidation'])(
    'keeps a pending server refresh when %s completes first',
    async (change) => {
      const { store, refresh, schema, mapped } = await load();
      if (change === 'invalidation')
        store.getState().setServerLineup({ ...mapped, lineup: mapped.lineup! });
      mockGetAiLineup.mockImplementation(async () => {
        if (change === 'invalidation') store.getState().invalidateServerLineup();
        else store.getState().setCachedModels(fixture.data as unknown as RoutstrModel[]);
        return ok(schema.parse(payload));
      });
      expect(await refresh('failure')).toBe(true);
      expect(store.getState().lineup?.openai.auto?.modelId).toBe('new-model');
    }
  );

  it('rejects a late lineup from the previous profile', async () => {
    const { store, refresh, schema } = await load();
    mockGetAiLineup.mockImplementation(async () => {
      mockProfile = 1;
      return ok(schema.parse(payload));
    });
    expect(await refresh('failure')).toBe(false);
    expect(store.getState().nodeBaseUrl).toBeNull();
  });

  it.each([400, 404])(
    'invalidates a rejected model (%s), retaining the offline snapshot',
    async (status) => {
      const { store, mapped } = await load();
      store.getState().setServerLineup({ ...mapped, lineup: mapped.lineup! });
      const snapshot = store.getState().lastKnownLineup;
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: 'new-model is unavailable' }), { status })
        );
      const { sendMessage } =
        require('@/shared/lib/routstr/api') as typeof import('@/shared/lib/routstr/api');
      await expect(sendMessage([], { model: 'new-model', paymentSats: 10 })).rejects.toMatchObject({
        status,
      });
      expect(store.getState()).toMatchObject({ serverLineupAt: null, lineup: null });
      expect(store.getState().lastKnownLineup).toBe(snapshot);
    }
  );

  it.each([404, 503, 0])(
    'refreshes immediately after /models node failure (%s)',
    async (status) => {
      const { store } = await load();
      store.setState({ serverLineupAt: NOW });
      const fetchMock = jest.spyOn(globalThis, 'fetch');
      if (status === 0) fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
      else fetchMock.mockResolvedValueOnce(new Response('{"detail":"Not found"}', { status }));
      const { getModels } =
        require('@/shared/lib/routstr/api') as typeof import('@/shared/lib/routstr/api');
      await expect(getModels()).rejects.toMatchObject({ status });
      expect(mockGetAiLineup).toHaveBeenCalledTimes(1);
      expect(store.getState().nodeBaseUrl).toBe('https://active.example');
    }
  );

  it('accepts legacy and future optional node metadata', async () => {
    const { schema } = await load();
    expect(schema.parse({ ...payload, node: { baseUrl: '' } }).node.authMode).toBeUndefined();
    expect(
      schema.parse({
        ...payload,
        node: { baseUrl: '', authMode: 'future', fallbackUsed: 'future' },
      }).node.authMode
    ).toBeUndefined();
  });
});
