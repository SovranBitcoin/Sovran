// ---------------------------------------------------------------------------
// Whether a melt paid
//
// A melt whose `execute` threw has not thereby failed: the mint may have paid
// and the answer been lost. Every caller that would otherwise pay again (the
// rebalance engine re-preparing, the payment machine offering Pay) decides
// from the rule here, so "did not pay" means one thing.
// ---------------------------------------------------------------------------

import { classifyRebalanceError, meltRefusedBeforePaying } from './rebalance/errors';

/**
 * Whether coco settled a melt as unpaid and gave its inputs back (`failed`,
 * `rolled_back`). That proves it did not pay whoever else holds it.
 */
export function meltSettledUnpaid(state: string): boolean {
  return state === 'failed' || state === 'rolled_back';
}

/**
 * Whether coco has not sent a melt yet (`init`, `prepared`). That proves it
 * did not pay only once no call can still send it: the one execute that could
 * has returned. Every other state (`executing`, `pending`, `rolling_back`),
 * and a state that cannot be read, may still pay.
 */
export function meltNeverSent(state: string): boolean {
  return state === 'init' || state === 'prepared';
}

/** For a melt whose own execute has returned: whether its state proves it did not pay. */
export function meltDidNotPay(state: string): boolean {
  return meltSettledUnpaid(state) || meltNeverSent(state);
}

/** What is known about a melt once the one `execute` that could send it has thrown. */
type FailedMeltExecuteOutcome =
  /** Coco finalized it: the payment went through although `execute` threw. */
  | 'paid'
  /** It did not pay and cannot any more: paying again is safe. */
  | 'notPaid'
  /** It may have paid or may still pay: it must not be paid again. */
  | 'unknown';

/**
 * Read a thrown `execute` against the melt's saved state (`null` when it
 * could not be read). The state decides when there is one; without it only a
 * mint refusal that cannot follow a payment proves anything. When the error
 * says another call holds the melt, that call may yet send it, so only a
 * settled state counts.
 */
export function outcomeOfFailedMeltExecute(
  error: unknown,
  state: string | null
): FailedMeltExecuteOutcome {
  if (state === 'finalized') return 'paid';
  if (classifyRebalanceError(error) === 'operation_in_progress') {
    return state !== null && meltSettledUnpaid(state) ? 'notPaid' : 'unknown';
  }
  const notPaid = state === null ? meltRefusedBeforePaying(error) : meltDidNotPay(state);
  return notPaid ? 'notPaid' : 'unknown';
}
