/**
 * melt-outcome-unknown.test.ts — a Lightning payment that threw is not
 * thereby a payment that failed
 *
 * `ops.melt.execute` rejecting says the call ended badly, not that the mint
 * did not pay: the reply can be lost after the invoice was paid, and Coco
 * rethrows the first error even when its own recovery then found the payment
 * went through. For a Lightning address every new quote is a new invoice, so
 * offering Pay again after such a failure pays the same person twice.
 *
 * These run the real payment machine over the real default operations. Only
 * the Coco manager is a fake: it keeps each melt operation's state the way
 * Coco does and refuses a cancel Coco would refuse.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MintOperationError, NetworkError, OperationInProgressError, type Manager } from '@cashu/coco-core';

import { createDefaultOperations } from '../../src/operations/defaultOperations';
import { createTestMachine } from '../_harness';
import { INPUTS, MINT1, MINT2 } from '../_harness/fixtures';

const lnurl = vi.hoisted(() => ({ invoices: 0 }));
vi.mock('../../src/lnurl', async (actual) => ({
  ...(await actual<typeof import('../../src/lnurl')>()),
  // A Lightning address hands out a new invoice every time it is asked.
  requestInvoiceFromLnurl: async () => `lnbc-invoice-${++lnurl.invoices}`,
}));

/** What the mint and Coco do with one `execute`. */
type Fate =
  /** Paid, and the reply arrives. */
  | 'paid'
  /** Paid, the reply is lost, Coco's recovery sees it paid, and the first error is rethrown. */
  | 'paid-reply-lost'
  /** The request went out and nothing came back; recovery could not reach the mint either. */
  | 'no-answer'
  /** No answer, and the operation's saved state cannot be read afterwards. */
  | 'no-answer-unreadable'
  /** Recovery saw the quote PENDING before rethrowing the transport error. */
  | 'pending'
  /** Another execute holds the prepared operation and could still send it. */
  | 'another-execute'
  /** The mint refused it and Coco gave the inputs back. */
  | 'refused'
  /** It failed before anything was sent to the mint. */
  | 'never-sent';

interface FakeMelt {
  id: string;
  quoteId: string;
  invoice: string;
  state: string;
  createdAt: number;
  mintUrl: string;
  amount: number;
}

function fakeCoco(fates: Fate[]) {
  const melts = new Map<string, FakeMelt>();
  const unreadable = new Set<string>();
  const paidInvoices: string[] = [];
  let quotes = 0;
  const cancel = vi.fn(async (id: string) => {
    const melt = melts.get(id)!;
    if (melt.state !== 'prepared') {
      throw new Error(`Cannot rollback operation in state ${melt.state}`);
    }
    melt.state = 'rolled_back';
  });
  const execute = vi.fn(async (id: string) => {
    const melt = melts.get(id)!;
    const fate = fates.shift() ?? 'paid';
    switch (fate) {
      case 'paid':
        paidInvoices.push(melt.invoice);
        melt.state = 'finalized';
        return { ...melt };
      case 'paid-reply-lost':
        paidInvoices.push(melt.invoice);
        melt.state = 'finalized';
        throw new NetworkError('Network request failed');
      case 'no-answer':
        melt.state = 'executing';
        throw new NetworkError('Network request failed');
      case 'no-answer-unreadable':
        melt.state = 'executing';
        unreadable.add(id);
        throw new NetworkError('Network request failed');
      case 'pending':
        melt.state = 'pending';
        throw new NetworkError('Network request failed');
      case 'another-execute':
        throw new OperationInProgressError(id);
      case 'refused':
        melt.state = 'rolled_back';
        throw new MintOperationError(20004, 'Lightning payment failed');
      case 'never-sent':
        // Coco writes executing before calling the mint. A failed write
        // leaves the operation prepared and no request sent.
        throw new Error('Could not save executing state');
    }
  });
  const manager = {
    quotes: {
      melt: {
        create: async ({ methodData }: { methodData: { invoice: string } }) => ({
          quoteId: `quote-${++quotes}`,
          method: 'bolt11',
          amount: 200,
          fee_reserve: quotes === 1 ? 2 : 5,
          unit: 'sat',
          request: methodData.invoice,
        }),
      },
    },
    ops: {
      melt: {
        prepare: async ({ quote }: { quote: { quoteId: string; request: string } }) => {
          const melt: FakeMelt = {
            id: `melt-op-${melts.size + 1}`,
            quoteId: quote.quoteId,
            invoice: quote.request,
            state: 'prepared',
            createdAt: 1_700_000_000_000,
            mintUrl: MINT1,
            amount: 200,
          };
          melts.set(melt.id, melt);
          return { ...melt };
        },
        execute,
        cancel,
        get: async (id: string) => {
          if (unreadable.has(id)) throw new Error('database is closed');
          const melt = melts.get(id);
          return melt ? { ...melt } : null;
        },
      },
    },
  };
  return { manager, melts, paidInvoices, execute, cancel };
}

function setup(fates: Fate[]) {
  const coco = fakeCoco(fates);
  const ops = createDefaultOperations({
    getManager: () => coco.manager as unknown as Manager,
  });
  const tm = createTestMachine({
    operations: { quoteMelt: ops.quoteMelt, executeMelt: ops.executeMelt },
  });
  const notified = (key: string) => tm.notificationCalls.filter((c) => c.key === key);
  const previews = () => tm.handlerCalls.filter((c) => c.step === 'navigateToMeltPreview');
  return { ...coco, tm, notified, previews };
}

async function reachPreview(tm: ReturnType<typeof setup>['tm']) {
  await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
  await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
  tm.assertStep('navigateToMeltPreview');
}

beforeEach(() => {
  lnurl.invoices = 0;
});

describe('Pay after a Lightning payment that threw', () => {
  it.each(['paid-reply-lost', 'no-answer', 'no-answer-unreadable'] as const)(
    'does not send a replacement invoice on repeated Pay (%s)',
    async (fate) => {
      const { tm, execute } = setup([fate]);
      await reachPreview(tm);
      await tm.machine.confirmMelt();
      await tm.machine.confirmMelt();
      await tm.machine.confirmMelt();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(lnurl.invoices).toBe(1);
    },
  );

  it('settles as paid when Coco finalized the payment although execute threw', async () => {
    const { tm, paidInvoices, execute, cancel, notified } = setup(['paid-reply-lost']);
    await reachPreview(tm);

    await tm.machine.confirmMelt();

    expect(notified('onPaymentConfirmed')).toHaveLength(1);
    expect(notified('onPaymentConfirmed')[0]?.data).toMatchObject({
      historyEntry: expect.stringContaining('\"state\":\"PAID\"'),
    });
    expect(notified('onPaymentFailed')).toHaveLength(0);
    expect(cancel).not.toHaveBeenCalled();

    // The reviewer's sequence: Pay, then Pay twice more. Nothing else goes out.
    await tm.machine.confirmMelt();
    await tm.machine.confirmMelt();

    expect(paidInvoices).toEqual(['lnbc-invoice-1']);
    expect(lnurl.invoices).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    tm.assertStep('navigateToMeltPreview');
  });

  it.each(['no-answer', 'no-answer-unreadable', 'pending', 'another-execute'] as const)(
    'offers no second payment while the outcome is unknown (%s)',
    async (fate) => {
      const { tm, melts, execute, cancel, notified, previews } = setup([fate]);
      await reachPreview(tm);

      await tm.machine.confirmMelt();

      // The person is told it may still complete, in the wallet's own words.
      expect(notified('onPaymentConfirmed')).toHaveLength(0);
      expect(notified('onPaymentFailed').map((c) => c.data)).toEqual([
        expect.objectContaining({
          variant: 'melt',
          message: 'The payment may still complete. Check your history before you pay again.',
          authored: true,
        }),
      ]);
      // Nothing whose outcome is unknown is cancelled: Coco's recovery owns it.
      expect(cancel).not.toHaveBeenCalled();
      expect(melts.get('melt-op-1')!.state).toBe(
        fate === 'pending' ? 'pending' : fate === 'another-execute' ? 'prepared' : 'executing',
      );

      // Pay, the mint list and the same mint again change nothing.
      const shown = previews().length;
      await tm.machine.confirmMelt();
      await tm.machine.requestMintSelector();
      await tm.machine.changeMint(MINT1);
      await tm.machine.changeMint(MINT2);
      await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
      await tm.machine.confirmMelt();

      expect(lnurl.invoices).toBe(1);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(previews()).toHaveLength(shown);
      tm.assertStep('navigateToMeltPreview');
      expect(tm.machine.inspect().isExecuting).toBe(false);
    },
  );

  it('still lets a new scan start a new payment after an unknown outcome', async () => {
    const { tm, paidInvoices } = setup(['no-answer', 'paid']);
    await reachPreview(tm);
    await tm.machine.confirmMelt();

    await reachPreview(tm);
    await tm.machine.confirmMelt();

    expect(paidInvoices).toEqual(['lnbc-invoice-2']);
  });

  it('shows a new quote and pays it once the mint is known to have refused', async () => {
    const { tm, paidInvoices, cancel, notified, previews } = setup(['refused', 'paid']);
    await reachPreview(tm);

    await tm.machine.confirmMelt();
    expect(notified('onPaymentFailed').map((c) => c.data)).toEqual([
      expect.objectContaining({ message: 'Lightning payment failed' }),
    ]);
    // Coco already gave the inputs back: there is nothing to cancel.
    expect(cancel).not.toHaveBeenCalled();

    await tm.machine.confirmMelt();
    expect(previews().at(-1)?.data).toMatchObject({
      phase: { kind: 'preview' },
      meltQuote: { quoteId: 'quote-2', feeReserve: 5 },
    });
    expect(paidInvoices).toEqual([]);

    await tm.machine.confirmMelt();
    expect(paidInvoices).toEqual(['lnbc-invoice-2']);
  });

  it('releases the reservation and retries when nothing was sent to the mint', async () => {
    const { tm, melts, paidInvoices, cancel } = setup(['never-sent', 'paid']);
    await reachPreview(tm);

    await tm.machine.confirmMelt();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('melt-op-1', 'Execute failed');
    expect(melts.get('melt-op-1')!.state).toBe('rolled_back');

    await tm.machine.confirmMelt();
    await tm.machine.confirmMelt();
    expect(paidInvoices).toEqual(['lnbc-invoice-2']);
  });
});
