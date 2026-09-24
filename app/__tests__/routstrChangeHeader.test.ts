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
jest.mock('@/shared/lib/routstr/payment', () => {
  const mintRequestPayment = jest.fn(async (amountSats: number) => ({
    encoded: 'cashuB-request-payment',
    operationId: 'op-1',
    mintUrl: 'https://mint.example',
    amountSats,
  }));
  const receiveChange = jest.fn(async () => undefined);
  const reclaimUnspentPayment = jest.fn(async () => undefined);
  return { mintRequestPayment, receiveChange, reclaimUnspentPayment };
});

const payment = jest.requireMock('@/shared/lib/routstr/payment') as {
  mintRequestPayment: jest.Mock;
  receiveChange: jest.Mock;
  reclaimUnspentPayment: jest.Mock;
};

const completion = () =>
  sendMessage([{ role: 'user', content: 'hi' }], {
    model: 'test-model',
    paymentSats: 10,
    max_tokens: 4096,
  });
// A chat completion no longer carries a stored credential — it pays per
// request out of the wallet — so it is not part of this matrix. The wallet
// operations below still hold a node-issued key and still rotate it.
const operations = [
  ['balance', (key: string) => checkBalance(key)],
  ['topup', (key: string) => topUpBalance({ apiKey: key, cashuToken: 'cashuA-test-topup' })],
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

  it('banks the change before any stream chunk is consumed', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('data: [DONE]\n', { headers: { 'x-cashu': 'cashuB-test-change' } })
      );
    const { stream } = await completion();
    expect(payment.receiveChange).toHaveBeenCalledWith('cashuB-test-change');
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
      await expect(checkBalance('cashuA-test-original')).rejects.toMatchObject({ status: 401 });
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
  ])('retires a definitively rejected key without destroying it: %s', async (message) => {
    useRoutstrStore.setState({ nodeBaseUrl: 'https://old.example', balance: 250_000 });
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(401, message, ''));
    await expect(checkBalance('cashuA-test-original')).rejects.toMatchObject({ status: 401 });

    expect(useRoutstrStore.getState().apiKey).toBeNull();
    expect(useRoutstrStore.getState().balance).toBeNull();
    // The key is the only bearer instrument for whatever was deposited, and
    // this message cannot distinguish "the issuing node says it is spent" from
    // "a node that never issued it has never heard of it". Archive, so reclaim
    // can ask each node later.
    expect(useRoutstrStore.getState().legacyAccounts['https://old.example']).toMatchObject({
      apiKey: 'cashuA-test-original',
      lastKnownBalanceMsats: 250_000,
      reclaimedAt: null,
    });
  });

  it.each(['Unauthorized', 'Authentication service unavailable'])(
    'keeps the key for an ambiguous 401: %s',
    async (message) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(401, message, ''));
      await expect(checkBalance('cashuA-test-original')).rejects.toMatchObject({ status: 401 });
      expect(useRoutstrStore.getState().apiKey).toBe('cashuA-test-original');
      expect(apiLog.warn).toHaveBeenCalledWith('routstr.auth.kept_key');
    }
  );

  it('preserves returned change on a spent-key 401', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(401, 'Spent token'));
    await expect(checkBalance('cashuA-test-original')).rejects.toMatchObject({ status: 401 });
    expect(useRoutstrStore.getState().apiKey).toBe('cashuB-test-change');
  });

  it('pays a completion with a freshly minted token, not a stored key', async () => {
    // The stored key is deliberately left set: a completion must not reach for
    // it, because a key is scoped to one node and that is what stranded money.
    useRoutstrStore.setState({ authMode: 'bearer', apiKey: 'sk-should-not-be-used' });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response());
    await completion();
    expect(payment.mintRequestPayment).toHaveBeenCalledWith(10);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      'X-Cashu': 'cashuB-request-payment',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      model: 'test-model',
      max_tokens: 4096,
      stream: true,
    });
  });

  it('banks the change on a 402 and does not reclaim what the node took', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: { reason: 'Insufficient balance', amount_required_msat: 100, balance_msat: 0 },
        }),
        { status: 402, headers: { 'x-cashu': 'cashuB-test-change' } }
      )
    );
    await expect(completion()).rejects.toMatchObject({ status: 402 });
    // Routstr returns change on refusals too. Banking it is the whole point;
    // reclaiming on top would try to unspend proofs the node already redeemed.
    expect(payment.receiveChange).toHaveBeenCalledWith('cashuB-test-change');
    expect(payment.reclaimUnspentPayment).not.toHaveBeenCalled();
  });

  it('puts the payment back when the node never took it', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));
    await expect(completion()).rejects.toMatchObject({ status: 0 });
    expect(payment.reclaimUnspentPayment).toHaveBeenCalled();
  });
});
