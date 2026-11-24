/**
 * @jest-environment node
 *
 * The Coco 2.0.0 single-leg transfer port (ADR 0037) over a fake Coco manager:
 * one leg is one mint quote and one melt, a repeat of the same id pays nothing
 * more, an unknown melt is never executed again, and no Coco operation id
 * reaches the caller.
 */
import { Amount } from '@cashu/coco-core';
import { createRebalanceLock } from 'wallet';

import { createCocoSingleLegTransferPort } from '@/features/mint/lib/rebalanceWalletPort';

jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { restoreInflightProofsForMint: jest.fn(() => Promise.resolve()) },
}));
jest.mock('@/features/mint/components/rebalance', () => ({
  releaseTrustWindow: jest.requireActual('@/features/mint/components/rebalance/releaseTrustWindow')
    .releaseTrustWindow,
}));

const A = 'https://a.example';
const B = 'https://b.example';

function createFakeManager(meltState: 'finalized' | 'pending' = 'finalized') {
  let next = 0;
  const mintOps = new Map<string, Record<string, unknown>>();
  const invoiceOwner = new Map<string, string>();
  const meltInvoice = new Map<string, string>();
  const manager = {
    wallet: { balances: { byMint: jest.fn(async () => ({ [A]: { total: 1000 } })) } },
    proofService: { getReadyProofs: jest.fn(async () => [{ amount: 8 }]) },
    walletService: {
      getWallet: jest.fn(async () => ({
        getFeesForProofs: () => 0,
        createMeltQuoteBolt11: async () => ({ fee_reserve: 2 }),
      })),
    },
    quotes: {
      mint: { create: jest.fn(async () => ({ quoteId: `mint-q-${++next}` })) },
      melt: {
        create: jest.fn(async (input: { methodData: { invoice: string } }) => ({
          quoteId: `melt-q-${++next}`,
          invoice: input.methodData.invoice,
        })),
      },
    },
    ops: {
      mint: {
        prepare: jest.fn(
          async ({ quote, amount }: { quote: { quoteId: string }; amount: number }) => {
            const op = {
              id: `mint-op-${quote.quoteId}`,
              quoteId: quote.quoteId,
              mintUrl: B,
              method: 'bolt11',
              unit: 'sat',
              amount: Amount.from(amount),
              request: `lnbc-${quote.quoteId}`,
              state: 'pending',
            };
            mintOps.set(op.id, op);
            invoiceOwner.set(op.request, op.id);
            return op;
          }
        ),
        get: jest.fn(async (id: string) => mintOps.get(id) ?? null),
      },
      melt: {
        prepare: jest.fn(async ({ quote }: { quote: { quoteId: string; invoice: string } }) => {
          const id = `melt-op-${quote.quoteId}`;
          meltInvoice.set(id, quote.invoice);
          return { id, quoteId: quote.quoteId, amount: 100, fee_reserve: 2, swap_fee: 0 };
        }),
        execute: jest.fn(async (id: string) => {
          if (meltState === 'finalized') {
            const owner = invoiceOwner.get(meltInvoice.get(id) ?? '');
            const op = owner ? mintOps.get(owner) : undefined;
            if (op) op.state = 'finalized';
          }
          return { id, state: meltState };
        }),
        refresh: jest.fn(async (id: string) => ({ id, state: meltState })),
        get: jest.fn(async (id: string) => ({ id, state: meltState })),
      },
    },
    mint: { addMint: jest.fn(async () => {}), untrustMint: jest.fn(async () => {}) },
  };
  return manager;
}

function portFor(manager: ReturnType<typeof createFakeManager>) {
  return createCocoSingleLegTransferPort(
    manager as unknown as Parameters<typeof createCocoSingleLegTransferPort>[0],
    'sat',
    {
      lock: createRebalanceLock(),
      trustedMintUrls: new Set([A, B]),
      minTransferThreshold: 5,
      minFeeReserve: 5,
    }
  );
}

const LEG = {
  id: 'leg-1',
  sourceMintUrl: A,
  destinationMintUrl: B,
  destinationAmount: 100,
  unit: 'sat',
};

beforeEach(() => {
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('moves one leg with one mint quote and one melt, and returns only the leg id', async () => {
  const manager = createFakeManager();
  const port = portFor(manager);
  const outcome = await port.executeLeg(LEG);
  expect(outcome).toEqual({
    status: 'completed',
    id: 'leg-1',
    destinationAmount: 100,
    requestedAmount: 100,
  });
  expect(JSON.stringify(outcome)).not.toMatch(/mint-op|melt-op|-q-/);
  expect(manager.ops.mint.prepare).toHaveBeenCalledTimes(1);
  expect(manager.ops.melt.execute).toHaveBeenCalledTimes(1);

  await expect(port.executeLeg(LEG)).resolves.toEqual(outcome);
  expect(manager.ops.melt.execute).toHaveBeenCalledTimes(1);
});

it('never executes an unknown melt twice', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  try {
    const manager = createFakeManager('pending');
    const port = portFor(manager);
    const first = port.executeLeg(LEG);
    // The engine polls the melt for its settle window, then reports pending.
    await jest.runAllTimersAsync();
    await expect(first).resolves.toEqual({ status: 'pending', id: 'leg-1' });

    const again = port.executeLeg(LEG);
    await jest.runAllTimersAsync();
    await expect(again).resolves.toEqual({ status: 'pending', id: 'leg-1' });
    await expect(port.refreshLeg('leg-1')).resolves.toEqual({ status: 'pending', id: 'leg-1' });
    expect(manager.ops.melt.execute).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
