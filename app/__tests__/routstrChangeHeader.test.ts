import {
  checkBalance,
  sendMessage,
  topUpBalance,
  setRoutstrNodeBaseUrl,
} from '@/shared/lib/routstr/api';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { apiLog, aiLog } from '@/shared/lib/logger';

let mockProfile = 0;
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

const completion = (key: string) =>
  sendMessage(key, [{ role: 'user', content: 'hi' }], { model: 'test-model', max_tokens: 4096 });
const operations = [
  ['completion', completion],
  ['balance', (key: string) => checkBalance(key)],
  ['topup', (key: string) => topUpBalance(key, 'cashuA-test-topup')],
] as const;
const response = (status = 200, message = 'upstream unavailable', change = 'cashuB-test-change') =>
  new Response(JSON.stringify(status === 200 ? { balance: 10, msats: 10 } : { detail: message }), {
    status,
    headers: { 'x-cashu': change, 'content-type': 'application/json' },
  });

describe('Routstr response credentials', () => {
  beforeEach(() => {
    mockProfile = 0;
    setRoutstrNodeBaseUrl(null);
    useRoutstrStore.setState({ apiKey: 'cashuA-test-original', balance: 999, authMode: 'bearer' });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(operations)(
    '%s adopts change on both success and error before reading the body',
    async (_, run) => {
      const fetchMock = jest.spyOn(globalThis, 'fetch');
      for (const status of [200, 402, 500]) {
        useRoutstrStore.getState().setApiKey('cashuA-test-original');
        fetchMock.mockResolvedValueOnce(response(status));
        await run('cashuA-test-original').catch(() => undefined);
        expect(useRoutstrStore.getState().apiKey).toBe('cashuB-test-change');
      }
      expect(aiLog.info).toHaveBeenCalledWith('routstr.change_token.applied');
    }
  );

  it('adopts stream headers before any stream chunk is consumed', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('data: [DONE]\n', { headers: { 'x-cashu': 'cashuB-test-change' } })
      );
    const { stream } = await completion('cashuA-test-original');
    expect(useRoutstrStore.getState().apiKey).toBe('cashuB-test-change');
    for await (const _chunk of stream) {
      /* empty fixture */
    }
  });

  it.each(operations)('%s never overwrites an sk key', async (_, run) => {
    useRoutstrStore.getState().setApiKey('sk-test');
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response());
    await run('sk-test');
    expect(useRoutstrStore.getState().apiKey).toBe('sk-test');
  });

  it.each(['profile', 'key', 'node'])(
    'rejects late response mutations after a %s change',
    async (change) => {
      jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
        if (change === 'profile') mockProfile = 1;
        if (change === 'key') useRoutstrStore.getState().setApiKey('cashuB-newer');
        if (change === 'node') setRoutstrNodeBaseUrl('https://node.example');
        return response(401, 'Expired key');
      });
      await expect(completion('cashuA-test-original')).rejects.toMatchObject({ status: 401 });
      expect(useRoutstrStore.getState().apiKey).toBe(
        change === 'key' ? 'cashuB-newer' : 'cashuA-test-original'
      );
      expect(useRoutstrStore.getState().balance).toBe(999);
    }
  );

  it.each([
    'Invalid key',
    'Expired key',
    'Spent token',
    'Unknown key',
    'Key not found',
    'Revoked key',
  ])('clears a definitively rejected key: %s', async (message) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(401, message, ''));
    await expect(completion('cashuA-test-original')).rejects.toMatchObject({ status: 401 });
    expect(useRoutstrStore.getState().apiKey).toBeNull();
    expect(useRoutstrStore.getState().balance).toBeNull();
  });

  it.each(['Unauthorized', 'Authentication service unavailable'])(
    'keeps the key for an ambiguous 401: %s',
    async (message) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(401, message, ''));
      await expect(completion('cashuA-test-original')).rejects.toMatchObject({ status: 401 });
      expect(useRoutstrStore.getState().apiKey).toBe('cashuA-test-original');
      expect(apiLog.warn).toHaveBeenCalledWith('routstr.auth.kept_key');
    }
  );

  it('preserves returned change on a spent-key 401', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(401, 'Spent token'));
    await expect(completion('cashuA-test-original')).rejects.toMatchObject({ status: 401 });
    expect(useRoutstrStore.getState().apiKey).toBe('cashuB-test-change');
  });

  it.each([
    ['bearer', 'cashuA-test-original', { Authorization: 'Bearer cashuA-test-original' }],
    ['x-cashu', 'cashuA-test-original', { 'X-Cashu': 'cashuA-test-original' }],
    ['x-cashu', 'sk-test', { Authorization: 'Bearer sk-test' }],
  ] as const)('uses %s mode for the completion credential', async (authMode, key, authHeaders) => {
    useRoutstrStore.setState({ authMode, apiKey: key });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response());
    await completion(key);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      ...authHeaders,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      model: 'test-model',
      max_tokens: 4096,
      stream: true,
    });
  });

  it('syncs 402 balance even when the response also rotates the token', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: { reason: 'Insufficient balance', amount_required_msat: 100, balance_msat: 0 },
        }),
        { status: 402, headers: { 'x-cashu': 'cashuB-test-change' } }
      )
    );
    await expect(completion('cashuA-test-original')).rejects.toMatchObject({ status: 402 });
    expect(useRoutstrStore.getState()).toMatchObject({ apiKey: 'cashuB-test-change', balance: 0 });
  });
});
