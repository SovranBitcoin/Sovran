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
    expect(outcome).toEqual({ status: 'completed', id: 'leg-1', destinationAmount: 100 });
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

  it('knows nothing of an id it has not run', async () => {
    const { port } = setup();
    await expect(port.refreshLeg('nope')).resolves.toBeNull();
  });
});
