// ---------------------------------------------------------------------------
// Payment-request lifecycle signal (in-package, module-level)
// ---------------------------------------------------------------------------
//
// coco emits NO event when an incoming payment request is created
// (`paymentRequests.incoming.create`) — unlike mint quotes, which project into
// history and fire `history:updated`. So a freshly created single-use "as Ecash"
// request would never refresh the transactions list until an unrelated event or
// an app restart.
//
// This is the minimal seam to close that gap: `createPaymentRequestReceive`
// (the one chokepoint per single-use request) fires `emitPaymentRequestCreated`,
// and `useColadaTransactions` re-runs its pending-request supplement on it.
// Scoped to the single-use ecash lane only, so reusable/standing rails (which
// deliberately stay OUT of the transaction list) don't churn it.
//
// Not manager-scoped: a create during a profile switch triggers at worst one
// redundant supplement re-read (which reads current state via the live manager
// ref), never a wrong-profile read.
//
// Why a module-global and NOT `ColadaSubscriptionBus`: the bus is created inside
// the React `ColadaProvider` (`react/ColadaProvider.tsx`), which mounts AFTER
// `createColada` has already built the operations in the app's Colada provider —
// so the bus does not exist at operation-construction time and cannot be threaded
// in the way an app-supplied callback like `sendNostrDM` can. The publisher here
// is a plain coco operation (no React context), and the sole consumer
// (`useColadaTransactions`) is inside the provider. A package-scoped signal is the
// simplest correct bridge across that boundary; the bus would need to be hoisted
// out of the provider first, which is a larger architectural change.

const listeners = new Set<() => void>();

/** Subscribe to "an incoming payment request was created". Returns unsubscribe. */
export function onPaymentRequestCreated(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Fire the signal. Called right after a successful `incoming.create`. */
export function emitPaymentRequestCreated(): void {
  for (const listener of listeners) listener();
}
