/**
 * Recovering Routstr money the app holds outside the wallet after the SDK went.
 *
 * 0.1.4 (E20) kept `xcashu_tokens`, `cached_receive_tokens`, `api_keys` and
 * `child_keys` in the account's vaults through `sdk/driver.ts`. These pin how a
 * sweep treats each one: only ever sent to the node that issued it, removed
 * only once the money is in the wallet or the node gave a final answer, kept
 * and reported otherwise. The driver itself is exercised over real E20 bytes
 * in releaseFixtureE20Records.test.ts; here it is an in-memory stand-in.
 */

import {
  collectRoutstrLeftovers,
  describeRoutstrRecovery,
  readRoutstrRecoverySnapshot,
} from '@/shared/lib/routstr/recovery';
import { recoverPendingPaymentsDetailed, recoverSdkRecords } from '@/shared/lib/routstr/reclaim';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const NODE = 'https://node.example/';

let mockActive: string = OWNER;
const mockVaults = new Map<string, unknown>();
const vaultKey = (owner: string, key: string) => `${owner}:${key}`;

jest.mock('@/shared/stores/global/profileStore', () => ({
  activePubkey: () => mockActive,
  useProfileStore: {
    getState: () => ({ activeAccountIndex: mockActive === 'a'.repeat(64) ? 0 : 1 }),
  },
}));
jest.mock('@/shared/lib/routstr/sdk/driver', () => ({
  createSdkStorageDriver: (owner: string) => ({
    getItem: async (key: string, fallback: unknown) =>
      mockVaults.has(`${owner}:${key}`) ? mockVaults.get(`${owner}:${key}`) : fallback,
    setItem: async (key: string, value: unknown) => {
      mockVaults.set(`${owner}:${key}`, JSON.parse(JSON.stringify(value)));
    },
    removeItem: async (key: string) => {
      mockVaults.delete(`${owner}:${key}`);
    },
    flush: async () => undefined,
  }),
  sdkRecoveryVaultNames: () => [],
}));
jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));
jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: (e: { issues: unknown[] }) => e.issues,
}));
jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { apiLog: noop, aiLog: noop, storeLog: noop, log: noop, redactError: (e: unknown) => e };
});
jest.mock('@/shared/lib/http/requestSignal', () => ({
  DEFAULT_TIMEOUT_MS: 10_000,
  buildAbortSignal: () => undefined,
}));
const mockSpent = new Set<string>();
jest.mock('@/shared/lib/cashu/spentProbe', () => ({
  isTokenSpent: async (_manager: unknown, token: string) => mockSpent.has(token),
}));
const mockPrepare = jest.fn(async ({ token }: { token: string }) => ({ id: 'op', token }));
const mockExecute = jest.fn(async () => ({ id: 'op', state: 'completed' }));
const mockManager = { ops: { receive: { prepare: mockPrepare, execute: mockExecute } } };
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { peekInstance: () => mockManager },
}));

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// eslint-disable-next-line no-restricted-properties -- restore seam for the stub
const realFetch = global.fetch;
function stubFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const transport = jest.fn(async (url: string, init: RequestInit) => answer(url, init));
  // eslint-disable-next-line no-restricted-properties -- test seam for the sweep
  global.fetch = transport as unknown as typeof fetch;
  return transport;
}
const offline = () => {
  throw new TypeError('Network request failed');
};

const sdk = (key: string, owner = OWNER) => mockVaults.get(vaultKey(owner, key));
const seed = (key: string, value: unknown, owner = OWNER) =>
  mockVaults.set(vaultKey(owner, key), value);

beforeEach(() => {
  jest.clearAllMocks();
  mockActive = OWNER;
  mockVaults.clear();
  mockSpent.clear();
  useRoutstrStore.setState({ pendingPayments: {}, legacyAccounts: {} });
});
afterEach(() => {
  // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
  global.fetch = realFetch;
});

describe('E20 SDK records', () => {
  it('surfaces every SDK record in the account snapshot, beside the store rows', async () => {
    seed('xcashu_tokens', { [NODE]: [{ baseUrl: NODE, token: 'cashuB-request', tryCount: 2 }] });
    seed('cached_receive_tokens', [{ token: 'cashuB-cached', amount: 3, unit: 'sat' }]);
    seed('api_keys', [{ baseUrl: NODE, key: 'sk-sdk', balance: 10, lastUsed: null }]);
    seed('child_keys', [{ parentBaseUrl: NODE, childKey: 'sk-child', balance: 0, createdAt: 1 }]);
    useRoutstrStore.setState({
      pendingPayments: {
        p: { encoded: 'cashuB-p', nodeBaseUrl: NODE, operationId: 'op-p', startedAt: 1 },
      },
    });

    expect(await readRoutstrRecoverySnapshot(OWNER)).toEqual({ total: 5, unknownIssuer: 0 });
    // Another account's snapshot never counts this one's vaults.
    expect(await readRoutstrRecoverySnapshot(OTHER)).toEqual({ total: 1, unknownIssuer: 0 });
  });

  it('sweeps each record only through the node that issued it', async () => {
    seed('xcashu_tokens', { [NODE]: [{ baseUrl: NODE, token: 'cashuB-request', tryCount: 2 }] });
    seed('cached_receive_tokens', [{ token: 'cashuB-cached', amount: 3, unit: 'sat' }]);
    seed('api_keys', [{ baseUrl: NODE, key: 'sk-sdk', balance: 10, lastUsed: null }]);
    seed('child_keys', [{ parentBaseUrl: NODE, childKey: 'sk-child', balance: 0, createdAt: 1 }]);
    const transport = stubFetch((_url, init) => {
      const headers = init.headers as Record<string, string>;
      return headers['X-Cashu']
        ? json(200, { token: 'cashuB-change' })
        : json(200, { token: 'cashuB-balance' });
    });

    expect(await recoverSdkRecords()).toEqual({
      collected: 3,
      retryable: 0,
      unknownIssuer: 0,
      spentReplay: 0,
    });

    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      'https://node.example/v1/balance/refund',
      'https://node.example/v1/balance/refund',
    ]);
    expect(mockPrepare.mock.calls.map(([arg]) => arg.token)).toEqual([
      'cashuB-cached',
      'cashuB-change',
      'cashuB-balance',
    ]);
    expect(sdk('cached_receive_tokens')).toEqual([]);
    expect(sdk('xcashu_tokens')).toEqual({});
    expect(sdk('api_keys')).toEqual([]);
    // The child drew on the parent's balance, which is now in the wallet.
    expect(sdk('child_keys')).toEqual([]);
    expect(await readRoutstrRecoverySnapshot(OWNER)).toEqual({ total: 0, unknownIssuer: 0 });
  });

  it('banks the original request token when its node never saw it', async () => {
    seed('xcashu_tokens', { [NODE]: [{ baseUrl: NODE, token: 'cashuB-unseen', tryCount: 1 }] });
    stubFetch(() => json(404, { detail: 'Refund not found' }));

    expect((await recoverSdkRecords()).collected).toBe(1);
    expect(mockPrepare).toHaveBeenCalledWith({ token: 'cashuB-unseen' });
    expect(sdk('xcashu_tokens')).toEqual({});
  });

  it('keeps a record that names no node, and asks no one', async () => {
    seed('xcashu_tokens', { 'not a node': [{ token: 'cashuB-orphan', tryCount: 1 }] });
    seed('child_keys', [{ parentBaseUrl: NODE, childKey: 'sk-orphan-child', createdAt: 1 }]);
    const transport = stubFetch(() => json(200, { token: 'cashuB-x' }));

    expect(await recoverSdkRecords()).toMatchObject({ unknownIssuer: 2, collected: 0 });
    expect(transport).not.toHaveBeenCalled();
    expect(sdk('xcashu_tokens')).toEqual({
      'not a node': [{ token: 'cashuB-orphan', tryCount: 1 }],
    });
    expect(sdk('child_keys')).toHaveLength(1);
  });

  it('settles an SDK key the legacy sweep already banked, without asking again', async () => {
    seed('api_keys', [{ baseUrl: NODE, key: 'sk-shared', balance: 0, lastUsed: null }]);
    useRoutstrStore.setState({
      legacyAccounts: {
        [NODE]: { apiKey: 'sk-shared', lastKnownBalanceMsats: 0, archivedAt: 1, reclaimedAt: 2 },
      },
    });
    const transport = stubFetch(() => json(200, { token: 'cashuB-replay' }));

    await recoverSdkRecords();

    expect(transport).not.toHaveBeenCalled();
    expect(sdk('api_keys')).toEqual([]);
  });
});

describe('offline, then a later launch', () => {
  it('keeps every row while offline and collects it on the next pass', async () => {
    seed('xcashu_tokens', { [NODE]: [{ baseUrl: NODE, token: 'cashuB-request', tryCount: 2 }] });
    seed('api_keys', [{ baseUrl: NODE, key: 'sk-sdk', balance: 10, lastUsed: null }]);
    useRoutstrStore.setState({
      pendingPayments: {
        p: { encoded: 'cashuB-p', nodeBaseUrl: NODE, operationId: 'op-p', startedAt: 1 },
      },
    });
    stubFetch(offline);

    const first = await collectRoutstrLeftovers();
    expect(first).toEqual({ collected: 0, retryable: 3, unknownIssuer: 0, spentReplay: 0 });
    expect(describeRoutstrRecovery(first)).toEqual({
      kind: 'unresolved',
      message: 'Some AI nodes did not answer. Your credentials are kept — try again later.',
    });
    expect(await readRoutstrRecoverySnapshot(OWNER)).toEqual({ total: 3, unknownIssuer: 0 });

    // The next launch: the network is back.
    stubFetch(() => json(200, { token: 'cashuB-change' }));
    mockSpent.clear();
    const second = await collectRoutstrLeftovers();

    expect(second).toEqual({ collected: 3, retryable: 0, unknownIssuer: 0, spentReplay: 0 });
    expect(describeRoutstrRecovery(second)).toEqual({
      kind: 'settled',
      message: 'Collected leftover AI ecash into your wallet.',
    });
    expect(await readRoutstrRecoverySnapshot(OWNER)).toEqual({ total: 0, unknownIssuer: 0 });
  });
});

describe('a replayed refund the mint reports spent', () => {
  it('keeps the store row and reports it, rather than dropping it silently', async () => {
    useRoutstrStore.setState({
      pendingPayments: {
        p: { encoded: 'cashuB-p', nodeBaseUrl: NODE, operationId: 'op-p', startedAt: 1 },
      },
    });
    mockSpent.add('cashuB-replayed');
    stubFetch(() => json(200, { token: 'cashuB-replayed' }));

    expect(await recoverPendingPaymentsDetailed()).toEqual({
      recovered: 0,
      retryable: 0,
      unknownIssuer: 0,
      spentReplay: 1,
    });
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(useRoutstrStore.getState().pendingPayments.p).toBeDefined();
  });

  it('keeps an SDK record whose token is already spent, and says so', async () => {
    seed('cached_receive_tokens', [{ token: 'cashuB-spent', amount: 3, unit: 'sat' }]);
    mockSpent.add('cashuB-spent');

    const report = await collectRoutstrLeftovers();

    expect(report.spentReplay).toBe(1);
    expect(sdk('cached_receive_tokens')).toEqual([
      { token: 'cashuB-spent', amount: 3, unit: 'sat' },
    ]);
    expect(describeRoutstrRecovery(report).kind).toBe('unresolved');
  });
});

describe('abort and account switch', () => {
  it('stops before banking when the account switches mid-request', async () => {
    seed('xcashu_tokens', { [NODE]: [{ baseUrl: NODE, token: 'cashuB-request', tryCount: 2 }] });
    stubFetch(() => {
      mockActive = OTHER;
      return json(200, { token: 'cashuB-change' });
    });

    expect((await recoverSdkRecords()).collected).toBe(0);

    expect(mockPrepare).not.toHaveBeenCalled();
    expect(sdk('xcashu_tokens')).toEqual({
      [NODE]: [{ baseUrl: NODE, token: 'cashuB-request', tryCount: 2 }],
    });
    // Nothing was written to the account that became active either.
    expect(sdk('xcashu_tokens', OTHER)).toBeUndefined();
  });

  it('stops every sweep when its signal aborts', async () => {
    seed('api_keys', [{ baseUrl: NODE, key: 'sk-sdk', balance: 10, lastUsed: null }]);
    useRoutstrStore.setState({
      pendingPayments: {
        p: { encoded: 'cashuB-p', nodeBaseUrl: NODE, operationId: 'op-p', startedAt: 1 },
      },
    });
    const controller = new AbortController();
    const transport = stubFetch(() => {
      controller.abort();
      return json(200, { token: 'cashuB-change' });
    });

    const report = await collectRoutstrLeftovers({ signal: controller.signal });

    expect(report.collected).toBe(0);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(useRoutstrStore.getState().pendingPayments.p).toBeDefined();
    expect(sdk('api_keys')).toHaveLength(1);
  });
});
