import { describe, expect, it } from 'vitest';

import { buildTimeline, getCardLabel } from '../../src/history';

describe('history timeline', () => {
  it('renders receive recovery as waiting to redeem', () => {
    const entry = {
      id: 'receive-op-1',
      type: 'receive',
      state: 'executing',
      mintUrl: 'https://mint.example.com',
      amount: 21,
      unit: 'sat',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      operationId: 'op-1',
    } as never;

    const timeline = buildTimeline({
      historyEntry: entry,
      currentTime: 1_700_000_000_000,
    });

    expect(timeline).toEqual([
      expect.objectContaining({
        state: 'accepted',
        displayLabel: 'Token accepted',
        stepType: 'complete',
      }),
      expect.objectContaining({
        state: 'executing',
        displayLabel: 'Waiting to redeem',
        stepType: 'waiting',
        info: "We'll add this ecash to your wallet when you're back online.",
      }),
      expect.objectContaining({
        state: 'redeemed',
        displayLabel: 'Added to wallet',
        stepType: 'future-small',
      }),
    ]);
    expect(getCardLabel(entry, timeline)).toBe('Receive • Waiting');
  });
});

describe('history timeline — onchain SEND (melt)', () => {
  const meltEntry = (state: string) =>
    ({
      id: 'melt-op-1',
      type: 'melt',
      state,
      mintUrl: 'https://mint.example.com',
      amount: 5_000,
      unit: 'sat',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      operationId: 'op-1',
      quoteId: 'mq-1',
      metadata: { method: 'onchain', onchainAddress: 'bc1qexample' },
    }) as never;

  const progress = (over: Record<string, unknown>) => ({
    hasPayment: false,
    hasUnconfirmedPayment: false,
    receivedSats: 0,
    currentConfirmations: null,
    requiredConfirmations: 6,
    isSatisfied: false,
    ...over,
  });

  it('PENDING, not yet broadcast → Paid / Broadcasting… / Confirmed', () => {
    const timeline = buildTimeline({
      historyEntry: meltEntry('pending'),
      currentTime: 1_700_000_000_000,
      onchainConfirmationProgress: progress({ hasPayment: false }),
    });
    expect(timeline).toEqual([
      expect.objectContaining({ displayLabel: 'Paid', stepType: 'complete' }),
      expect.objectContaining({
        displayLabel: 'Broadcasting…',
        stepType: 'current',
        info: 'Sending the transaction to the network',
      }),
      expect.objectContaining({ displayLabel: 'Confirmed', stepType: 'future-small' }),
    ]);
    // The broadcasting row shows no confirmation ring yet (no tx to count).
    expect(timeline[1].confirmationRing).toBeUndefined();
  });

  it('broadcast + confirming → "In mempool · N/6 blocks" with the ring', () => {
    const timeline = buildTimeline({
      historyEntry: meltEntry('PAID'),
      currentTime: 1_700_000_000_000,
      onchainConfirmationProgress: progress({ hasPayment: true, currentConfirmations: 3 }),
    });
    expect(timeline[1]).toMatchObject({
      displayLabel: 'In mempool',
      stepType: 'current',
      info: '3/6 blocks',
      confirmationRing: true,
    });
    expect(timeline[2]).toMatchObject({ displayLabel: 'Confirmed', stepType: 'future-small' });
  });

  it('fully confirmed → "Confirmed" success, mempool row complete', () => {
    const timeline = buildTimeline({
      historyEntry: meltEntry('PAID'),
      currentTime: 1_700_000_000_000,
      onchainConfirmationProgress: progress({
        hasPayment: true,
        currentConfirmations: 6,
        isSatisfied: true,
      }),
    });
    expect(timeline[1]).toMatchObject({ displayLabel: 'In mempool', stepType: 'complete' });
    expect(timeline[2]).toMatchObject({ displayLabel: 'Confirmed', stepType: 'success' });
  });

  // The mint can settle an onchain melt OFF-CHAIN (no outpoint / no broadcast).
  // The network phase collapses to one row and no step label claims on-chain.
  it('PAID + off-chain settlement → "Paid" / "Settled off-chain"', () => {
    const timeline = buildTimeline({
      historyEntry: meltEntry('PAID'),
      currentTime: 1_700_000_000_000,
      onchainConfirmationProgress: progress({ hasPayment: false, isSatisfied: true }),
      onchainSettledInternally: true,
    });
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ displayLabel: 'Paid', stepType: 'complete' });
    expect(timeline[1]).toMatchObject({
      displayLabel: 'Settled off-chain',
      stepType: 'success',
      info: 'No on-chain transaction',
    });
    const labelClaimsOnChain = timeline.some((item) => /on-chain|mempool/i.test(item.displayLabel));
    expect(labelClaimsOnChain).toBe(false);
  });

  // Device bug: a mint (cdk-ldk-bdk) settled off-chain but reported a state the
  // melt-state mapping didn't recognise, so meltState fell to UNPAID and "Paid"
  // rendered as a grey idle dot (with a grey connector) ABOVE the green "Settled
  // off-chain". onchainSettledInternally must force "Paid" complete regardless.
  it('off-chain settle with an unrecognised state → "Paid" still complete', () => {
    const timeline = buildTimeline({
      historyEntry: meltEntry('UNPAID'),
      currentTime: 1_700_000_000_000,
      onchainConfirmationProgress: progress({ hasPayment: false, isSatisfied: false }),
      onchainSettledInternally: true,
    });
    expect(timeline[0]).toMatchObject({ displayLabel: 'Paid', stepType: 'complete' });
    expect(timeline[1]).toMatchObject({ displayLabel: 'Settled off-chain', stepType: 'success' });
  });

  // coco v2 spells a reversed melt `rolled_back` (normalized to `rolledBack`);
  // without dedicated handling it collapsed to the UNPAID default and a
  // cancelled send rendered as if it were still waiting to be sent.
  it.each(['rolled_back', 'rolledBack', 'rolling_back', 'failed'])(
    '%s → Cancelled, funds returned (short-circuits before the onchain branch)',
    (state) => {
      const timeline = buildTimeline({
        historyEntry: meltEntry(state),
        currentTime: 1_700_000_000_000,
      });
      expect(timeline).toEqual([
        expect.objectContaining({ stepType: 'complete' }),
        expect.objectContaining({
          displayLabel: 'Cancelled',
          stepType: 'rolled-back',
          info: 'Funds returned to your balance',
        }),
      ]);
    }
  );
});

describe('history timeline — incoming payment request (receive)', () => {
  const base = {
    id: 'pr-op-1',
    type: 'receive',
    mintUrl: 'https://mint.example.com',
    amount: 100,
    unit: 'sat',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    operationId: 'op-1',
  };
  const build = (entry: unknown) =>
    buildTimeline({ historyEntry: entry as never, currentTime: 1_700_000_000_000 });

  it('pending request (paymentRequestPending) leads with "waiting for payment"', () => {
    // The list pending row is state:executing but must NOT read "redeeming".
    const timeline = build({
      ...base,
      state: 'executing',
      metadata: { source: 'payment-request', paymentRequestPending: '1' },
    });
    expect(timeline.map((t) => [t.displayLabel, t.stepType])).toEqual([
      ['Requested', 'next-pending'],
      ['Payment received', 'future-small'],
      ['Added to wallet', 'future-small'],
    ]);
    expect(timeline[0].info).toBe('Waiting for payment over Nostr…');
  });

  it('claim in progress (prepared) shows Payment received · Redeeming…', () => {
    const timeline = build({
      ...base,
      state: 'prepared',
      metadata: { source: 'payment-request' },
    });
    expect(timeline.map((t) => [t.displayLabel, t.stepType])).toEqual([
      ['Requested', 'complete'],
      ['Payment received', 'current'],
      ['Added to wallet', 'future-small'],
    ]);
    expect(timeline[1].info).toBe('Redeeming…');
  });

  it('finalized shows Added to wallet as success', () => {
    const timeline = build({
      ...base,
      state: 'finalized',
      metadata: { source: 'payment-request' },
    });
    expect(timeline.map((t) => [t.displayLabel, t.stepType])).toEqual([
      ['Requested', 'complete'],
      ['Payment received', 'complete'],
      ['Added to wallet', 'success'],
    ]);
    expect(timeline[2].info).toContain('100');
  });

  it('a plain token receive is unaffected (no PR metadata)', () => {
    const timeline = build({ ...base, id: 'receive-x', state: 'finalized' });
    expect(timeline.map((t) => t.displayLabel)).toEqual(['Pending', 'Added to wallet']);
  });
});
