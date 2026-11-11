import { storeLog } from '@/shared/lib/logger';
import { clearNutzapProfileCache } from '@/shared/lib/nostr/nutzapProfileDiscovery';
import { useAmountDraftStore } from './amountDraftStore';
import { useContactSendStore } from './contactSendStore';
import { useNearPaySessionStore } from './nearPayStore';
import { clearPendingZaps } from './pendingZapStore';
import { useSendLockStore } from './sendLockStore';

/**
 * Clear all in-progress payment "context" — the runtime stores that steer where
 * an ecash Send is routed.
 *
 * MUST be called at the ROOT of every payment/scan entry point (wallet Send,
 * Receive, Scan-QR, NFC, Nut-Drop, and the wallet mint selector). Mid-flow
 * state is fine; the danger is context surviving ACROSS flows: a contact left
 * from an abandoned contact send would have a later ordinary Send's token
 * messaged to that contact, and a leftover Nut Drop session would steer the
 * next amount entry to the mesh. Clearing at every root closes those and
 * every symmetric path.
 *
 * NOTE: Colada's own send/receive *draft* (amount, mint, recipient) is reset
 * separately by the `{ reset: true }` option on `startSendEcash`/`startReceive`.
 * This helper only clears the Sovran-side routing context layered on top.
 */
export function clearPaymentContext(reason: string): void {
  const nearPayActive = useNearPaySessionStore.getState().active != null;
  const contactSendActive = useContactSendStore.getState().active != null;
  if (nearPayActive || contactSendActive) {
    storeLog.info('payment.context.clear', {
      reason,
      nearPayActive,
      contactSendActive,
    });
  }
  useNearPaySessionStore.getState().clear();
  useContactSendStore.getState().clear();
  // A fresh flow must never restore an amount stashed during a previous,
  // abandoned mint-selector round trip.
  useAmountDraftStore.getState().clear();
  // A lock is a decision about one payment. Left behind, it would lock the
  // next send to the same person on terms nobody chose for it.
  useSendLockStore.getState().clear();
  // An abandoned zap must never attach its 9734 to a later unrelated payment
  // that happens to target the same lightning address.
  clearPendingZaps();
  // Where someone wants ecash locked is payment routing, not profile
  // metadata: carrying one account's lookups into another's flow would leak
  // payment intent across identities.
  clearNutzapProfileCache();
}
