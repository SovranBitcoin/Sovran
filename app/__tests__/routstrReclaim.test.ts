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
let mockProfile = 0;
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: () => ({ activeAccountIndex: mockProfile }) },
}));

jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () =>
    jest.requireMock('@/shared/lib/cashu/profileScopedStorage').createProfileScopedStorage(),
}));
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
  const manager = { ops: { receive: { prepare, execute } } };
  return {
    CocoManager: { peekInstance: () => manager },
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
    mockProfile = 0;
    useRoutstrStore.setState({ legacyAccounts: {} });
  });

  const stub = (fn: (url: string) => Response) => {
    const transport = jest.fn(async (url: string) => fn(url));
    // eslint-disable-next-line no-restricted-properties -- test seam for the sweep
    global.fetch = transport as unknown as typeof fetch;
    return transport;
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

  it('ignores a late refund after the active profile changes', async () => {
    archive({ 'https://old.example': 'sk-old' });
    stub(() => {
      mockProfile = 1;
      return json(200, { token: 'cashuB-refund' });
    });
    await reclaimRoutstrBalances();
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(useRoutstrStore.getState().legacyAccounts['https://old.example'].reclaimedAt).toBeNull();
  });

  it('retains an unknown-owner credential without disclosing it to other providers', async () => {
    // Unknown ownership must not disclose bearer credentials to guessed nodes.
    archive({ unknown: 'sk-orphan' });
    const transport = stub((url) =>
      url.startsWith('https://api.routstr.com')
        ? json(200, { token: 'cashuB-recovered', sats: '250' })
        : keyNotFound()
    );

    const outcome = await reclaimRoutstrBalances();

    expect(transport).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ reclaimed: 0, deferred: 1 });
    expect(useRoutstrStore.getState().legacyAccounts.unknown.reclaimedAt).toBeNull();
  });

  it('retains a credential when its issuing provider rejects authentication', async () => {
    archive({ 'https://old.example': 'sk-empty' });
    const transport = stub(() => keyNotFound());

    const outcome = await reclaimRoutstrBalances();

    expect(outcome).toMatchObject({ reclaimed: 0, deferred: 1 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(
      useRoutstrStore.getState().legacyAccounts['https://old.example']?.reclaimedAt
    ).toBeNull();
  });

  it.each([
    [425, 'refund pending'],
    [409, 'a claim is already settling'],
    [503, 'mint unreachable'],
    [500, 'payout failed before dispatch'],
    [502, 'dispatched but unconfirmed'],
    [400, 'ongoing requests or dust'],
  ])('defers on %s (%s) and leaves the row for the next pass', async (status) => {
    archive({ 'https://old.example': 'sk-pending' });
    stub(() => json(status, { detail: 'later' }));

    const outcome = await reclaimRoutstrBalances();

    expect(outcome).toMatchObject({ reclaimed: 0, deferred: 1 });
    expect(
      useRoutstrStore.getState().legacyAccounts['https://old.example']?.reclaimedAt
    ).toBeNull();
  });

  it.each([[410, 'already swept — the money is gone']])(
    'treats %s (%s) as final',
    async (status) => {
      archive({ 'https://old.example': 'sk-terminal' });
      stub(() => json(status, { detail: 'no' }));

      const outcome = await reclaimRoutstrBalances();

      expect(outcome.deferred).toBe(0);
      expect(useRoutstrStore.getState().legacyAccounts['https://old.example']?.reclaimedAt).toEqual(
        expect.any(Number)
      );
    }
  );

  it('retains recovery when a successful response has no usable refund', async () => {
    archive({ 'https://old.example': 'sk-pending' });
    stub(() => json(200, { unexpected: true }));
    expect(await reclaimRoutstrBalances()).toMatchObject({ reclaimed: 0, deferred: 1 });
    expect(
      useRoutstrStore.getState().legacyAccounts['https://old.example']?.reclaimedAt
    ).toBeNull();
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

describe('recoverPendingPayments', () => {
  /**
   * The window this exists for: the token has left, the node has it, and the
   * app dies before reading the change header. Nothing local knows the amount,
   * so the only route back is asking the node about the ORIGINAL token.
   */
  const { recoverPendingPayments } = require('@/shared/lib/routstr/reclaim') as {
    recoverPendingPayments: () => Promise<number>;
  };
  const reclaim = jest.fn(async () => undefined);

  // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
  const realFetch = global.fetch;
  afterEach(() => {
    // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
    global.fetch = realFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockProfile = 0;
    const manager = jest.requireMock('@/shared/lib/cashu/manager') as {
      CocoManager: { peekInstance: () => unknown };
    };
    jest.spyOn(manager.CocoManager, 'peekInstance').mockReturnValue({
      ops: { receive: { prepare: mockPrepare, execute: mockExecute }, send: { reclaim } },
    });
    useRoutstrStore.setState({
      pendingPayments: {
        'op-stuck': {
          encoded: 'cashuB-paid',
          nodeBaseUrl: 'https://node.example',
          operationId: 'op-stuck',
          startedAt: 1,
        },
      },
    });
  });

  const stub = (status: number, body: unknown = {}) => {
    // eslint-disable-next-line no-restricted-properties -- test seam
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
  };

  it('collects the change the app never read', async () => {
    stub(200, { token: 'cashuB-change', sats: '7' });

    await expect(recoverPendingPayments()).resolves.toBe(1);

    expect(mockPrepare).toHaveBeenCalledWith({ token: 'cashuB-change' });
    expect(useRoutstrStore.getState().pendingPayments).toEqual({});
  });

  it('undoes the send when the node never saw the token', async () => {
    // 404 is proof of non-redemption: the proofs are still ours.
    stub(404, { detail: 'Refund not found' });

    await recoverPendingPayments();

    expect(reclaim).toHaveBeenCalledWith('op-stuck');
    expect(useRoutstrStore.getState().pendingPayments).toEqual({});
  });

  it('keeps the row while the upstream request is still running', async () => {
    // 425 means the refund row does not exist YET. Dropping the row here would
    // discard the money a moment before it became collectable.
    stub(425, { detail: 'Refund is pending; retry shortly.' });

    await expect(recoverPendingPayments()).resolves.toBe(0);

    expect(reclaim).not.toHaveBeenCalled();
    expect(useRoutstrStore.getState().pendingPayments['op-stuck']).toBeDefined();
  });

  it('stops asking once the refund has been swept', async () => {
    stub(410, { detail: 'Refund has been swept' });

    await recoverPendingPayments();

    expect(reclaim).not.toHaveBeenCalled();
    expect(useRoutstrStore.getState().pendingPayments).toEqual({});
  });

  it('keeps the row when the change cannot be banked', async () => {
    stub(200, { token: 'cashuB-change' });
    mockExecute.mockRejectedValueOnce(new Error('mint unreachable'));

    await expect(recoverPendingPayments()).resolves.toBe(0);

    // The refund is idempotent, so re-asking recovers it.
    expect(useRoutstrStore.getState().pendingPayments['op-stuck']).toBeDefined();
  });

  it('survives being offline without losing the record', async () => {
    // eslint-disable-next-line no-restricted-properties -- test seam
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    await expect(recoverPendingPayments()).resolves.toBe(0);

    expect(useRoutstrStore.getState().pendingPayments['op-stuck']).toBeDefined();
  });
});
