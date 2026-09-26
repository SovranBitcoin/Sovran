/**
 * @fileoverview What a grouped AI request's amount says, in a row or a header.
 *
 * A pay-per-request call is a send plus the change that comes back, so the
 * group carries several numbers and the screens have to pick one. The rule is
 * not "always the net": both terminal states where the money ended up back in
 * the wallet net out to zero, and `0` is the one thing neither surface may say.
 * Zero claims nothing happened. Something did — and the dimming and the cancel
 * glyph beside the amount are already what say it came home.
 *
 * So a returned request shows the size of the movement that was made, coloured
 * and signed like the send it was, and only a request that actually bought
 * something shows its real cost.
 *
 * Lives here, as a function of the group alone, because the row (`Transactions`)
 * and the detail header (`AiRequestScreen`) must never disagree about it.
 */

import type { HistoryEntry } from '@cashu/coco-core';
import type { AiRequestGroup } from 'wallet';

import { amountToNumber } from '@/shared/lib/cashu/amount';

/** True when the money moved and then came back — or never went at all. */
export function isAiRequestReturned(group: Pick<AiRequestGroup, 'state'>): boolean {
  return group.state === 'refunded' || group.state === 'cancelled';
}

/**
 * What the request would have cost, read off the payment leg itself.
 *
 * `buildGroup` sorts the payment leg first — it is the leg that explains the
 * group — which is the same leg `Transactions` renders the row from.
 */
function attemptedAmount(legs: readonly HistoryEntry[]): number {
  const paymentLeg = legs[0];
  return paymentLeg ? Math.abs(amountToNumber(paymentLeg.amount ?? 0)) : 0;
}

/**
 * The figure to show for a request: what it cost, or — when it was returned —
 * the size of the send that was made.
 *
 * `refunded` and `cancelled` differ in where that figure comes from, not in
 * how it reads. A refund settled, so `paidAmount` is the real thing that left
 * the wallet. A cancellation settled NOTHING, so `paidAmount` is 0 by
 * construction — and that is correct, the ledger must keep saying no sats
 * moved. Only the display falls back to the leg's face amount, so the row can
 * answer "how much was this request for?" instead of "0".
 */
export function aiRequestDisplayAmount(
  group: Pick<AiRequestGroup, 'state' | 'paidAmount' | 'netAmount' | 'legs'>
): number {
  if (!isAiRequestReturned(group)) return group.netAmount;
  return group.paidAmount > 0 ? group.paidAmount : attemptedAmount(group.legs);
}

/**
 * The `-` the detail header puts in front of a returned request's amount, or
 * `null` when there is no movement to sign.
 *
 * Same shape as `HistoryEntryHeader`'s sign, so a returned AI request reads
 * like any other send. Derived here rather than in the screen so it can never
 * contradict the figure beside it: the sign is on exactly when the amount is a
 * movement that was made.
 */
export function aiRequestAmountSign(
  group: Pick<AiRequestGroup, 'state' | 'paidAmount' | 'netAmount' | 'legs'>
): '-' | null {
  return isAiRequestReturned(group) && aiRequestDisplayAmount(group) > 0 ? '-' : null;
}
