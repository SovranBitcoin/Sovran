import { describe, expect, it, vi } from 'vitest';
import { Amount, ProofValidationError, type MintSwapOperation } from '@cashu/coco-core';

import { createRebalanceEngine } from '../../src/rebalance/engine';
import { createRebalanceLock } from '../../src/rebalance/lock';
import {
  RebalanceExactAmountError,
  RebalanceRoutesExhaustedError,
  RebalanceSourceDebitCapError,
} from '../../src/rebalance/errors';
import type {
  RebalanceClock,
  RebalanceEventSink,
  RebalanceLegUpdate,
  RebalanceMintSwapApi,
  RebalanceRoute,
  RebalanceTransfer,
  RebalanceWalletPort,
} from '../../src/rebalance/types';

const MINT_A = 'https://a.mint.example';
const MINT_B = 'https://b.mint.example';
const MINT_MID = 'https://mid.mint.example';
const MINT_MID2 = 'https://mid2.mint.example';

function makeClock(start = 1_000): RebalanceClock {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

function makeSwapOp(
  overrides: Omit<Partial<MintSwapOperation>, 'destinationAmount'> & {
    id: string;
    state: MintSwapOperation['state'];
    sourceMintUrl?: string;
    destinationMintUrl?: string;
    destinationAmount?: number;
  }
): MintSwapOperation {
  const amount = Amount.from(overrides.destinationAmount ?? 100);
  const base = {
    id: overrides.id,
    revision: 1,
    sourceMintUrl: overrides.sourceMintUrl ?? MINT_A,
    destinationMintUrl: overrides.destinationMintUrl ?? MINT_B,
    unit: 'sat' as const,
    destinationAmount: amount,
    sourceQuote: { mintUrl: overrides.sourceMintUrl ?? MINT_A, method: 'bolt11' as const, quoteId: `mq-${overrides.id}` },
    destinationQuote: { mintUrl: overrides.destinationMintUrl ?? MINT_B, method: 'bolt11' as const, quoteId: `dq-${overrides.id}` },
    sourceOperationId: `melt-${overrides.id}`,
    destinationOperationId: `mint-${overrides.id}`,
    paymentRequestHash: '00'.repeat(32),
    createdAt: 1_000,
    updatedAt: 1_000,
    stateEnteredAt: 1_000,
    retry: { attemptCount: 0, lastAttemptAt: null, nextAttemptAt: null, lastError: null },
  };
  return { ...base, ...overrides } as MintSwapOperation;
}

function makeWallet(options: {
  balances?: Record<string, number>;
  inputFee?: number;
  mintSwap?: Partial<RebalanceMintSwapApi>;
  releaseTrust?: RebalanceWalletPort['releaseTrust'];
} = {}) {
  const balances = { [MINT_A]: 500, [MINT_B]: 0, [MINT_MID]: 500, ...options.balances };
  const ops = new Map<string, MintSwapOperation>();

  const defaultPrepare = vi.fn(async (input) => {
    const op = makeSwapOp({
      id: input.id,
      state: 'prepared',
      sourceMintUrl: input.sourceMintUrl,
      destinationMintUrl: input.destinationMintUrl,
      destinationAmount: Number(input.destinationAmount),
      sourceDebitBounds: {
        minimum: Amount.from(Number(input.destinationAmount)),
        maximum: Amount.from(Number(input.destinationAmount) + 2),
        reserved: Amount.from(Number(input.destinationAmount) + 2),
      },
    } as never);
    ops.set(op.id, op);
    return op;
  });

  const defaultExecute = vi.fn(async (id: string) => {
    const existing = ops.get(id);
    const completed = makeSwapOp({
      id,
      state: 'completed',
      sourceMintUrl: existing?.sourceMintUrl,
      destinationMintUrl: existing?.destinationMintUrl,
      destinationAmount: existing ? Number(existing.destinationAmount.toString()) : 100,
    });
    ops.set(id, completed);
    return completed;
  });

  const mintSwap: RebalanceMintSwapApi = {
    prepare: options.mintSwap?.prepare ?? defaultPrepare,
    execute: options.mintSwap?.execute ?? defaultExecute,
    get: options.mintSwap?.get ?? vi.fn(async (id: string) => ops.get(id) ?? null),
    listActive: options.mintSwap?.listActive ?? vi.fn(async () => []),
    refresh: options.mintSwap?.refresh ?? vi.fn(async (id: string) => ops.get(id)!),
    cancel: options.mintSwap?.cancel ?? vi.fn(async (id: string) => makeSwapOp({ id, state: 'cancelled' })),
    waitForOutcome:
      options.mintSwap?.waitForOutcome ??
      vi.fn(async (id: string) => {
        const op = ops.get(id)!;
        return { kind: op.state as 'completed', operation: op } as never;
      }),
  };

  const port: RebalanceWalletPort = {
    balancesByMint: vi.fn(async () => ({ ...balances })),
    worstCaseInputFee: vi.fn(async () => options.inputFee ?? 0),
    mintSwap,
    trustMint: vi.fn(async () => undefined),
    releaseTrust:
      options.releaseTrust ?? vi.fn(async () => ({ stranded: [], untrustErrors: [] })),
  };

  return { port, mintSwap, ops };
}

function makeSink() {
  const updates: { legId: string; update: RebalanceLegUpdate }[] = [];
  const opened: { legId: string; amount: number }[] = [];
  const prepared: { legId: string; op: MintSwapOperation }[] = [];
  const sink: RebalanceEventSink = {
    legOpened: vi.fn((legId, leg) => {
      opened.push({ legId, amount: leg.amount });
    }),
    legUpdated: vi.fn((legId, update) => {
      updates.push({ legId, update });
    }),
    swapPrepared: vi.fn((legId, op) => {
      prepared.push({ legId, op });
    }),
    routeAttemptStarted: vi.fn((stepId, { route, index }) => ({
      chainId: `chain-${index}`,
      hopLegIds: route.path.slice(0, -1).map((_: string, i: number) => `${stepId}-hop-${index}-${i}`),
    })),
  };
  return { sink, updates, opened, prepared };
}

function step(overrides: Partial<RebalanceTransfer> = {}): RebalanceTransfer {
  return {
    id: 'step-1',
    fromMintUrl: MINT_A,
    toMintUrl: MINT_B,
    amount: 100,
    ...overrides,
  };
}

describe('createRebalanceEngine (Coco ops.mintSwap)', () => {
  it('executes a direct swap through ops.mintSwap.prepare -> execute and emits done', async () => {
    const wallet = makeWallet();
    const { sink, updates, prepared } = makeSink();
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes: async () => [],
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const outcome = await engine.executeTransfer(step(), { isActive: () => true, sink });

    expect(outcome).toEqual({ status: 'done' });
    expect(wallet.mintSwap.prepare).toHaveBeenCalledTimes(1);
    expect(wallet.mintSwap.execute).toHaveBeenCalledTimes(1);
    expect(prepared).toHaveLength(1);
    expect(updates.map((u) => u.update.status).filter(Boolean)).toEqual([
      'creatingInvoice',
      'invoiceReady',
      'melting',
      'done',
    ]);
  });

  it('skips when source balance is below minTransferThreshold + feeHeadroom', async () => {
    const wallet = makeWallet({ balances: { [MINT_A]: 10 } });
    const { sink } = makeSink();
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes: async () => [],
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const outcome = await engine.executeTransfer(step(), { isActive: () => true, sink });

    expect(outcome).toEqual({ status: 'skipped' });
    expect(wallet.mintSwap.prepare).not.toHaveBeenCalled();
  });

  it('shrinks destinationAmount on insufficient_proofs prepare failure with fresh swap IDs', async () => {
    const seenIds: string[] = [];
    const seenAmounts: number[] = [];
    let attempt = 0;
    const wallet = makeWallet({
      mintSwap: {
        prepare: vi.fn(async (input) => {
          seenIds.push(input.id);
          seenAmounts.push(Number(input.destinationAmount));
          attempt += 1;
          if (attempt === 1) {
            throw new ProofValidationError('Not enough proofs to cover amount + fee');
          }
          return makeSwapOp({
            id: input.id,
            state: 'prepared',
            destinationAmount: Number(input.destinationAmount),
          });
        }),
        execute: vi.fn(async (id) => makeSwapOp({ id, state: 'completed' })),
      },
    });
    const { sink } = makeSink();
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes: async () => [],
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const outcome = await engine.executeTransfer(step({ amount: 100 }), {
      isActive: () => true,
      sink,
    });

    expect(outcome).toEqual({ status: 'done' });
    expect(seenAmounts).toEqual([100, 98]);
    expect(new Set(seenIds).size).toBe(2);
  });

  it('fails without shrinking when exactAmount is set and source balance is insufficient', async () => {
    const wallet = makeWallet({ balances: { [MINT_A]: 50 } });
    const { sink } = makeSink();
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes: async () => [],
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const outcome = await engine.executeTransfer(step({ amount: 100, exactAmount: true }), {
      isActive: () => true,
      sink,
    });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toBeInstanceOf(RebalanceExactAmountError);
    }
    expect(wallet.mintSwap.prepare).not.toHaveBeenCalled();
  });

  it('fails with RebalanceSourceDebitCapError when Coco rejects source_debit_cap_exceeded', async () => {
    const wallet = makeWallet({
      mintSwap: {
        prepare: vi.fn(async (input) =>
          makeSwapOp({
            id: input.id,
            state: 'failed',
            failure: { code: 'source_debit_cap_exceeded' },
            lastSafe: {
              state: 'prepared',
              stateEnteredAt: 1_000,
              sourceDebitBounds: {
                minimum: Amount.from(100),
                maximum: Amount.from(108),
                reserved: Amount.from(108),
              },
            },
          } as never)
        ),
      },
    });
    const { sink } = makeSink();
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes: async () => [],
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const outcome = await engine.executeTransfer(step({ amount: 100, sourceDebitCap: 105 }), {
      isActive: () => true,
      sink,
    });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toBeInstanceOf(RebalanceSourceDebitCapError);
    }
    expect(wallet.mintSwap.execute).not.toHaveBeenCalled();
  });

  it('keeps the prepared parent pending when execute and lookup both fail', async () => {
    const wallet = makeWallet({
      mintSwap: {
        execute: vi.fn().mockRejectedValue(new Error('execute response lost')),
        get: vi.fn().mockRejectedValue(new Error('lookup unavailable')),
      },
    });
    const { sink, prepared, updates } = makeSink();
    const findRoutes = vi.fn(async () => []);
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes,
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const outcome = await engine.executeTransfer(step(), {
      isActive: () => true,
      sink,
    });
    const parentId = prepared[0]?.op.id;

    expect(parentId).toBeTruthy();
    expect(outcome).toEqual({ status: 'pending', operationId: parentId });
    expect(updates.at(-1)?.update).toMatchObject({
      status: 'paymentPending',
      operationId: parentId,
    });
    expect(wallet.mintSwap.get).toHaveBeenCalledWith(parentId);
    expect(wallet.mintSwap.prepare).toHaveBeenCalledTimes(1);
    expect(wallet.mintSwap.execute).toHaveBeenCalledTimes(1);
    expect(findRoutes).not.toHaveBeenCalled();
  });

  it('returns pending (paymentPending) when source_pending times out in waitForOutcome', async () => {
    const wallet = makeWallet({
      mintSwap: {
        execute: vi.fn(async (id) => makeSwapOp({ id, state: 'source_pending' })),
        waitForOutcome: vi.fn(async (id) => ({
          status: 'timeout' as const,
          operation: makeSwapOp({ id, state: 'source_pending' }) as never,
        })),
      },
    });
    const { sink, updates } = makeSink();
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes: async () => [],
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const outcome = await engine.executeTransfer(step(), { isActive: () => true, sink });

    expect(outcome.status).toBe('pending');
    expect(updates.at(-1)?.update.status).toBe('paymentPending');
  });

  it('returns settling when destination_funded times out in waitForOutcome', async () => {
    const wallet = makeWallet({
      mintSwap: {
        execute: vi.fn(async (id) => makeSwapOp({ id, state: 'destination_funded' })),
        waitForOutcome: vi.fn(async (id) => ({
          status: 'timeout' as const,
          operation: makeSwapOp({ id, state: 'destination_funded' }) as never,
        })),
      },
    });
    const { sink, updates } = makeSink();
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes: async () => [],
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const outcome = await engine.executeTransfer(step(), { isActive: () => true, sink });

    expect(outcome).toEqual({ status: 'settling' });
    expect(updates.map((u) => u.update.status).filter(Boolean)).toContain('verifying');
    expect(updates.at(-1)?.update.status).toBe('settling');
  });

  it('routes through middleman mints when direct swap fails with source_payment_rejected', async () => {
    let directFailed = false;
    const wallet = makeWallet({
      mintSwap: {
        execute: vi.fn(async (id) => {
          if (!directFailed) {
            directFailed = true;
            return makeSwapOp({
              id,
              state: 'failed',
              failure: { code: 'source_payment_rejected' },
            } as never);
          }
          return makeSwapOp({ id, state: 'completed' });
        }),
      },
    });
    const { sink } = makeSink();
    const route: RebalanceRoute = {
      path: [MINT_A, MINT_MID, MINT_B],
      pathNames: ['A', 'Mid', 'B'],
      source: 'graph',
    };
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes: async () => [route],
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const outcome = await engine.executeTransfer(step(), { isActive: () => true, sink });

    expect(outcome).toEqual({ status: 'done' });
    expect(wallet.port.trustMint).toHaveBeenCalledWith(MINT_MID);
    expect(wallet.port.releaseTrust).toHaveBeenCalledWith([MINT_MID]);
    expect(wallet.mintSwap.execute).toHaveBeenCalledTimes(3); // 1 direct + 2 hops
  });

  it('returns RebalanceRoutesExhaustedError when multiple candidate middleman routes all fail', async () => {
    const wallet = makeWallet({
      mintSwap: {
        execute: vi.fn(async (id) =>
          makeSwapOp({
            id,
            state: 'failed',
            failure: { code: 'source_payment_rejected' },
          } as never)
        ),
      },
    });
    const { sink } = makeSink();
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes: async () => [
        { path: [MINT_A, MINT_MID, MINT_B], pathNames: ['A', 'Mid', 'B'], source: 'graph' },
        { path: [MINT_A, MINT_MID2, MINT_B], pathNames: ['A', 'Mid2', 'B'], source: 'graph' },
      ],
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const outcome = await engine.executeTransfer(step(), { isActive: () => true, sink });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toBeInstanceOf(RebalanceRoutesExhaustedError);
    }
  });

  it('cancels a prepared swap if the run is cancelled before execute', async () => {
    let active = true;
    const wallet = makeWallet({
      mintSwap: {
        prepare: vi.fn(async (input) => {
          active = false;
          return makeSwapOp({ id: input.id, state: 'prepared' });
        }),
      },
    });
    const { sink } = makeSink();
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes: async () => [],
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const outcome = await engine.executeTransfer(step(), { isActive: () => active, sink });

    expect(outcome).toEqual({ status: 'aborted' });
    expect(wallet.mintSwap.cancel).toHaveBeenCalledTimes(1);
    expect(wallet.mintSwap.execute).not.toHaveBeenCalled();
  });

  it('holds a downstream step when an active Coco mintSwap is still arriving at its source mint', async () => {
    const wallet = makeWallet({
      mintSwap: {
        listActive: vi.fn(async () => [
          makeSwapOp({
            id: 'arriving-1',
            state: 'destination_funded',
            sourceMintUrl: MINT_B,
            destinationMintUrl: MINT_A,
          }),
        ]),
      },
    });
    const { sink } = makeSink();
    const engine = createRebalanceEngine({
      wallet: wallet.port,
      findRoutes: async () => [],
      trustedMintUrls: new Set([MINT_A, MINT_B]),
      minTransferThreshold: 10,
      minFeeReserve: 2,
      lock: createRebalanceLock(),
      clock: makeClock(),
    });

    const result = await engine.runTransfers([step()], {
      isActive: () => true,
      isSettled: () => false,
      sinkFor: () => sink,
    });

    expect(result).toEqual({ status: 'finished', anyFailed: false, anyPending: true });
    expect(wallet.mintSwap.prepare).not.toHaveBeenCalled();
  });
});
