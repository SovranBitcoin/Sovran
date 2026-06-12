// ---------------------------------------------------------------------------
// Mesh transport — inbound payment intake (receiver side)
//
// Composes the receiver pipeline for in-band mesh payments: every inbound
// payment payload is validated against the requests we issued, accepted
// tokens are enqueued for auto-redeem (keyed by the token dedupe hash), and
// the sender always gets a status back — `received` on acceptance (and on
// duplicate deliveries, so a sender that missed the first ack converges) or
// `rejected` with the wire reason.
// ---------------------------------------------------------------------------

import { logger } from '../logger';
import { meshTokenDedupeKey } from './classify';
import type { AcceptedMeshPayment } from './validateInboundPayment';
import { validateInboundMeshPayment } from './validateInboundPayment';
import type { MeshRequestResponder } from './requestResponder';
import type { MeshRedeemEntry, MeshRedeemQueuePort } from './redeemOrchestrator';
import type { MeshTransportAdapter } from './types';

export interface MeshPaymentIntakeQueuePort extends Pick<MeshRedeemQueuePort, 'entries'> {
  /** Idempotent on hash; returns true when newly enqueued. */
  enqueue(
    tokenHash: string,
    entry: Pick<
      MeshRedeemEntry,
      'token' | 'mintUrl' | 'amount' | 'unit' | 'senderPeerID' | 'paymentId'
    >
  ): boolean;
}

export interface MeshPaymentIntakeConfig {
  adapter: MeshTransportAdapter;
  responder: MeshRequestResponder;
  queue: MeshPaymentIntakeQueuePort;
  /** A payment was accepted + enqueued — trigger the redeem drain here. */
  onAccepted?: (tokenHash: string, payment: AcceptedMeshPayment) => void;
}

export interface MeshPaymentIntake {
  /** Subscribe to the adapter and start processing payments. Returns stop(). */
  start(): () => void;
}

export function createMeshPaymentIntake(config: MeshPaymentIntakeConfig): MeshPaymentIntake {
  async function handlePayment(peerId: string, payloadJson: string): Promise<void> {
    const result = validateInboundMeshPayment(payloadJson, config.responder, peerId);

    if (!result.ok) {
      logger.warn('transport.intake.rejected', {
        peerId,
        reason: result.reason,
        paymentId: result.paymentId ?? undefined,
      });
      if (result.paymentId) {
        try {
          await config.adapter.sendPaymentStatus(
            peerId,
            result.paymentId,
            'rejected',
            result.reason
          );
        } catch (err) {
          logger.warn('transport.intake.statusSendFailed', {
            peerId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return;
    }

    const payment = result.payment;
    const tokenHash = meshTokenDedupeKey(payment.token);
    const newlyEnqueued = config.queue.enqueue(tokenHash, {
      token: payment.token,
      mintUrl: payment.mintUrl,
      amount: payment.amount,
      unit: payment.unit,
      senderPeerID: peerId,
      paymentId: payment.paymentId,
    });

    logger.info('transport.intake.accepted', {
      peerId,
      paymentId: payment.paymentId,
      amount: payment.amount,
      duplicate: !newlyEnqueued,
    });

    try {
      await config.adapter.sendPaymentStatus(peerId, payment.paymentId, 'received');
    } catch (err) {
      // The token is already safely queued; the sender's tracker shows
      // `unconfirmed` and converges on the later `redeemed` status.
      logger.warn('transport.intake.statusSendFailed', {
        peerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (newlyEnqueued) {
      config.onAccepted?.(tokenHash, payment);
    }
  }

  return {
    start() {
      return config.adapter.onInbound((event) => {
        if (event.kind !== 'payment') return;
        void handlePayment(event.peerId, event.payloadJson);
      });
    },
  };
}
