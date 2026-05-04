/**
 * @fileoverview Subtitle copy for a split-bill participant row. The
 * Summary and Detail screens diverge on two strings — Detail offers
 * tap-to-retry on failed delivery, Summary doesn't; Summary lets the
 * sender re-share a QR for `qr-only` recipients, Detail just shows the
 * waiting state. Surfacing the diff via `mode` keeps the divergence
 * legible instead of scattering it across two files.
 */

import type { SplitBillParticipant } from '@/shared/stores/profile/splitBillTransactionsStore';

type Mode = 'summary' | 'detail';

export function participantSubtitle(p: SplitBillParticipant, mode: Mode): string {
  if (p.paymentState === 'paid') return 'Paid ✓';
  if (p.paymentState === 'expired') return 'Expired';
  if (p.deliveryState === 'failed') {
    return mode === 'detail' ? 'Delivery failed · tap to retry' : 'Delivery failed';
  }
  if (p.channel === 'qr-only') {
    return mode === 'summary' ? 'Awaiting payment · tap for QR' : 'Awaiting payment · QR only';
  }
  if (p.deliveryState === 'pending') return 'Sending invoice…';
  return 'Invoice delivered · awaiting payment';
}
