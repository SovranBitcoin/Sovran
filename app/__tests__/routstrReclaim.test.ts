/**
 * Reclaiming Routstr balances.
 *
 * Sats are sitting on nodes the user can no longer reach through the UI,
 * because the app changed node twice without moving the money. The sweep asks
 * each node for a refund and puts the token back in the wallet.
 *
 * The property that matters most is the retry/terminal split. Retrying a
 * terminal state burns requests forever; treating a transient one as final
 * loses the money. It is mapped from routstr-core's `balance.py`/`refund.py`.
 */

import { reclaimRoutstrBalances } from '@/shared/lib/routstr/reclaim';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

const mockMemory: Record<string, string> = {};

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async (k: string) => mockMemory[k] ?? null,
    setItem: async (k: string, v: string) => {
      mockMemory[k] = v;
    },
    removeItem: async (k: string) => {
      delete mockMemory[k];
    },
  }),
}));

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: (e: { issues: unknown[] }) => e.issues,
}));

jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    apiLog: noop,
    aiLog: noop,
    storeLog: noop,
    log: noop,
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

jest.mock('@/shared/lib/http/requestSignal', () => ({
  DEFAULT_TIMEOUT_MS: 10_000,
  buildAbortSignal: () => undefined,
}));

jest.mock('@/shared/lib/cashu/manager', () => {
  const prepare = jest.fn(async ({ token }: { token: string }) => ({ id: 'op', token }));
  const execute = jest.fn(async () => ({ id: 'op', state: 'completed' }));
  return {
    CocoManager: { peekInstance: () => ({ ops: { receive: { prepare, execute } } }) },
    __receive: { prepare, execute },
  };
});

const { prepare: mockPrepare, execute: mockExecute } = (
  jest.requireMock('@/shared/lib/cashu/manager') as {
    __receive: { prepare: jest.Mock; execute: jest.Mock };
  }
).__receive;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** routstr's "this node never issued that key" answer. */
const keyNotFound = () =>
  json(401, {
    detail: { error: { message: 'Key not found. Deposit first…', code: 'key_not_found' } },
  });

function archive(entries: Record<string, string>) {
  useRoutstrStore.setState({
    nodeBaseUrl: 'https://current.example',
    legacyAccounts: Object.fromEntries(
      Object.entries(entries).map(([node, apiKey]) => [
        node,
        { apiKey, lastKnownBalanceMsats: 250_000, archivedAt: 1, reclaimedAt: null },
      ])
    ),
  });
}

describe('reclaimRoutstrBalances', () => {
  // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
  const realFetch = global.fetch;
  afterEach(() => {
    // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
    global.fetch = realFetch;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    useRoutstrStore.setState({ legacyAccounts: {} });
  });

  const stub = (fn: (url: string) => Response) => {
    // eslint-disable-next-line no-restricted-properties -- test seam for the sweep
    global.fetch = jest.fn(async (url: string) => fn(url)) as unknown as typeof fetch;
  };

  it('collects a refund and puts the token in the wallet', async () => {
    archive({ 'https://old.example': 'sk-old' });
    stub((url) =>
      url.startsWith('https://old.example')
        ? json(200, { refund_id: 'r1', status: 'paid', token: 'cashuB-refund', sats: '250' })
        : keyNotFound()
    );

    const outcome = await reclaimRoutstrBalances();

    expect(mockPrepare).toHaveBeenCalledWith({ token: 'cashuB-refund' });
    expect(mockExecute).toHaveBeenCalled();
    expect(outcome).toMatchObject({ attempted: 1, reclaimed: 1, deferred: 0 });
    expect(useRoutstrStore.getState().legacyAccounts['https://old.example']?.reclaimedAt).toEqual(
      expect.any(Number)
    );
  });

  it('asks the historical nodes when the archive names the wrong one', async () => {
    // A repoint can move `nodeBaseUrl` out from under a credential before
    // anything archives it, so the recorded node is a hint. The key only
    // exists on the node that redeemed it, and asking the others is free.
    archive({ unknown: 'sk-orphan' });
    stub((url) =>
      url.startsWith('https://api.routstr.com')
        ? json(200, { token: 'cashuB-recovered', sats: '250' })
        : keyNotFound()
    );

    const outcome = await reclaimRoutstrBalances();

    expect(mockPrepare).toHaveBeenCalledWith({ token: 'cashuB-recovered' });
    expect(outcome.reclaimed).toBe(1);
  });

  it('stops asking once every node says the key holds nothing', async () => {
    archive({ 'https://old.example': 'sk-empty' });
    stub(() => keyNotFound());

    const outcome = await reclaimRoutstrBalances();

    expect(outcome).toMatchObject({ reclaimed: 0, deferred: 0 });
    expect(useRoutstrStore.getState().legacyAccounts['https://old.example']?.reclaimedAt).toEqual(
      expect.any(Number)
    );
  });

  it.each([
    [425, 'refund pending'],
    [409, 'a claim is already settling'],
    [503, 'mint unreachable'],
    [500, 'payout failed before dispatch'],
  ])('defers on %s (%s) and leaves the row for the next pass', async (status) => {
    archive({ 'https://old.example': 'sk-pending' });
    stub(() => json(status, { detail: 'later' }));

    const outcome = await reclaimRoutstrBalances();

    expect(outcome).toMatchObject({ reclaimed: 0, deferred: 1 });
    expect(
      useRoutstrStore.getState().legacyAccounts['https://old.example']?.reclaimedAt
    ).toBeNull();
  });

  it.each([
    [410, 'already swept — the money is gone'],
    [502, 'dispatched but unconfirmed — retrying risks a double spend'],
    [400, 'dust, or no balance'],
  ])('treats %s (%s) as final', async (status) => {
    archive({ 'https://old.example': 'sk-terminal' });
    stub(() => json(status, { detail: 'no' }));

    const outcome = await reclaimRoutstrBalances();

    expect(outcome.deferred).toBe(0);
    expect(useRoutstrStore.getState().legacyAccounts['https://old.example']?.reclaimedAt).toEqual(
      expect.any(Number)
    );
  });

  it('defers when the token cannot be received, so the refund can be replayed', async () => {
    // routstr's refund is idempotent: a zero-balance key with no open claim
    // replays its last paid refund, so re-asking recovers a lost token.
    archive({ 'https://old.example': 'sk-old' });
    stub((url) =>
      url.startsWith('https://old.example') ? json(200, { token: 'cashuB-refund' }) : keyNotFound()
    );
    mockExecute.mockRejectedValueOnce(new Error('mint unreachable'));

    const outcome = await reclaimRoutstrBalances();

    expect(outcome).toMatchObject({ reclaimed: 0, deferred: 1 });
    expect(
      useRoutstrStore.getState().legacyAccounts['https://old.example']?.reclaimedAt
    ).toBeNull();
  });

  it('skips rows already swept', async () => {
    useRoutstrStore.setState({
      legacyAccounts: {
        'https://done.example': {
          apiKey: 'sk-done',
          lastKnownBalanceMsats: 0,
          archivedAt: 1,
          reclaimedAt: 2,
        },
      },
    });
    stub(() => json(200, { token: 'cashuB-should-not-happen' }));

    const outcome = await reclaimRoutstrBalances();

    expect(outcome).toMatchObject({ attempted: 0, reclaimed: 0 });
    expect(mockPrepare).not.toHaveBeenCalled();
  });
});
