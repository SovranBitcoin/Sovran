import { describe, expect, it } from 'vitest';

import {
  transactionHeaderPhase,
  transactionHeaderRail,
  transactionHeaderTitle,
} from '../../src/history';

describe('transaction header titles', () => {
  it('reads the rail off the entry type and its onchain annotation', () => {
    expect(transactionHeaderRail({ type: 'melt' })).toBe('lightningSend');
    expect(transactionHeaderRail({ type: 'mint' })).toBe('lightningReceive');
    expect(transactionHeaderRail({ type: 'send' })).toBe('ecashSend');
    expect(transactionHeaderRail({ type: 'receive' })).toBe('ecashReceive');
    expect(
      transactionHeaderRail({
        type: 'melt',
        metadata: { method: 'onchain', onchainAddress: 'bc1qexample' },
      })
    ).toBe('onchainSend');
  });

  it('reads the same state differently on either side of the wallet', () => {
    // A melt's `pending` is a payment in flight; a mint quote's is nobody
    // having paid yet.
    expect(transactionHeaderPhase({ type: 'melt', state: 'pending' })).toBe('inFlight');
    expect(transactionHeaderPhase({ type: 'mint', state: 'pending' })).toBe('ready');
    expect(transactionHeaderPhase({ type: 'melt', state: 'prepared' })).toBe('ready');
    expect(transactionHeaderPhase({ type: 'melt', state: 'finalized' })).toBe('settled');
    // Rollback returned the funds, usually on request — not a failure.
    expect(transactionHeaderPhase({ type: 'melt', state: 'rolled_back' })).toBe('cancelled');
    expect(transactionHeaderPhase({ type: 'melt', state: 'failed' })).toBe('failed');
  });

  it('never tells the user to send a payment that already happened', () => {
    expect(transactionHeaderTitle({ type: 'melt', state: 'prepared' })).toBe('Send Lightning');
    expect(transactionHeaderTitle({ type: 'melt', state: 'pending' })).toBe('Sending Lightning');
    expect(transactionHeaderTitle({ type: 'melt', state: 'finalized' })).toBe('Sent Lightning');
    expect(transactionHeaderTitle({ type: 'mint', state: 'finalized' })).toBe(
      'Received Lightning'
    );
  });

  it('names the person instead of the rail, in the transaction’s own tense', () => {
    const paid = { type: 'melt', state: 'finalized' };
    expect(transactionHeaderTitle(paid, { counterpartyName: 'Alex' })).toBe('Paid Alex');
    expect(
      transactionHeaderTitle({ type: 'melt', state: 'prepared' }, { counterpartyName: 'Alex' })
    ).toBe('Pay Alex');
    expect(
      transactionHeaderTitle({ type: 'melt', state: 'pending' }, { counterpartyName: 'Alex' })
    ).toBe('Paying Alex');
    // Incoming keeps its own phrasing — a receive is never "Paid Alex".
    expect(
      transactionHeaderTitle({ type: 'mint', state: 'finalized' }, { counterpartyName: 'Alex' })
    ).toBe('Received from Alex');
  });

  it('names a reclaimed ecash send as cancelled, not failed', () => {
    expect(transactionHeaderTitle({ type: 'send', state: 'rolledBack' })).toBe('Cancelled ecash');
    expect(transactionHeaderTitle({ type: 'send', state: 'rolled_back' })).toBe('Cancelled ecash');
    expect(transactionHeaderTitle({ type: 'melt', state: 'rolled_back' })).toBe(
      'Cancelled payment'
    );
    expect(
      transactionHeaderTitle({ type: 'melt', state: 'rolled_back' }, { counterpartyName: 'Alex' })
    ).toBe('Payment cancelled');
  });

  it('falls back to the past tense for a state it does not know', () => {
    expect(transactionHeaderTitle({ type: 'melt', state: 'something-new' })).toBe(
      'Sent Lightning'
    );
  });

  it('ignores a blank counterparty name', () => {
    expect(transactionHeaderTitle({ type: 'melt', state: 'prepared' }, { counterpartyName: ' ' })).toBe(
      'Send Lightning'
    );
  });
});
