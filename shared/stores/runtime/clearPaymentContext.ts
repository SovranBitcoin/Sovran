import { storeLog } from '@/shared/lib/logger';
import { useAmountDraftStore } from './amountDraftStore';
import { useNearPaySessionStore } from './nearPayStore';
import { useRoutstrTopUpStore } from './routstrTopUpStore';

/**
 * Clear all in-progress payment "context" — the runtime stores that steer where
 * an ecash Send is routed.
 *
 * MUST be called at the ROOT of every payment/scan entry point (wallet Send,
 * Receive, Scan-QR, NFC, Nut-Drop, and the wallet mint selector). Mid-flow
 * state is fine; the danger is context surviving ACROSS flows. The canonical
 * example: tapping "Top up" on the AI tab sets `routstrTopUpStore.active = true`
 * so the next ecash send is intercepted and routed to Routstr — if the user
 * abandons that flow, a later ordinary Send would silently pay Routstr instead
 * of the intended recipient. Clearing at every root closes that and every
 * symmetric path (NearPay leftover, etc.).
 *
 * NOTE: Colada's own send/receive *draft* (amount, mint, recipient) is reset
 * separately by the `{ reset: true }` option on `startSendEcash`/`startReceive`.
 * This helper only clears the Sovran-side routing context layered on top.
 */
export function clearPaymentContext(reason: string): void {
  const routstrActive = useRoutstrTopUpStore.getState().active;
  const nearPayActive = useNearPaySessionStore.getState().active != null;
  if (routstrActive || nearPayActive) {
    storeLog.info('payment.context.clear', { reason, routstrActive, nearPayActive });
  }
  useRoutstrTopUpStore.getState().reset();
  useNearPaySessionStore.getState().clear();
  // A fresh flow must never restore an amount stashed during a previous,
  // abandoned mint-selector round trip.
  useAmountDraftStore.getState().clear();
}
