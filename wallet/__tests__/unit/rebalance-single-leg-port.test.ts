/**
 * The single-leg transfer seam (ADR 0037) over the Coco 2.0.0 engine path:
 * one id per transfer, never a second payment for it, an unknown melt never
 * retried, the source debit cap checked before paying, no middleman routing,
 * and no child mint or melt operation ids in what it returns.
 */
import { describe, expect, it, vi } from 'vitest';
import { Amount, MintOperationError } from '@cashu/coco-core';

import { createRebalanceEngine } from '../../src/rebalance/engine';
import { createRebalanceLock } from '../../src/rebalance/lock';
import {
  createEngineSingleLegTransferPort,
  SingleLegIntentMismatchError,
  type SingleLegTransferInput,
} from '../../src/rebalance/singleLegPort';
import type {
  RebalanceClock,
  RebalanceMintReceipt,
  RebalanceMintSnapshot,
  RebalancePreparedMelt,
  RebalanceWalletPort,
} from '../../src/rebalance/types';

const SOURCE = 'https://source.example';
const OTHER_SOURCE = 'https://other.example';
const DESTINATION = 'https://destination.example';
const LEG: SingleLegTransferInput = {
  id: 'leg-1',
  sourceMintUrl: SOURCE,
  destinationMintUrl: DESTINATION,
  destinationAmount: 100,
  unit: 'sat',
};

function fakeClock(): RebalanceClock {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      await Promise.resolve();
    },
  };
}

function fakeWallet() {
  const receipts = new Map<string, RebalanceMintReceipt & { state: string }>();
  const invoiceByMelt = new Map<string, string>();
  let nextReceipt = 0;
  let nextMelt = 0;
  let feeReserve = 0;
  const payInvoice = (invoice: string) => {
    for (const receipt of receipts.values()) {
      if (receipt.request === invoice) receipt.state = 'finalized';
    }
  };
  const port = {
    balancesByMint: vi.fn(async () => ({ [SOURCE]: 1000, [OTHER_SOURCE]: 1000 })),
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
    refreshMintOperation: vi.fn(
      async (operationId: string): Promise<RebalanceMintSnapshot | null> =>
        receipts.get(operationId) ?? null
    ),
    prepareMelt: vi.fn(async (_mintUrl: string, invoice: string): Promise<RebalancePreparedMelt> => {
      const id = `melt-${++nextMelt}`;
      invoiceByMelt.set(id, invoice);
      return { id, quoteId: `melt-quote-${nextMelt}`, amount: 100, fee_reserve: feeReserve, swap_fee: 1 };
    }),
    executeMelt: vi.fn(async (operationId: string) => {
      payInvoice(invoiceByMelt.get(operationId) ?? '');
      return { id: operationId, state: 'finalized' };
    }),
    refreshMelt: vi.fn(async (operationId: string) => ({ id: operationId, state: 'finalized' })),
    getMeltOperation: vi.fn(async (_operationId: string) => null as { state: string } | null),
    restoreInflightProofs: vi.fn(async (_mintUrl: string) => {}),
    cancelPreparedMelt: vi.fn(async (_operationId: string) => {}),
    trustMint: vi.fn(async (_mintUrl: string) => {}),
    releaseTrust: vi.fn(async (_mintUrls: readonly string[]) => ({
      stranded: [],
      untrustErrors: [],
    })),
  } satisfies RebalanceWalletPort;
  return {
    port,
    payInvoice,
    invoiceByMelt,
    receipts,
    setFeeReserve: (value: number) => {
      feeReserve = value;
    },
  };
}

function setup(options: { lockClock?: RebalanceClock } = {}) {
  const wallet = fakeWallet();
  const clock = fakeClock();
  const findRoutes = vi.fn(async () => []);
  const engine = createRebalanceEngine({
    wallet: wallet.port,
    findRoutes,
    trustedMintUrls: new Set([SOURCE, OTHER_SOURCE, DESTINATION]),
    minTransferThreshold: 5,
    minFeeReserve: 5,
    lock: createRebalanceLock(options.lockClock ?? clock),
    clock,
  });
  const port = createEngineSingleLegTransferPort({ engine, wallet: wallet.port, unit: 'sat' });
  return { port, wallet, findRoutes };
}

/** An unknown melt: execute answers pending and it never settles while the leg waits. */
function meltStaysPending(wallet: ReturnType<typeof fakeWallet>) {
  wallet.port.executeMelt.mockImplementation(async (operationId: string) => ({
    id: operationId,
    state: 'pending',
  }));
  wallet.port.refreshMelt.mockImplementation(async (operationId: string) => ({
    id: operationId,
    state: 'pending',
  }));
}

describe('single-leg transfer port', () => {
  it('completes one leg and returns only its own id', async () => {
    const { port, wallet } = setup();
    const outcome = await port.executeLeg(LEG);
    expect(outcome).toEqual({
      status: 'completed',
      id: 'leg-1',
      destinationAmount: 100,
      requestedAmount: 100,
    });
    // Nothing about the mint quote or melt crosses the seam.
    expect(JSON.stringify(outcome)).not.toMatch(/quote|melt-/);
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('never pays twice for one id: a repeat returns the outcome, a concurrent call joins', async () => {
    const { port, wallet } = setup();
    const [first, second] = await Promise.all([port.executeLeg(LEG), port.executeLeg(LEG)]);
    expect(second).toEqual(first);
    await expect(port.executeLeg(LEG)).resolves.toEqual(first);
    expect(wallet.port.prepareMelt).toHaveBeenCalledTimes(1);
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('refuses an id reused for a different transfer', async () => {
    const { port } = setup();
    await port.executeLeg(LEG);
    await expect(port.executeLeg({ ...LEG, destinationAmount: 50 })).rejects.toBeInstanceOf(
      SingleLegIntentMismatchError
    );
  });

  it('keeps an unknown melt pending and never sends it again', async () => {
    const { port, wallet } = setup();
    meltStaysPending(wallet);
    await expect(port.executeLeg(LEG)).resolves.toEqual({ status: 'pending', id: 'leg-1' });
    await expect(port.executeLeg(LEG)).resolves.toEqual({ status: 'pending', id: 'leg-1' });
    await expect(port.refreshLeg('leg-1')).resolves.toEqual({ status: 'pending', id: 'leg-1' });
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
    expect(wallet.port.restoreInflightProofs).not.toHaveBeenCalled();
  });

  it('reads a pending leg back to completed once the melt and receipt settle', async () => {
    const { port, wallet } = setup();
    meltStaysPending(wallet);
    await port.executeLeg(LEG);
    // The mint paid after all; the destination issued.
    wallet.port.refreshMelt.mockImplementation(async (operationId: string) => {
      wallet.payInvoice(wallet.invoiceByMelt.get(operationId) ?? '');
      return { id: operationId, state: 'finalized' };
    });
    await expect(port.refreshLeg('leg-1')).resolves.toEqual({
      status: 'completed',
      id: 'leg-1',
      destinationAmount: 100,
      requestedAmount: 100,
    });
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('reads a pending leg back to failed when the melt settled unpaid', async () => {
    const { port, wallet } = setup();
    meltStaysPending(wallet);
    await port.executeLeg(LEG);
    wallet.port.refreshMelt.mockResolvedValue({ id: 'melt-1', state: 'rolled_back' });
    await expect(port.refreshLeg('leg-1')).resolves.toMatchObject({
      status: 'failed',
      id: 'leg-1',
    });
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('does not draw on a mint whose earlier leg is still pending', async () => {
    const { port, wallet } = setup();
    meltStaysPending(wallet);
    await port.executeLeg(LEG);
    await expect(port.executeLeg({ ...LEG, id: 'leg-2' })).resolves.toEqual({
      status: 'busy',
      id: 'leg-2',
    });
    expect(wallet.port.prepareMelt).toHaveBeenCalledTimes(1);
    // Another source is free to move.
    wallet.port.executeMelt.mockImplementation(async (operationId: string) => {
      wallet.payInvoice(wallet.invoiceByMelt.get(operationId) ?? '');
      return { id: operationId, state: 'finalized' };
    });
    await expect(
      port.executeLeg({ ...LEG, id: 'leg-3', sourceMintUrl: OTHER_SOURCE })
    ).resolves.toMatchObject({ status: 'completed', id: 'leg-3' });
  });

  it('fails before paying when the prepared melt would debit more than the cap', async () => {
    const { port, wallet } = setup();
    wallet.setFeeReserve(30);
    const outcome = await port.executeLeg({ ...LEG, sourceDebitCap: 120 });
    // 100 invoice + 30 reserve + 1 input fee = 131 > 120.
    expect(outcome).toMatchObject({
      status: 'failed',
      id: 'leg-1',
      reason: 'source_debit_cap_exceeded',
    });
    expect(wallet.port.executeMelt).not.toHaveBeenCalled();
  });

  it('counts a direct melt\'s input fee: every selected proof can leave the source', async () => {
    const { port, wallet } = setup();
    // 100 invoice + 10 reserve, paid with 112 of proofs: 2 sats of input fee.
    wallet.port.prepareMelt.mockImplementationOnce(async () => ({
      id: 'melt-1',
      quoteId: 'melt-quote-1',
      amount: 100,
      fee_reserve: 10,
      swap_fee: 0,
      needsSwap: false,
      inputAmount: 112,
    }));
    await expect(port.executeLeg({ ...LEG, sourceDebitCap: 110 })).resolves.toMatchObject({
      status: 'failed',
      reason: 'source_debit_cap_exceeded',
    });
    expect(wallet.port.executeMelt).not.toHaveBeenCalled();
  });

  it('counts the swapped proofs a swap-then-melt sends, with the swap fee', async () => {
    const { port, wallet } = setup();
    const output = (amount: string) => ({ blindedMessage: { amount } });
    wallet.port.prepareMelt.mockImplementationOnce(async () => ({
      id: 'melt-1',
      amount: 100,
      fee_reserve: 10,
      swap_fee: 1,
      needsSwap: true,
      inputAmount: 512,
      // 110 plus 2 sats to spend the swapped proofs.
      swapOutputData: { keep: [output('400')], send: [output('64'), output('32'), output('16')] },
    }));
    await expect(port.executeLeg({ ...LEG, sourceDebitCap: 112 })).resolves.toMatchObject({
      status: 'failed',
      reason: 'source_debit_cap_exceeded',
    });
    expect(wallet.port.executeMelt).not.toHaveBeenCalled();
  });

  it.each([
    ['an unreadable reserve', { fee_reserve: 'ten' }],
    ['a negative reserve', { fee_reserve: -5 }],
    ['a fractional swap fee', { swap_fee: 0.5 }],
    ['an unsafe input amount', { needsSwap: false, inputAmount: 2 ** 53 }],
  ])('refuses %s instead of reading it as nothing', async (_name, fields) => {
    const { port, wallet } = setup();
    wallet.port.prepareMelt.mockImplementationOnce(async () => ({
      id: 'melt-1',
      amount: 100,
      fee_reserve: 0,
      swap_fee: 0,
      ...fields,
    }));
    await expect(port.executeLeg({ ...LEG, sourceDebitCap: 1000 })).resolves.toMatchObject({
      status: 'failed',
    });
    expect(wallet.port.executeMelt).not.toHaveBeenCalled();
    expect(wallet.port.cancelPreparedMelt).toHaveBeenCalledWith('melt-1');
  });

  it('gives back the proofs a melt over the cap reserved', async () => {
    const { port, wallet } = setup();
    wallet.setFeeReserve(30);
    await port.executeLeg({ ...LEG, sourceDebitCap: 120 });
    expect(wallet.port.cancelPreparedMelt).toHaveBeenCalledTimes(1);
    expect(wallet.port.cancelPreparedMelt).toHaveBeenCalledWith('melt-1');
  });

  it('a leg queued behind a leg that ends pending never draws on the same mint', async () => {
    // A lock waiter that waits as long as it takes, a macrotask per poll, so
    // Leg B is still queued when Leg A lets go.
    const patientLock: RebalanceClock = {
      now: () => 0,
      sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
    };
    const { port, wallet } = setup({ lockClock: patientLock });
    // Leg A's melt is sent and its outcome stays unknown.
    let releaseA!: () => void;
    const aSent = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    wallet.port.executeMelt.mockImplementation(async (operationId: string) => {
      await aSent;
      return { id: operationId, state: 'pending' };
    });
    wallet.port.refreshMelt.mockImplementation(async (operationId: string) => ({
      id: operationId,
      state: 'pending',
    }));
    const legA = port.executeLeg(LEG);
    const legB = port.executeLeg({ ...LEG, id: 'leg-2' });
    await vi.waitFor(() => expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1));
    releaseA();
    await expect(legA).resolves.toEqual({ status: 'pending', id: 'leg-1' });
    await expect(legB).resolves.toEqual({ status: 'busy', id: 'leg-2' });
    expect(wallet.port.prepareMelt).toHaveBeenCalledTimes(1);
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('pays within the cap', async () => {
    const { port, wallet } = setup();
    wallet.setFeeReserve(10);
    await expect(port.executeLeg({ ...LEG, sourceDebitCap: 111 })).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('leaves routing to the caller: no route fails the leg without middlemen', async () => {
    const { port, wallet, findRoutes } = setup();
    wallet.port.executeMelt.mockRejectedValueOnce(
      new MintOperationError(20004, 'FAILURE_REASON_NO_ROUTE')
    );
    wallet.port.getMeltOperation.mockResolvedValue({ state: 'failed' });
    await expect(port.executeLeg(LEG)).resolves.toMatchObject({
      status: 'failed',
      reason: 'no_route',
    });
    expect(findRoutes).not.toHaveBeenCalled();
  });

  it.each([
    ['another unit', { unit: 'usd' }],
    ['the same mint twice', { destinationMintUrl: SOURCE }],
    ['a fractional amount', { destinationAmount: 10.5 }],
    ['a cap below the amount', { sourceDebitCap: 99 }],
  ])('rejects %s without touching the wallet', async (_name, change) => {
    const { port, wallet } = setup();
    await expect(port.executeLeg({ ...LEG, ...change })).resolves.toMatchObject({
      status: 'failed',
      reason: 'invalid_input',
    });
    expect(wallet.port.balancesByMint).not.toHaveBeenCalled();
  });

  it('runs a cancelled leg again only when nothing was prepared', async () => {
    const { port, wallet } = setup();
    await expect(port.executeLeg(LEG, { isActive: () => false })).resolves.toEqual({
      status: 'cancelled',
      id: 'leg-1',
    });
    expect(wallet.port.prepareMelt).not.toHaveBeenCalled();
    await expect(port.executeLeg(LEG)).resolves.toMatchObject({ status: 'completed' });
  });

  it('treats a leg stopped after its melt was prepared as pending, not re-runnable', async () => {
    const { port, wallet } = setup();
    let active = true;
    wallet.port.executeMelt.mockImplementation(async (operationId: string) => {
      active = false;
      return { id: operationId, state: 'pending' };
    });
    wallet.port.refreshMelt.mockImplementation(async (operationId: string) => ({
      id: operationId,
      state: 'pending',
    }));
    await expect(port.executeLeg(LEG, { isActive: () => active })).resolves.toEqual({
      status: 'pending',
      id: 'leg-1',
    });
    await expect(port.executeLeg(LEG)).resolves.toEqual({ status: 'pending', id: 'leg-1' });
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('never executes a melt whose run was stopped while it was prepared, and gives its proofs back', async () => {
    const { port, wallet } = setup();
    let active = true;
    const prepare = wallet.port.prepareMelt.getMockImplementation()!;
    wallet.port.prepareMelt.mockImplementation(async (mintUrl: string, invoice: string) => {
      const prepared = await prepare(mintUrl, invoice);
      active = false;
      return prepared;
    });
    await expect(port.executeLeg(LEG, { isActive: () => active })).resolves.toEqual({
      status: 'cancelled',
      id: 'leg-1',
    });
    expect(wallet.port.executeMelt).not.toHaveBeenCalled();
    expect(wallet.port.cancelPreparedMelt).toHaveBeenCalledWith('melt-1');
    // Released, so the same leg may run again.
    wallet.port.prepareMelt.mockImplementation(prepare);
    await expect(port.executeLeg(LEG)).resolves.toMatchObject({ status: 'completed' });
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('keeps a stopped leg pending when its prepared melt could not be released, then releases it on read back', async () => {
    const { port, wallet } = setup();
    let active = true;
    const prepare = wallet.port.prepareMelt.getMockImplementation()!;
    wallet.port.prepareMelt.mockImplementation(async (mintUrl: string, invoice: string) => {
      const prepared = await prepare(mintUrl, invoice);
      active = false;
      return prepared;
    });
    wallet.port.cancelPreparedMelt.mockRejectedValueOnce(new Error('offline'));
    await expect(port.executeLeg(LEG, { isActive: () => active })).resolves.toEqual({
      status: 'pending',
      id: 'leg-1',
    });
    expect(wallet.port.executeMelt).not.toHaveBeenCalled();

    wallet.port.refreshMelt.mockResolvedValue({ id: 'melt-1', state: 'prepared' });
    // Still unreleasable: still pending, never failed with its proofs reserved.
    wallet.port.cancelPreparedMelt.mockRejectedValueOnce(new Error('offline'));
    await expect(port.refreshLeg('leg-1')).resolves.toEqual({ status: 'pending', id: 'leg-1' });
    await expect(port.refreshLeg('leg-1')).resolves.toMatchObject({ status: 'failed' });
    expect(wallet.port.cancelPreparedMelt).toHaveBeenCalledTimes(3);
    expect(wallet.port.cancelPreparedMelt).toHaveBeenLastCalledWith('melt-1');
    expect(wallet.port.executeMelt).not.toHaveBeenCalled();
  });

  it('treats spellings of one mint URL as one mint for the lock and the self-swap check', async () => {
    const { port, wallet } = setup();
    meltStaysPending(wallet);
    await port.executeLeg(LEG);
    for (const [id, sourceMintUrl] of [
      ['leg-2', 'https://source.example/'],
      ['leg-3', 'https://SOURCE.example'],
      ['leg-4', 'https://source.example:443'],
    ]) {
      await expect(port.executeLeg({ ...LEG, id, sourceMintUrl })).resolves.toEqual({
        status: 'busy',
        id,
      });
    }
    expect(wallet.port.prepareMelt).toHaveBeenCalledTimes(1);
    await expect(
      port.executeLeg({ ...LEG, id: 'self', sourceMintUrl: 'https://Destination.example/' })
    ).resolves.toMatchObject({ status: 'failed', reason: 'invalid_input' });
  });

  /** A leg whose melt paid while the destination had not issued yet. */
  async function settlingLeg() {
    const ctx = setup();
    ctx.wallet.port.executeMelt.mockImplementation(async (operationId: string) => ({
      id: operationId,
      state: 'finalized',
    }));
    await expect(ctx.port.executeLeg(LEG)).resolves.toEqual({ status: 'settling', id: 'leg-1' });
    return ctx;
  }

  it('re-checks a settling leg with the destination mint, not only the stored state', async () => {
    const { port, wallet } = await settlingLeg();
    // The stored row still says pending; only a re-check sees it issued.
    wallet.port.refreshMintOperation.mockImplementation(async (operationId: string) => {
      const receipt = wallet.receipts.get(operationId)!;
      return { ...receipt, state: 'finalized' };
    });
    await expect(port.refreshLeg('leg-1')).resolves.toMatchObject({
      status: 'completed',
      destinationAmount: 100,
    });
    expect(wallet.port.refreshMintOperation).toHaveBeenCalled();
  });

  it('falls back to the stored mint operation when the re-check fails', async () => {
    const { port, wallet } = await settlingLeg();
    wallet.port.refreshMintOperation.mockRejectedValue(new Error('offline'));
    await expect(port.refreshLeg('leg-1')).resolves.toEqual({ status: 'settling', id: 'leg-1' });
    for (const receipt of wallet.receipts.values()) receipt.state = 'finalized';
    await expect(port.refreshLeg('leg-1')).resolves.toMatchObject({ status: 'completed' });
  });

  it.each([
    ['failed', { state: 'failed', error: 'quote expired' }],
    ['finalized with an error', { state: 'finalized', error: 'outputs rejected' }],
  ])('moves a settling leg out of settling when its mint operation ended %s', async (_n, end) => {
    const { port, wallet } = await settlingLeg();
    for (const receipt of wallet.receipts.values()) Object.assign(receipt, end);
    const outcome = await port.refreshLeg('leg-1');
    expect(outcome).toMatchObject({ status: 'destination_failed', id: 'leg-1' });
    // Settled: a repeat reads nothing and pays nothing.
    await expect(port.executeLeg(LEG)).resolves.toBe(outcome);
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('reports what was asked beside what was delivered when the source only had less', async () => {
    const { port, wallet } = setup();
    const outcome = await port.executeLeg({ ...LEG, destinationAmount: 1000 });
    expect(outcome).toMatchObject({ status: 'completed', requestedAmount: 1000 });
    if (outcome.status !== 'completed') return;
    expect(outcome.destinationAmount).toBeLessThan(1000);
    expect(wallet.port.executeMelt).toHaveBeenCalledTimes(1);
  });

  it('with exactDestination, fails before preparing when the source cannot cover the amount', async () => {
    const { port, wallet } = setup();
    await expect(
      port.executeLeg({ ...LEG, destinationAmount: 1000, exactDestination: true })
    ).resolves.toMatchObject({ status: 'failed', reason: 'exact_destination_unavailable' });
    expect(wallet.port.createMintReceipt).not.toHaveBeenCalled();
    expect(wallet.port.executeMelt).not.toHaveBeenCalled();
  });

  it('with exactDestination, releases a prepared melt the probed fees would shrink', async () => {
    const { port, wallet } = setup();
    wallet.port.probeMeltFeeReserve.mockResolvedValue(200);
    const leg = { ...LEG, destinationAmount: 900, exactDestination: true };
    await expect(port.executeLeg(leg)).resolves.toMatchObject({
      status: 'failed',
      reason: 'exact_destination_unavailable',
    });
    expect(wallet.port.executeMelt).not.toHaveBeenCalled();
    expect(wallet.port.cancelPreparedMelt).toHaveBeenCalledWith('melt-1');
  });

  it('with exactDestination, pays an amount the source covers', async () => {
    const { port } = setup();
    await expect(port.executeLeg({ ...LEG, exactDestination: true })).resolves.toEqual({
      status: 'completed',
      id: 'leg-1',
      destinationAmount: 100,
      requestedAmount: 100,
    });
  });

  it('knows nothing of an id it has not run', async () => {
    const { port } = setup();
    await expect(port.refreshLeg('nope')).resolves.toBeNull();
  });
});
