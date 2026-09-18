import { describe, expect, it, vi } from 'vitest';
import {
  Amount,
  MintOperationError,
  NetworkError,
  OperationInProgressError,
  ProofValidationError,
} from '@cashu/coco-core';

import { createRebalanceEngine } from '../../src/rebalance/engine';
import { RebalanceMeltRolledBackError, RebalanceRoutesExhaustedError } from '../../src/rebalance/errors';
import { createRebalanceLock } from '../../src/rebalance/lock';
import type {
  RebalanceClock,
  RebalanceEventSink,
  RebalanceLegUpdate,
  RebalanceMintReceipt,
  RebalanceMintSnapshot,
  RebalanceRoute,
  RebalanceTransfer,
  RebalanceWalletPort,
} from '../../src/rebalance/types';

const SOURCE = 'https://source.example';
const DESTINATION = 'https://destination.example';
const MIDDLEMAN = 'https://middleman.example';
const STEP: RebalanceTransfer = {
  id: 'step-1',
  fromMintUrl: SOURCE,
  toMintUrl: DESTINATION,
  amount: 100,
};

function fakeClock(): RebalanceClock & { elapsed: () => number } {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      await Promise.resolve();
    },
    elapsed: () => now,
  };
}

/**
 * In-memory wallet: receipts finalize when their invoice is paid, melts
 * finalize on execute unless a test overrides the behaviour.
 */
function fakeWallet(balances: Record<string, number> = { [SOURCE]: 1000 }) {
  const receipts = new Map<string, RebalanceMintReceipt & { state: string }>();
  let nextReceipt = 0;
  let nextMelt = 0;
  const invoiceByMelt = new Map<string, string>();
  const payInvoice = (invoice: string) => {
    for (const receipt of receipts.values()) {
      if (receipt.request === invoice) receipt.state = 'finalized';
    }
  };
  const port = {
    balancesByMint: vi.fn(async () => ({ ...balances })),
    worstCaseInputFee: vi.fn(async (_mintUrl: string) => 0),
    probeMeltFeeReserve: vi.fn(async (_mintUrl: string, _invoice: string) => 0),
    createMintReceipt: vi.fn(async (mintUrl: string, amount: number) => {
      const quoteId = `quote-${++nextReceipt}`;
      const receipt = {
        id: `mint-${quoteId}`,
        quoteId,
        mintUrl,
        method: 'bolt11',
        unit: 'sat',
        amount: Amount.from(amount),
        request: `invoice-${quoteId}`,
        state: 'pending',
      };
      receipts.set(receipt.id, receipt);
      return receipt;
    }),
    getMintOperation: vi.fn(
      async (operationId: string): Promise<RebalanceMintSnapshot | null> =>
        receipts.get(operationId) ?? null
    ),
    prepareMelt: vi.fn(async (_mintUrl: string, invoice: string) => {
      const id = `melt-${++nextMelt}`;
      invoiceByMelt.set(id, invoice);
      return { id, quoteId: `melt-quote-${nextMelt}`, amount: 100, fee_reserve: 0, swap_fee: 0 };
    }),
    executeMelt: vi.fn(async (operationId: string) => {
      payInvoice(invoiceByMelt.get(operationId) ?? '');
      return { id: operationId, state: 'finalized' };
    }),
    refreshMelt: vi.fn(async (operationId: string) => ({ id: operationId, state: 'finalized' })),
    getMeltOperation: vi.fn(async (_operationId: string) => null as { state: string } | null),
    restoreInflightProofs: vi.fn(async (_mintUrl: string) => {}),
    trustMint: vi.fn(async (_mintUrl: string) => {}),
    releaseTrust: vi.fn(async (_mintUrls: readonly string[]) => ({
      stranded: [],
      untrustErrors: [],
    })),
  } satisfies RebalanceWalletPort;
  return { port, receipts, payInvoice, invoiceByMelt };
}

function recordingSink() {
  const events: { type: string; legId: string; update?: RebalanceLegUpdate }[] = [];
  const statuses = (legId: string) =>
    events
      .filter((event) => event.legId === legId && event.update?.status)
      .map((event) => event.update?.status);
  let hopRun = 0;
  const sink: RebalanceEventSink = {
    legOpened: (legId) => events.push({ type: 'legOpened', legId }),
    legUpdated: (legId, update) => events.push({ type: 'legUpdated', legId, update }),
    mintReceiptCreated: (legId) => events.push({ type: 'mintReceiptCreated', legId }),
    meltPrepared: (legId) => events.push({ type: 'meltPrepared', legId }),
    routeAttemptStarted: (stepId, { route }) => {
      hopRun += 1;
      return {
        chainId: `chain-${hopRun}`,
        hopLegIds: route.path.slice(1).map((_, index) => `${stepId}-hop-${hopRun}-${index}`),
      };
    },
  };
  return { sink, events, statuses };
}

function setup(
  options: {
    balances?: Record<string, number>;
    routes?: RebalanceRoute[];
    trusted?: string[];
  } = {}
) {
  const wallet = fakeWallet(options.balances);
  const clock = fakeClock();
  const findRoutes = vi.fn(async () => options.routes ?? []);
  const engine = createRebalanceEngine({
    wallet: wallet.port,
    findRoutes,
    trustedMintUrls: new Set(options.trusted ?? [SOURCE, DESTINATION]),
    minTransferThreshold: 5,
    minFeeReserve: 5,
    lock: createRebalanceLock(clock),
    clock,
  });
  const recorder = recordingSink();
  const run = (step = STEP, isActive = () => true) =>
    engine.executeTransfer(step, { isActive, sink: recorder.sink });
  return { engine, wallet, clock, findRoutes, recorder, run };
}

describe('rebalance engine — direct transfer', () => {
  it('mints, melts once and settles on the recipient operation', async () => {
    const { run, wallet, recorder } = setup();
    await expect(run()).resolves.toEqual({ status: 'done' });
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
    expect(wallet.port.getMintOperation).toHaveBeenCalledWith('mint-quote-1');
    expect(recorder.statuses('step-1')).toEqual([
      'creatingInvoice',
      'invoiceReady',
      'melting',
      'verifying',
      'done',
    ]);
    expect(wallet.port.restoreInflightProofs).not.toHaveBeenCalled();
  });

  it('skips a transfer the source can no longer cover', async () => {
    const { run, wallet } = setup({ balances: { [SOURCE]: 8 } });
    await expect(run()).resolves.toEqual({ status: 'skipped' });
    expect(wallet.port.createMintReceipt).not.toHaveBeenCalled();
  });

  it('caps the amount to the probed fee reserve before preparing', async () => {
    const { run, wallet } = setup({ balances: { [SOURCE]: 110 } });
    wallet.port.probeMeltFeeReserve.mockResolvedValue(12);
    await expect(run()).resolves.toEqual({ status: 'done' });
    // 100 + static headroom 7 fits 110; the probed 12 sat reserve does not.
    expect(wallet.port.createMintReceipt.mock.calls.map(([, amount]) => amount)).toEqual([
      100, 98,
    ]);
  });

  it('re-prepares with a smaller invoice while proof selection falls short', async () => {
    const { run, wallet } = setup();
    wallet.port.prepareMelt
      .mockRejectedValueOnce(new ProofValidationError('Not enough proofs to send'))
      .mockRejectedValueOnce(new ProofValidationError('Not enough proofs to send'));
    await expect(run()).resolves.toEqual({ status: 'done' });
    expect(wallet.port.createMintReceipt.mock.calls.map(([, amount]) => amount)).toEqual([
      100, 98, 96,
    ]);
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('stops re-preparing at the transfer threshold and never executes', async () => {
    const { run, wallet } = setup({ balances: { [SOURCE]: 20 } });
    wallet.port.prepareMelt.mockRejectedValue(new ProofValidationError('Not enough proofs to send'));
    const outcome = await run();
    expect(outcome.status).toBe('failed');
    expect(wallet.port.executeMelt).not.toHaveBeenCalled();
  });

  it('re-prepares after the mint rejects the inputs, once state confirms nothing paid', async () => {
    const { run, wallet } = setup();
    wallet.port.executeMelt.mockRejectedValueOnce(new MintOperationError(11005, 'unbalanced'));
    wallet.port.getMeltOperation.mockResolvedValueOnce({ state: 'rolled_back' });
    await expect(run()).resolves.toEqual({ status: 'done' });
    expect(wallet.port.getMeltOperation).toHaveBeenCalledWith('melt-1');
    expect(wallet.port.restoreInflightProofs).toHaveBeenCalledWith(SOURCE);
    expect(wallet.port.createMintReceipt.mock.calls.map(([, amount]) => amount)).toEqual([
      100, 98,
    ]);
    expect(wallet.port.executeMelt.mock.calls.map(([id]) => id)).toEqual(['melt-1', 'melt-2']);
  });

  it('bounds input-shortfall re-preparation', async () => {
    const { run, wallet } = setup();
    wallet.port.executeMelt.mockRejectedValue(new MintOperationError(11005, 'unbalanced'));
    const outcome = await run();
    expect(outcome.status).toBe('failed');
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(3);
  });

  it('reconciles an input-shortfall error whose melt coco reports in flight instead of paying again', async () => {
    const { run, wallet } = setup();
    wallet.port.executeMelt.mockRejectedValueOnce(new MintOperationError(11005, 'unbalanced'));
    wallet.port.getMeltOperation.mockResolvedValueOnce({ state: 'pending' });
    wallet.port.refreshMelt.mockImplementationOnce(async (id) => {
      wallet.payInvoice('invoice-quote-1');
      return { id, state: 'finalized' };
    });
    await expect(run()).resolves.toEqual({ status: 'done' });
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
    expect(wallet.port.prepareMelt).toHaveBeenCalledTimes(1);
  });

  it('waits on an operation already in progress and never executes it twice', async () => {
    const { run, wallet } = setup();
    wallet.port.executeMelt.mockRejectedValueOnce(new OperationInProgressError('melt-1'));
    wallet.port.refreshMelt
      .mockResolvedValueOnce({ id: 'melt-1', state: 'pending' })
      .mockImplementationOnce(async (id) => {
        wallet.payInvoice('invoice-quote-1');
        return { id, state: 'finalized' };
      });
    await expect(run()).resolves.toEqual({ status: 'done' });
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
    expect(wallet.port.prepareMelt).toHaveBeenCalledTimes(1);
  });

  it('reconciles a lost execute response against the persisted melt state', async () => {
    const { run, wallet } = setup();
    wallet.port.executeMelt.mockRejectedValueOnce(new NetworkError('socket hang up'));
    wallet.port.getMeltOperation.mockResolvedValueOnce({ state: 'executing' });
    wallet.port.refreshMelt.mockImplementationOnce(async (id) => {
      wallet.payInvoice('invoice-quote-1');
      return { id, state: 'finalized' };
    });
    await expect(run()).resolves.toEqual({ status: 'done' });
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('keeps a melt that never settles pending, without failing it or freeing its proofs', async () => {
    const { run, wallet, recorder } = setup();
    wallet.port.executeMelt.mockResolvedValue({ id: 'melt-1', state: 'pending' });
    wallet.port.refreshMelt.mockResolvedValue({ id: 'melt-1', state: 'pending' });
    await expect(run()).resolves.toEqual({ status: 'pending', operationId: 'melt-1' });
    expect(recorder.statuses('step-1').at(-1)).toBe('paymentPending');
    expect(recorder.statuses('step-1')).not.toContain('failed');
    expect(wallet.port.restoreInflightProofs).not.toHaveBeenCalled();
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('fails a rolled-back melt with a typed error and does not pay again', async () => {
    const { run, wallet } = setup();
    wallet.port.executeMelt.mockResolvedValue({ id: 'melt-1', state: 'pending' });
    wallet.port.refreshMelt.mockResolvedValue({ id: 'melt-1', state: 'rolled_back' });
    const outcome = await run();
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.error).toBeInstanceOf(
      RebalanceMeltRolledBackError
    );
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
    expect(wallet.port.restoreInflightProofs).toHaveBeenCalledWith(SOURCE);
  });

  it('publishes nothing after the run is cancelled mid-melt', async () => {
    const { run, wallet, recorder } = setup();
    let active = true;
    wallet.port.executeMelt.mockImplementation(async (id) => {
      active = false;
      return { id, state: 'finalized' };
    });
    await expect(run(STEP, () => active)).resolves.toEqual({ status: 'aborted' });
    expect(recorder.statuses('step-1')).not.toContain('done');
    expect(wallet.port.restoreInflightProofs).not.toHaveBeenCalled();
  });
});

describe('rebalance engine — middleman routing', () => {
  const route: RebalanceRoute = {
    path: [SOURCE, MIDDLEMAN, DESTINATION],
    pathNames: ['Source', 'Middleman', 'Destination'],
    source: 'local_history',
  };
  const balances = { [SOURCE]: 1000, [MIDDLEMAN]: 100, [DESTINATION]: 0 };

  it('routes a no-route melt through a temporarily trusted middleman', async () => {
    const { run, wallet, recorder } = setup({ balances, routes: [route] });
    wallet.port.executeMelt.mockRejectedValueOnce(new MintOperationError(20004, 'no_route'));
    await expect(run()).resolves.toEqual({ status: 'done' });

    expect(wallet.port.trustMint).toHaveBeenCalledWith(MIDDLEMAN);
    expect(wallet.port.releaseTrust).toHaveBeenCalledWith([MIDDLEMAN]);
    // The abandoned direct receipt is never verified; each hop's receipt is.
    expect(wallet.port.getMintOperation.mock.calls.map(([id]) => id)).toEqual([
      'mint-quote-2',
      'mint-quote-3',
    ]);
    expect(recorder.statuses('step-1-hop-1-0')).toContain('done');
    expect(recorder.statuses('step-1-hop-1-1').at(-1)).toBe('done');
  });

  it('skips unstarted hops and tries the next route when a hop fails', async () => {
    const second: RebalanceRoute = { ...route, source: 'graph' };
    const { run, wallet, recorder } = setup({ balances, routes: [route, second] });
    wallet.port.executeMelt
      .mockRejectedValueOnce(new MintOperationError(20004, 'no_route'))
      .mockRejectedValueOnce(new MintOperationError(11001, 'Token already spent'));
    await expect(run()).resolves.toEqual({ status: 'done' });
    expect(recorder.statuses('step-1-hop-1-0').at(-1)).toBe('failed');
    expect(recorder.statuses('step-1-hop-1-1')).toEqual(['skipped']);
    expect(wallet.port.releaseTrust).toHaveBeenCalledTimes(2);
  });

  it('fails with the exhausted-routes error, keeping the last route error as its cause', async () => {
    const { run, wallet } = setup({ balances, routes: [route, { ...route, source: 'graph' }] });
    const lastError = new MintOperationError(11001, 'Token already spent');
    wallet.port.executeMelt
      .mockRejectedValueOnce(new MintOperationError(20004, 'no_route'))
      .mockRejectedValue(lastError);
    const outcome = await run();
    expect(outcome.status).toBe('failed');
    const error = outcome.status === 'failed' ? outcome.error : null;
    expect(error).toBeInstanceOf(RebalanceRoutesExhaustedError);
    expect((error as Error).cause).toBe(lastError);
  });

  it('fails with the original no-route error when no middleman is known', async () => {
    const { run, wallet } = setup();
    const noRoute = new MintOperationError(20004, 'FAILURE_REASON_NO_ROUTE');
    wallet.port.executeMelt.mockRejectedValueOnce(noRoute);
    await expect(run()).resolves.toEqual({ status: 'failed', error: noRoute });
  });
});

describe('rebalance engine — runs', () => {
  it('runs transfers in order, skips settled ones and reports failures', async () => {
    const { engine, wallet, recorder } = setup();
    wallet.port.prepareMelt.mockRejectedValueOnce(new Error('mint offline'));
    const settled: string[] = [];
    const steps = [
      { ...STEP, id: 'a' },
      { ...STEP, id: 'b' },
      { ...STEP, id: 'c' },
    ];
    const result = await engine.runTransfers(steps, {
      isActive: () => true,
      isSettled: (id) => id === 'b',
      sinkFor: () => recorder.sink,
      onTransferSettled: (step, outcome) => settled.push(`${step.id}:${outcome.status}`),
    });
    expect(result).toEqual({ status: 'finished', anyFailed: true, anyPending: false });
    expect(settled).toEqual(['a:failed', 'c:done']);
  });

  it('serializes transfers that start concurrently', async () => {
    const { run, wallet } = setup();
    let executing = 0;
    let overlap = false;
    wallet.port.executeMelt.mockImplementation(async (id) => {
      executing += 1;
      overlap ||= executing > 1;
      await Promise.resolve();
      wallet.payInvoice(wallet.invoiceByMelt.get(id) ?? '');
      executing -= 1;
      return { id, state: 'finalized' };
    });
    const outcomes = await Promise.all([run({ ...STEP, id: 'x' }), run({ ...STEP, id: 'y' })]);
    expect(outcomes).toEqual([{ status: 'done' }, { status: 'done' }]);
    expect(overlap).toBe(false);
  });

  it('releases temporary trust even when the guarded run throws', async () => {
    const { engine, wallet, recorder } = setup({ trusted: [SOURCE, DESTINATION] });
    await expect(
      engine.withTemporaryTrust([SOURCE, MIDDLEMAN, DESTINATION], { sink: recorder.sink }, () =>
        Promise.reject(new Error('boom'))
      )
    ).rejects.toThrow('boom');
    expect(wallet.port.trustMint).toHaveBeenCalledWith(MIDDLEMAN);
    expect(wallet.port.releaseTrust).toHaveBeenCalledWith([MIDDLEMAN]);
  });
});
