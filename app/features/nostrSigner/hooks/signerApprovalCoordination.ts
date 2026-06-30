/**
 * @fileoverview Sheet ↔ controller handoff for the signer approval flow
 *
 * Module-scope, runtime-only signal. The approval sheet closes itself for
 * reasons that are NOT a user dismissal (e.g. "View All" navigates to the
 * requests page); the controller must still park the batch (no auto-reopen)
 * but must not show the "Requests waiting" toast. A one-shot flag keeps the
 * two parties decoupled from each other's React trees.
 */

let suppressNextDeferToast = false;

/** Sheet-side: the next signer-approval close is intentional, don't toast. */
export function suppressSignerDeferToastOnce(): void {
  suppressNextDeferToast = true;
}

/** Controller-side: read-and-clear on each signer-approval close. */
export function consumeSignerDeferToastSuppression(): boolean {
  const suppressed = suppressNextDeferToast;
  suppressNextDeferToast = false;
  return suppressed;
}
