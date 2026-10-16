import { describe, expect, it, vi } from 'vitest';

// These describe a lock that can be taken back. The wallet ships with that
// switched off (`reclaimGate.ts`), so it is switched on here to keep the
// behaviour specified for the day it returns. `reclaim-gate.test.ts` covers
// what ships.
vi.mock('../../src/p2pk/reclaimGate', () => ({ P2PK_RECLAIM_ENABLED: true }));

import { mergeEntryUpdate } from '../../src/screen-actions/createManager';
import {
  bucketTransaction,
  buildTimeline,
  buildTimelineModel,
  getCardLabel,
  getStatusColorType,
  getStatusHeader,
  normalizeHistoryEntry,
} from '../../src/history';

const CREATED_AT = 1_700_000_000_000;
const base = {
  mintUrl: 'https://mint.example.com',
  unit: 'sat',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  operationId: 'op-1',
};

type Input = Parameters<typeof buildTimeline>[0];
const build = (historyEntry: unknown, extra: Partial<Input> = {}) =>
  buildTimeline({ historyEntry: historyEntry as never, currentTime: CREATED_AT, ...extra });

/** One line per row: what kind of row it is, what it says, and its subline. */
const rows = (timeline: ReturnType<typeof buildTimeline>) =>
  timeline.map((row) => `${row.stepType} | ${row.displayLabel}${row.info ? ` | ${row.info}` : ''}`);

const ONCHAIN = { method: 'onchain', onchainAddress: 'bc1qexample' };

describe('history timeline — token receive', () => {
  const receive = (state: string, error?: string) => ({
    ...base,
    id: 'receive-op-1',
    type: 'receive',
    state,
    amount: 21,
    ...(error ? { error } : {}),
  });

  it('a token waiting on a tap opens the "added" slot', () => {
    expect(rows(build(receive('prepared')))).toEqual([
      'complete | Token accepted',
      'next-pending | Ready to redeem | Tap Redeem to add to wallet',
    ]);
  });

  it('a receive stuck executing is the SAME slot, stalled — not a different timeline', () => {
    const entry = receive('executing');
    const timeline = build(entry);
    expect(rows(timeline)).toEqual([
      'complete | Token accepted',
      "waiting | Waiting to redeem | We'll add this ecash to your wallet when you're back online.",
    ]);
    expect(getCardLabel(entry as never, timeline)).toBe('Receive • Waiting');
    expect(getStatusColorType(timeline)).toBe('warning');
  });

  it('finalized closes the slot as the success row', () => {
    expect(rows(build(receive('finalized')))).toEqual([
      'complete | Token accepted',
      'success | Added to wallet | +21 sats added to wallet',
    ]);
  });

  it('says "already spent" only when the mint said so', () => {
    expect(rows(build(receive('rolled_back', 'Token already spent')))[1]).toBe(
      'already-spent | Already spent | The mint reports this token as spent'
    );
    expect(rows(build(receive('rolledBack', 'Keyset is inactive (12002)')))[1]).toMatch(
      /^already-spent \| Not added/
    );
    expect(rows(build(receive('rolled_back')))[1]).toMatch(/^already-spent \| Not added/);
  });
});

describe('history timeline — lightning SEND (melt)', () => {
  const melt = (state: string, extra: Record<string, unknown> = {}) => ({
    ...base,
    id: 'melt-op-1',
    type: 'melt',
    state,
    amount: 5_000,
    quoteId: 'mq-1',
    ...extra,
  });

  it('walks prepared → handed to the mint → paid, one row at a time', () => {
    expect(rows(build(melt('UNPAID')))).toEqual([
      'complete | Payment prepared',
      'next-pending | Ready to send | Tap Send to complete payment',
    ]);
    expect(rows(build(melt('PENDING')))).toEqual([
      'complete | Payment prepared',
      'complete | Ecash sent to mint',
      'current | Paying | The mint is sending the payment',
    ]);
    expect(rows(build(melt('PAID')))).toEqual([
      'complete | Payment prepared',
      'complete | Ecash sent to mint',
      'success | Paid | Payment complete',
    ]);
  });

  it('a quote that runs out before the tap expires in the open slot', () => {
    const quote = { expiry: Math.floor(CREATED_AT / 1000) - 60 } as never;
    const timeline = build(melt('UNPAID'), { meltQuote: quote });
    expect(rows(timeline)).toEqual([
      'complete | Payment prepared',
      'expired | Quote expired | It ran out before the payment was sent',
    ]);
    expect(getStatusColorType(timeline)).toBe('error');
  });

  it('rolling_back is the reversal in flight, not its result', () => {
    expect(rows(build(melt('rolling_back')))).toEqual([
      'complete | Payment prepared',
      'current | Cancelling | Returning ecash to your balance',
    ]);
  });

  it.each(['rolled_back', 'rolledBack', 'failed'])(
    '%s without a recorded reason reads as the user backing out',
    (state) => {
      expect(rows(build(melt(state)))).toEqual([
        'complete | Payment prepared',
        'rolled-back | Cancelled | Funds returned to your balance',
      ]);
    }
  );

  it.each(['Rollback requested by handler', 'Recovered: Swap happened but melt failed', 'anything a newer coco says'])(
    'any reason other than the user backing out is a failed payment (%s)',
    (error) => {
      const failed = melt('rolled_back', { error });
      const timeline = build(failed);
      expect(rows(timeline)[1]).toBe('rolled-back | Payment failed | Funds returned to your balance');
    }
  );

  it('the user backing out leaves a reason too, and is still a cancellation', () => {
    expect(rows(build(melt('rolled_back', { error: 'User cancelled' })))[1]).toBe(
      'rolled-back | Cancelled | Funds returned to your balance'
    );
  });

  it('a payment in flight for minutes says it is slow, and that the ecash is held', () => {
    const paying = melt('PENDING', { updatedAt: CREATED_AT + 1_000 });
    const early = buildTimelineModel({ historyEntry: paying as never, currentTime: CREATED_AT + 5_000 });
    expect(early.steps[2].stepType).toBe('current');
    // The model says when to look again, so the card needs no polling.
    expect(early.recheckAt).toBe(CREATED_AT + 1_000 + 120_000);
    const late = buildTimelineModel({ historyEntry: paying as never, currentTime: early.recheckAt! });
    expect(late.steps[2]).toMatchObject({ stepType: 'waiting', displayLabel: 'Paying' });
    expect(late.steps[2].info).toContain('stays held');
    expect(late.recheckAt).toBeUndefined();
  });

  it('a reversal that never finishes stops implying it is about to', () => {
    const stuck = melt('rolling_back', { updatedAt: CREATED_AT + 1_000 });
    const late = build(stuck, { currentTime: CREATED_AT + 10 * 60_000 });
    expect(rows(late)[1]).toBe(
      'waiting | Cancelling | This has not finished. Your ecash is still held and may need recovering.'
    );
  });

  it('with no record of when the payment was sent, it is never called slow', () => {
    // An entry built from a live operation event may carry only createdAt,
    // which is when the QUOTE was made — possibly long before the tap.
    const { updatedAt: _dropped, ...noUpdatedAt } = melt('PENDING');
    const model = buildTimelineModel({
      historyEntry: noUpdatedAt as never,
      currentTime: CREATED_AT + 3_600_000,
    });
    expect(model.steps[2].stepType).toBe('current');
    expect(model.recheckAt).toBeUndefined();
  });

  it('a failed payment and a cancellation get different headers', () => {
    const failed = melt('rolled_back', { error: 'Recovered: payment failed' });
    expect(getCardLabel(failed as never, buildTimelineModel({ historyEntry: failed as never, currentTime: CREATED_AT }).steps)).toBe(
      'Send • Failed'
    );
    const cancelled = melt('rolled_back', { error: 'User cancelled' });
    expect(getCardLabel(cancelled as never, buildTimelineModel({ historyEntry: cancelled as never, currentTime: CREATED_AT }).steps)).toBe(
      'Send • Cancelled'
    );
  });

  it('the header follows the rows, not the raw state', () => {
    const reversing = build(melt('rolling_back'));
    expect(getCardLabel(melt('rolling_back') as never, reversing)).toBe('Send • In Progress');
    const paid = build(melt('finalized'));
    expect(getCardLabel(melt('finalized') as never, paid)).toBe('Send • Complete');
    const ready = build(melt('prepared'));
    expect(getCardLabel(melt('prepared') as never, ready)).toBe('Send • Ready');
  });

  it('a reversal coco recorded a reason for reads as a failed payment', () => {
    expect(rows(build(melt('rolled_back', { error: 'Recovered: payment failed' })))[1]).toBe(
      'rolled-back | Payment failed | Funds returned to your balance'
    );
  });
});

describe('history timeline — onchain SEND (melt)', () => {
  const melt = (state: string) => ({
    ...base,
    id: 'melt-op-1',
    type: 'melt',
    state,
    amount: 5_000,
    quoteId: 'mq-1',
    metadata: ONCHAIN,
  });
  const progress = (over: Record<string, unknown> = {}) => ({
    hasPayment: false,
    hasUnconfirmedPayment: false,
    receivedSats: 0,
    currentConfirmations: null,
    requiredConfirmations: 6,
    isSatisfied: false,
    ...over,
  });

  // Before the mint accepts, nothing may pre-claim completion.
  it('UNPAID (submitting) → the hand-over spins, nothing else is drawn', () => {
    expect(rows(build(melt('UNPAID'), { onchainConfirmationProgress: progress() }))).toEqual([
      'complete | Payment prepared',
      'current | Sending to mint | Submitting payment…',
    ]);
  });

  it('PENDING, not yet broadcast → handed over, broadcasting', () => {
    expect(rows(build(melt('pending'), { onchainConfirmationProgress: progress() }))).toEqual([
      'complete | Payment prepared',
      'complete | Ecash sent to mint',
      'current | Broadcasting | Sending the transaction to the network',
    ]);
  });

  it('in the mempool, then counting blocks, with the ring on the open row', () => {
    const mempool = build(melt('pending'), {
      onchainConfirmationProgress: progress({ hasPayment: true, hasUnconfirmedPayment: true }),
    });
    expect(rows(mempool)).toEqual([
      'complete | Payment prepared',
      'complete | Ecash sent to mint',
      'complete | Broadcast',
      'current | In mempool | 0/6 blocks',
    ]);
    expect(mempool.map((row) => !!row.confirmationRing)).toEqual([false, false, false, true]);

    const counting = build(melt('pending'), {
      onchainConfirmationProgress: progress({ hasPayment: true, currentConfirmations: 2 }),
    });
    expect(rows(counting)[3]).toBe('current | Confirming | 2/6 blocks');
  });

  it('fully confirmed → "Confirmed" success, and the ring stays on its row', () => {
    const timeline = build(melt('PAID'), {
      onchainConfirmationProgress: progress({
        hasPayment: true,
        currentConfirmations: 6,
        isSatisfied: true,
      }),
    });
    expect(rows(timeline)).toEqual([
      'complete | Payment prepared',
      'complete | Ecash sent to mint',
      'complete | Broadcast',
      'success | Confirmed',
    ]);
    expect(timeline[3].confirmationRing).toBe(true);
  });

  // The mint and our explorer are separate observers; either may get there
  // first, and the timeline follows whichever does.
  it('mint says PAID while our explorer is still counting → confirmed, not "3/6"', () => {
    const timeline = build(melt('PAID'), {
      onchainConfirmationProgress: progress({ hasPayment: true, currentConfirmations: 3 }),
    });
    expect(rows(timeline)[3]).toBe('success | Confirmed');
  });

  it('our explorer reaching the depth does not finish the payment: that is the mint\'s to say', () => {
    const deep = progress({ hasPayment: true, currentConfirmations: 6, isSatisfied: true });
    const timeline = build(melt('pending'), { onchainConfirmationProgress: deep });
    expect(rows(timeline)[3]).toBe(
      'next-pending | Waiting for the mint | Deep enough by our count. The mint confirms it once its own node agrees.'
    );
    expect(getCardLabel(melt('pending') as never, timeline)).toBe('Send • In Progress');
    // The mint can still reverse a melt it has not settled; nothing above
    // may have said the payment was complete.
    expect(rows(build(melt('PAID'), { onchainConfirmationProgress: deep }))[3]).toBe(
      'success | Confirmed'
    );
  });

  it('PAID with nothing on the explorer is not called confirmed', () => {
    const timeline = build(melt('PAID'), { onchainConfirmationProgress: progress() });
    expect(rows(timeline)[2]).toBe('current | Paid by the mint | Looking for the transaction');
  });

  it('PAID with no transaction → settles off-chain in the slot that awaited the broadcast', () => {
    const timeline = build(melt('PAID'), {
      onchainConfirmationProgress: progress(),
      onchainSettledInternally: true,
    });
    expect(rows(timeline)).toEqual([
      'complete | Payment prepared',
      'complete | Ecash sent to mint',
      'success | Paid by the mint | The mint reported no on-chain transaction',
    ]);
    expect(getStatusColorType(timeline)).toBe('success');
  });

  it('off-chain settle with an unrecognised state → the hand-over is still complete', () => {
    const timeline = build(melt('SETTLED_WEIRDLY'), {
      onchainConfirmationProgress: progress(),
      onchainSettledInternally: true,
    });
    expect(rows(timeline).slice(0, 2)).toEqual([
      'complete | Payment prepared',
      'complete | Ecash sent to mint',
    ]);
  });

  it.each(['rolled_back', 'rolledBack', 'failed'])('%s → funds returned', (state) => {
    const timeline = build(melt(state), { onchainConfirmationProgress: progress() });
    expect(rows(timeline)).toEqual([
      'complete | Payment prepared',
      'rolled-back | Cancelled | Funds returned to your balance',
    ]);
    expect(getStatusHeader(timeline)).toBe('CANCELLED');
  });
});

describe('history timeline — bearer SEND', () => {
  const send = (state: string, extra: Record<string, unknown> = {}) => ({
    ...base,
    id: 'send-op-1',
    type: 'send',
    state,
    amount: 100,
    ...extra,
  });

  it.each(['prepared', 'executing'])('%s → the token is still being made', (state) => {
    expect(rows(build(send(state)))).toEqual(['current | Creating token | Setting aside ecash']);
  });

  it('pending → created, waiting on the recipient', () => {
    expect(rows(build(send('pending')))).toEqual([
      'complete | Created',
      'next-pending | Waiting for recipient | Not claimed yet',
    ]);
  });

  it('finalized → claimed', () => {
    expect(rows(build(send('finalized')))).toEqual([
      'complete | Created',
      'success | Claimed | The token has been redeemed',
    ]);
  });

  it('a cancel tap and coco\'s own rolling_back draw the same in-flight row', () => {
    const expected = ['complete | Created', 'current | Cancelling | Returning ecash to your balance'];
    expect(rows(build(send('pending'), { cancelling: true }))).toEqual(expected);
    expect(rows(build(send('rolling_back', { token: { proofs: [{ secret: 'x' }] } })))).toEqual(expected);
  });

  it('a rolled-back send keeps "Created" only when a token was actually made', () => {
    expect(rows(build(send('rolled_back')))).toEqual([
      'rolled-back | Cancelled | Funds returned to your balance',
    ]);
    expect(rows(build(send('rolled_back', { token: { proofs: [{ secret: 'x' }] } })))).toEqual([
      'complete | Created',
      'rolled-back | Cancelled | Funds returned to your balance',
    ]);
  });
});

describe('history timeline — outgoing payment request', () => {
  const send = (state: string) => ({ ...base, id: 'send-pr-1', type: 'send', state, amount: 100 });

  it('walks token → delivery → claim', () => {
    expect(rows(build(send('prepared'), { tokenCreated: false }))).toEqual([
      'current | Creating token | Setting aside ecash',
    ]);
    expect(rows(build(send('pending'), { tokenCreated: true, nostrSent: false }))).toEqual([
      'complete | Created',
      'current | Delivering | Sending to the recipient',
    ]);
    expect(rows(build(send('pending'), { tokenCreated: true, nostrSent: true }))).toEqual([
      'complete | Created',
      'complete | Delivered | Sent to the recipient',
      'next-pending | Waiting for recipient | Not claimed yet',
    ]);
    const done = build(send('finalized'), { tokenCreated: true, nostrSent: true });
    expect(rows(done)[2]).toBe('success | Claimed | The token has been redeemed');
    expect(getCardLabel(send('finalized') as never, done, true, true)).toBe('Payment • Complete');
  });

  it('a paid request reopened from history is still a request, from its record alone', () => {
    // No live flags: only what was written down when it was handed over.
    const reopened = {
      ...send('pending'),
      metadata: { paymentRequestRole: 'payer', paymentRequestTransport: 'http' },
    };
    const timeline = build(reopened);
    expect(rows(timeline)).toEqual([
      'complete | Created',
      "complete | Delivered | Sent to the recipient's server",
      'next-pending | Waiting for recipient | Not claimed yet',
    ]);
    expect(getCardLabel(reopened as never, timeline)).toBe('Payment • In Progress');
  });

  it('a preview the user has not confirmed is waiting on them, not working', () => {
    const preview = { ...send('prepared'), metadata: { phase: 'preview' } };
    expect(rows(build(preview, { tokenCreated: false }))).toEqual([
      'next-pending | Ready to pay | Nothing has been sent yet',
    ]);
  });

  it('a cancelled request keeps exactly the steps that happened', () => {
    expect(rows(build(send('rolled_back'), { tokenCreated: true, nostrSent: true }))).toHaveLength(3);
    expect(rows(build(send('rolled_back'), { tokenCreated: true, nostrSent: false }))).toHaveLength(2);
  });
});

describe('history timeline — incoming payment request (receive)', () => {
  const receive = (state: string, metadata: Record<string, string>) => ({
    ...base,
    id: 'pr-op-1',
    type: 'receive',
    state,
    amount: 100,
    metadata,
  });

  it('pending request (paymentRequestPending) leads with "waiting for payment"', () => {
    // The list's pending row is `executing`; the flag must win over the state.
    expect(rows(build(receive('executing', { paymentRequestPending: '1' })))).toEqual([
      'complete | Requested',
      'next-pending | Waiting for payment | Waiting for payment over Nostr…',
    ]);
  });

  it('claim in progress shows Payment received, then adding', () => {
    expect(rows(build(receive('prepared', { source: 'payment-request' })))).toEqual([
      'complete | Requested',
      'complete | Payment received',
      'current | Adding to wallet | Redeeming…',
    ]);
  });

  it('finalized shows Added to wallet as success', () => {
    const timeline = build(receive('finalized', { source: 'payment-request' }));
    expect(rows(timeline)[2]).toBe('success | Added to wallet | +100 sats added to wallet');
    expect(getStatusColorType(timeline)).toBe('success');
  });

  it('a payment that could not be added still shows it arrived', () => {
    expect(
      rows(build({ ...receive('rolled_back', { source: 'payment-request' }), error: 'Token already spent' }))
    ).toEqual([
      'complete | Requested',
      'complete | Payment received',
      'already-spent | Already spent | The mint reports this token as spent',
    ]);
  });
});

describe('history timeline — mint (receive) arms', () => {
  const mint = (state: string, extra: Record<string, unknown> = {}) => ({
    ...base,
    id: 'mint-op-1',
    type: 'mint',
    state,
    amount: 21_000,
    quoteId: 'q1',
    paymentRequest: '',
    ...extra,
  });
  const onchain = (state: string) => mint(state, { metadata: ONCHAIN });
  const progress = (currentConfirmations: number | null, hasPayment = true) => ({
    hasPayment,
    hasUnconfirmedPayment: currentConfirmations == null && hasPayment,
    receivedSats: hasPayment ? 21_000 : 0,
    currentConfirmations,
    requiredConfirmations: 6,
    isSatisfied: currentConfirmations != null && currentConfirmations >= 6,
  });

  it('lightning: invoice → payment → added', () => {
    const waiting = build(mint('UNPAID'));
    expect(rows(waiting)).toEqual([
      'complete | Invoice created',
      'next-pending | Waiting for payment | Pay the invoice to receive funds',
    ]);
    expect(getCardLabel(mint('UNPAID') as never, waiting)).toBe('Receive • Awaiting Payment');

    const paid = build(mint('PAID'));
    expect(rows(paid)).toEqual([
      'complete | Invoice created',
      'complete | Payment received',
      'current | Adding to wallet | Collecting your ecash from the mint',
    ]);
    expect(getCardLabel(mint('PAID') as never, paid)).toBe('Receive • In Progress');

    expect(rows(build(mint('ISSUED')))[2]).toBe(
      'success | Added to wallet | +21000 sats added to wallet'
    );
  });

  it('the mint having issued is not the wallet having the ecash', () => {
    // coco puts the operation back to pending when issued outputs cannot be
    // restored: the payment is proven, the credit is not.
    expect(rows(build(mint('pending', { remoteState: 'ISSUED' })))).toEqual([
      'complete | Invoice created',
      'complete | Payment received',
      'current | Adding to wallet | Collecting your ecash from the mint',
    ]);
  });

  it('a mint finished with nothing restored does not say "Added to wallet"', () => {
    const timeline = build(
      mint('finalized', { error: 'Recovered issued quote but no proofs could be restored' })
    );
    expect(rows(timeline)).toEqual([
      'complete | Invoice created',
      'complete | Payment received',
      'expired | Not added | The mint issued this ecash but it could not be restored',
    ]);
  });

  it('an error left over from an attempt that later succeeded is not a failure', () => {
    // The live entry merge keeps fields an update omits, so a retry that
    // worked can still be carrying the failed attempt's reason.
    expect(rows(build(mint('finalized', { error: 'Network request failed' })))[2]).toBe(
      'success | Added to wallet | +21000 sats added to wallet'
    );
  });

  it('a retry that succeeds sheds the failed attempt\'s reason in the live merge', () => {
    // coco's projection omits `error` once it is cleared, and the merge used
    // to keep whatever the update left out.
    const stuck = mint('pending', {
      error: 'Recovered issued quote q1 but no proofs could be restored',
    });
    const succeeded = mint('finalized');
    const merged = mergeEntryUpdate(stuck as never, succeeded as never);
    expect(merged.error).toBeUndefined();
    expect(rows(build(merged))[2]).toBe('success | Added to wallet | +21000 sats added to wallet');
  });

  it('a failed mint survives the history list, which hands it over as UNPAID', () => {
    const fromList = normalizeHistoryEntry(mint('failed', { source: 'operation' }) as never);
    expect((fromList as { state: string }).state).toBe('UNPAID');
    expect(rows(build(fromList))[1]).toBe('expired | Failed | Receive could not be completed');
    // And the list no longer files it under Pending.
    expect(bucketTransaction(fromList)).toBe('expired');
  });

  it('a mint that fails before payment fails in the payment slot', () => {
    const timeline = build(mint('failed'));
    expect(rows(timeline)).toEqual([
      'complete | Invoice created',
      'expired | Failed | Receive could not be completed',
    ]);
    expect(getCardLabel(mint('failed') as never, timeline)).toBe('Receive • Failed');
  });

  it('a mint that fails AFTER payment keeps "Payment received" — that money moved', () => {
    expect(rows(build(mint('failed', { remoteState: 'PAID' })))).toEqual([
      'complete | Invoice created',
      'complete | Payment received',
      'expired | Failed | The payment arrived but the mint did not issue ecash',
    ]);
  });

  it('the mint\'s own reason wins over the stock one', () => {
    expect(rows(build(mint('failed', { error: 'Quote expired (20007)' })))[1]).toBe(
      'expired | Failed | Quote expired (20007)'
    );
  });

  it('onchain deposit: no payment observed → still waiting (no over-claim)', () => {
    expect(rows(build(onchain('UNPAID'), { onchainConfirmationProgress: progress(null, false) }))).toEqual([
      'complete | Address created',
      'next-pending | Waiting for deposit | Pay the address to receive funds',
    ]);
  });

  it('onchain deposit: in the mempool while the quote is UNPAID → detected, never "Payment received"', () => {
    const timeline = build(onchain('UNPAID'), { onchainConfirmationProgress: progress(null) });
    expect(rows(timeline)).toEqual([
      'complete | Address created',
      'complete | Deposit detected',
      'next-pending | Confirming on-chain | Waiting for first confirmation',
    ]);
    expect(timeline[2].confirmationRing).toBe(true);
    expect(rows(timeline).join()).not.toContain('Payment received');
    expect(getCardLabel(onchain('UNPAID') as never, timeline)).toBe('Receive • In Progress');
  });

  it('onchain deposit: counting blocks spins from the first one', () => {
    expect(
      rows(build(onchain('UNPAID'), { onchainConfirmationProgress: progress(2) }))[2]
    ).toBe('current | Confirming on-chain | 2/6 confirmations');
  });

  it('onchain deposit: deep enough but the quote is still UNPAID → waiting on the mint', () => {
    expect(rows(build(onchain('UNPAID'), { onchainConfirmationProgress: progress(6) }))).toEqual([
      'complete | Address created',
      'complete | Deposit detected',
      'complete | Confirmed on-chain',
      'next-pending | Waiting for mint to credit | Deep enough by our count. The mint credits it once its own node agrees.',
    ]);
  });

  // The mint credits from its own node; our explorer is only a hint. Running
  // a block or two ahead of it is lag. Running well past it is not.
  it('onchain deposit: our count far past the requirement and still no credit → says so', () => {
    const overdue = { ...progress(6), observedConfirmations: 9, requirementFromMint: true };
    const timeline = build(onchain('UNPAID'), { onchainConfirmationProgress: overdue });
    expect(timeline[3]).toMatchObject({
      stepType: 'waiting',
      displayLabel: 'Not credited by the mint',
    });
    expect(timeline[3].info).toContain('below their minimum');
    expect(getStatusColorType(timeline)).toBe('warning');

    // One block past is still just lag.
    const lagging = { ...progress(6), observedConfirmations: 7, requirementFromMint: true };
    expect(build(onchain('UNPAID'), { onchainConfirmationProgress: lagging })[3].stepType).toBe(
      'next-pending'
    );
    // Against a depth we only assumed, the mint may simply want more blocks:
    // that is never reported as the mint failing to credit.
    const guessed = { ...progress(6), observedConfirmations: 30 };
    expect(build(onchain('UNPAID'), { onchainConfirmationProgress: guessed })[3].stepType).toBe(
      'next-pending'
    );
    // And the mint crediting ends the warning, whatever our count was.
    expect(rows(build(onchain('PAID'), { onchainConfirmationProgress: overdue }))[3]).toBe(
      'current | Adding to wallet | Collecting your ecash from the mint'
    );
  });

  it('onchain deposit: "deep enough" is only said while our explorer still says so', () => {
    // "Confirmed" was drawn against an assumed 6 blocks; the mint's real
    // requirement (12) then loaded. The row stays, but the slot below it must
    // not go on claiming our count is deep enough — or warn about the mint.
    const nineOfTwelve = {
      ...progress(9),
      requiredConfirmations: 12,
      isSatisfied: false,
      observedConfirmations: 9,
    };
    const timeline = build(onchain('UNPAID'), {
      onchainConfirmationProgress: nineOfTwelve,
      doneRowKeys: ['created', 'deposit', 'confirmed'],
    });
    expect(rows(timeline)[3]).toBe(
      'next-pending | Waiting for mint to credit | The mint has not credited the deposit yet'
    );
    // Same when the explorer has nothing at all to say any more.
    expect(
      rows(build(onchain('UNPAID'), { doneRowKeys: ['created', 'deposit', 'confirmed'] }))[3]
    ).toBe('next-pending | Waiting for mint to credit | The mint has not credited the deposit yet');
  });

  it('onchain deposit: a credit from the mint proves the chain steps even with no explorer', () => {
    expect(rows(build(onchain('PAID')))).toEqual([
      'complete | Address created',
      'complete | Deposit detected',
      'complete | Confirmed on-chain',
      'current | Adding to wallet | Collecting your ecash from the mint',
    ]);
  });

  it('onchain deposit: ISSUED → success terminal', () => {
    const timeline = build(onchain('ISSUED'), { onchainConfirmationProgress: progress(6) });
    expect(rows(timeline)[3]).toBe('success | Added to wallet | +21000 sats added to wallet');
  });

  it('onchain deposit: a transaction that leaves the mempool is said to have left', () => {
    const timeline = build(onchain('UNPAID'), {
      onchainConfirmationProgress: progress(null, false),
      doneRowKeys: ['created', 'deposit'],
    });
    expect(rows(timeline)[2]).toBe(
      'waiting | Confirming on-chain | The transaction is no longer in the mempool'
    );
  });
});

describe('history timeline — a send that is locked until a date', () => {
  const THEIR_KEY = `02${'11'.repeat(32)}`;
  const OUR_KEY = `02${'22'.repeat(32)}`;
  const AT = 1_800_000_000_000;
  const LOCKTIME_SEC = Math.floor(AT / 1000) + 3600;
  const UNLOCK_AT = LOCKTIME_SEC * 1000;

  const lockedSend = (tags: string[][], state = 'pending', updatedAt = AT) =>
    ({
      ...base,
      id: 'send-locked-1',
      type: 'send',
      state,
      amount: 21,
      createdAt: AT,
      updatedAt,
      token: {
        proofs: [
          {
            secret: JSON.stringify(['P2PK', { nonce: 'ab'.repeat(16), data: THEIR_KEY, tags }]),
          },
        ],
      },
    }) as never;

  const refundTags = [
    ['locktime', String(LOCKTIME_SEC)],
    ['refund', OUR_KEY],
  ];
  const at = (currentTime: number, ourPubkeys = [OUR_KEY]) => ({ currentTime, ourPubkeys });

  it('does not promise an unlock for a permanent lock', () => {
    expect(rows(build(lockedSend([]), at(AT)))).toEqual([
      'complete | Created',
      'next-pending | Locked | Only the recipient can redeem it',
    ]);
  });

  it('shows when it unlocks, as a date rather than a countdown', () => {
    // The row rebuilds only at the boundary, so a live "in 3 hours" would be
    // wrong for the three hours after it.
    const timeline = build(lockedSend(refundTags), at(AT));
    expect(rows(timeline)).toEqual(['complete | Created', 'next-pending | Locked | Unlocks']);
    expect(timeline[1].timestamp).toBe(UNLOCK_AT);
  });

  it('says who may take it once the lock has opened', () => {
    const mine = build(lockedSend(refundTags), at(UNLOCK_AT + 60_001));
    expect(rows(mine)).toEqual([
      'complete | Created',
      'complete | Unlocked',
      'next-pending | Reclaimable | You can take this back',
    ]);
    expect(mine[1].timestamp).toBe(UNLOCK_AT);

    // No refund tag: it opens to whoever holds the token, not to us.
    const anyones = build(lockedSend([['locktime', String(LOCKTIME_SEC)]]), at(UNLOCK_AT + 60_001));
    expect(rows(anyones)[2]).toBe(
      'next-pending | Waiting for recipient | Anyone with the token can redeem it'
    );
  });

  it('does not say this wallet can reclaim a refund locked to someone else', () => {
    const timeline = build(lockedSend(refundTags), at(UNLOCK_AT + 60_001, [THEIR_KEY]));
    expect(rows(timeline).join()).not.toContain('You can take this back');
    expect(timeline[1].displayLabel).toBe('Unlocked');
  });

  it.each(['rolledBack', 'rolled_back'])('retains unlocked history after %s', (state) => {
    const timeline = build(lockedSend(refundTags, state, UNLOCK_AT + 60_001), at(UNLOCK_AT + 120_000));
    expect(rows(timeline)).toEqual([
      'complete | Created',
      'complete | Unlocked',
      'rolled-back | Reclaimed | Funds returned to your balance',
    ]);
  });

  it('does not invent an unlock for an early cancellation viewed later', () => {
    const timeline = build(lockedSend(refundTags, 'rolledBack'), at(UNLOCK_AT + 120_000));
    expect(timeline.map((row) => row.displayLabel)).toEqual(['Created', 'Cancelled']);
  });

  it('never draws a checkmark on a moment that did not happen', () => {
    // Claimed BEFORE the locktime, viewed long after it: an "Unlocked" tick
    // here would be for a window that never opened.
    const timeline = build(lockedSend(refundTags, 'finalized', AT + 60_000), at(UNLOCK_AT + 120_000));
    expect(rows(timeline)).toEqual([
      'complete | Created',
      'success | Claimed | The token has been redeemed',
    ]);
  });

  it('leaves an unlocked send on the ordinary send timeline', () => {
    const timeline = build(
      { ...base, id: 'send-plain-1', type: 'send', state: 'pending', amount: 21, token: { proofs: [{ secret: 'a-plain-random-secret' }] } },
      at(AT)
    );
    expect(timeline.map((row) => row.displayLabel)).toEqual(['Created', 'Waiting for recipient']);
  });
});
