let mockAccount = 0;
const mockWrites: { owner: string; value: string }[] = [];
const mockWrite = jest.fn(async () => {});
let mockFetch: jest.SpiedFunction<typeof fetch>;
const mockSend = jest.fn(async () => 'cashuB-fixture');
const mockReceive = jest.fn(async () => ({ success: true, amount: 1, unit: 'sat' as const }));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  captureProfileStorageOwner: async () => (mockAccount === 0 ? 'a' : 'b').repeat(64),
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({
      activeAccountIndex: mockAccount,
      profiles: [
        { accountIndex: 0, pubkey: 'a'.repeat(64) },
        { accountIndex: 1, pubkey: 'b'.repeat(64) },
      ],
    }),
  },
}));
jest.mock('@/shared/lib/routstr/secureVault', () => ({
  createSecureVault: (owner: string) => ({
    read: async () => null,
    write: async (value: string) => {
      await mockWrite();
      mockWrites.push({ owner, value });
    },
  }),
}));
jest.mock('@/shared/lib/routstr/sdk/walletAdapter', () => ({
  createCocoWalletAdapter: () => ({
    getBalances: async () => ({ 'https://mint.example': 100 }),
    getMintUnits: () => ({ 'https://mint.example': 'sat' }),
    getActiveMintUrl: () => 'https://mint.example',
    sendToken: mockSend,
    receiveToken: mockReceive,
  }),
}));
jest.mock('@/shared/lib/logger', () => ({ apiLog: { info: jest.fn(), warn: jest.fn() } }));

import {
  getRoutstrClient,
  resetRoutstrClient,
  sweepUnsettledPayments,
} from '@/shared/lib/routstr/sdk/client';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function request() {
  const bound = await getRoutstrClient('https://node.example');
  const response = await bound.client.routeRequest({
    path: '/v1/chat/completions',
    method: 'POST',
    baseUrl: bound.baseUrl,
    mintUrl: 'https://mint.example',
    body: { model: 'm' },
    modelId: 'm',
  });
  return { bound, response };
}

describe('Routstr payment ownership boundary', () => {
  beforeEach(() => {
    resetRoutstrClient();
    mockAccount = 0;
    mockWrites.length = 0;
    mockWrite.mockReset().mockResolvedValue();
    mockSend.mockReset().mockResolvedValue('cashuB-fixture');
    mockReceive.mockReset().mockResolvedValue({ success: true, amount: 1, unit: 'sat' });
    mockFetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        headers: { 'content-type': 'application/json', 'x-cashu': 'cashuB-change' },
      })
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not POST until the payment recovery write completes', async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    mockWrite.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
    });
    const pending = request();
    await started.promise;
    expect(mockFetch).not.toHaveBeenCalled();
    release.resolve();
    await pending;
    expect(mockWrites[0].value).toContain('cashuB-fixture');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('never POSTs when recovery storage fails', async () => {
    mockWrite.mockRejectedValueOnce(new Error('keychain unavailable'));
    await expect(request()).rejects.toThrow('Payment recovery could not be saved');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('journals a late token for its original owner and prevents dispatch after a profile switch', async () => {
    const started = deferred<void>();
    const release = deferred<string>();
    mockSend.mockImplementationOnce(async () => {
      started.resolve();
      return release.promise;
    });
    const pending = request();
    await started.promise;
    mockAccount = 1;
    release.resolve('cashuB-old-owner');
    await expect(pending).rejects.toThrow('another profile');
    expect(mockWrites).toEqual([
      { owner: 'a'.repeat(64), value: expect.stringContaining('cashuB-old-owner') },
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not report a settled payment when the SDK swallows a failed change receive', async () => {
    mockReceive.mockResolvedValueOnce({ success: false, amount: 0, unit: 'sat' });
    const { bound } = await request();
    await expect(bound.finish()).rejects.toThrow('awaiting recovery');
    expect(mockWrites.at(-1)?.value).toContain('cashuB-fixture');
  });

  it('retains recovery and refuses settlement when the receipt adapter throws', async () => {
    mockReceive.mockRejectedValueOnce(new Error('Payment belongs to another profile'));
    const { bound } = await request();
    await expect(bound.finish()).rejects.toThrow('awaiting recovery');
    expect(mockWrites.at(-1)?.value).toContain('cashuB-fixture');
  });

  it('keeps unresolved payments across repeated 404 sweeps and removes only after receipt', async () => {
    mockReceive.mockResolvedValue({ success: false, amount: 0, unit: 'sat' });
    await request();
    mockFetch.mockResolvedValue(new Response('{}', { status: 404 }));
    for (let pass = 0; pass < 4; pass += 1) await sweepUnsettledPayments();
    expect(mockWrites.at(-1)?.value).toContain('cashuB-fixture');
    mockReceive.mockResolvedValue({ success: true, amount: 1, unit: 'sat' });
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ token: 'cashuB-refund' })));
    await sweepUnsettledPayments();
    expect(mockWrites.at(-1)?.value).not.toContain('cashuB-fixture');
  });
});
