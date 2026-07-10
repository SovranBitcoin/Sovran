import { useCallback, useEffect, useRef, useState } from 'react';

import {
  accelerationTotalSats,
  annotationKey,
  createAccelerationInvoice,
  defaultAccelerationBidSats,
  fetchAccelerationEstimate,
  fetchAccelerationStatus,
  fetchAverageBlockTimeMinutes,
  isAcknowledgedAccelerationStatus,
  type AccelerationEstimate,
} from 'wallet';

import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { paymentLog } from '@/shared/lib/logger';

// After the user starts paying the acceleration invoice, watch the public
// per-txid status until mempool.space acknowledges it (the payment is a
// normal lightning melt we don't get a callback from).
const ACCEL_STATUS_POLL_MS = 15_000;
const ACCEL_STATUS_POLL_MAX_MS = 5 * 60_000;

interface MempoolAccelerationOffer {
  /** The bid the official UI preselects (middle recommended option). */
  bidSats: number;
  /** What the user pays: bid + service base fee + size surcharge. */
  totalSats: number;
  /** ≈ new confirmation time (next block) in minutes. */
  etaMinutes: number;
}

/**
 * Guest mempool.space Accelerator flow for an unconfirmed onchain-send tx:
 * fetch the offer (cost + ETA), create the Lightning invoice on demand, and
 * watch the public acceleration status — persisting an `accelerated`
 * annotation the moment mempool.space acknowledges the txid so the mark
 * survives like any other transaction fact.
 */
export function useMempoolAcceleration(params: {
  txid: string | null;
  quoteId: string | null | undefined;
  /** Already marked accelerated (annotation) — skips the estimate fetch. */
  alreadyAccelerated: boolean;
  enabled: boolean;
}): {
  offer: MempoolAccelerationOffer | null;
  /** mempool.space acknowledged the acceleration (live status or annotation). */
  accelerating: boolean;
  /** Create the invoice for the offer's bid. Returns the BOLT11 or null. */
  requestInvoice: () => Promise<string | null>;
} {
  const { txid, quoteId, alreadyAccelerated, enabled } = params;
  const [offerState, setOfferState] = useState<{
    txid: string;
    offer: MempoolAccelerationOffer;
  } | null>(null);
  const [acceleratingTxid, setAcceleratingTxid] = useState<string | null>(
    alreadyAccelerated ? txid : null
  );
  const estimateRef = useRef<{ txid: string; estimate: AccelerationEstimate } | null>(null);
  const invoiceRequestRef = useRef<{ txid: string; promise: Promise<string | null> } | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStatusPoll = useCallback(() => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  }, []);

  const markAccelerated = useCallback(
    (source: 'mount_check' | 'post_invoice_poll', acknowledgedTxid: string) => {
      setAcceleratingTxid(acknowledgedTxid);
      if (quoteId) {
        setTransactionAnnotation(annotationKey({ type: 'melt', quoteId }), {
          onchainMelt: { accelerated: true },
        });
      }
      paymentLog.info('onchain.melt.accelerate.acknowledged', { source, hasQuoteId: !!quoteId });
    },
    [quoteId]
  );

  // Offer fetch + one status check on mount.
  useEffect(() => {
    setOfferState(null);
    estimateRef.current = null;
    invoiceRequestRef.current = null;
    setAcceleratingTxid(alreadyAccelerated ? txid : null);
    stopStatusPoll();
    if (!enabled || !txid || alreadyAccelerated) {
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const [estimate, status, etaMinutes] = await Promise.all([
          fetchAccelerationEstimate(txid),
          fetchAccelerationStatus(txid),
          fetchAverageBlockTimeMinutes(),
        ]);
        if (!mounted) return;
        if (isAcknowledgedAccelerationStatus(status)) {
          markAccelerated('mount_check', txid);
          return;
        }
        if (!estimate) {
          paymentLog.debug('onchain.melt.accelerate.ineligible', { txidLength: txid.length });
          setOfferState(null);
          return;
        }
        estimateRef.current = { txid, estimate };
        const bidSats = defaultAccelerationBidSats(estimate);
        const totalSats = accelerationTotalSats(estimate, bidSats);
        setOfferState({ txid, offer: { bidSats, totalSats, etaMinutes } });
        paymentLog.info('onchain.melt.accelerate.offer', { bidSats, totalSats, etaMinutes });
      } catch (err) {
        paymentLog.warn('onchain.melt.accelerate.estimate_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (mounted) setOfferState(null);
      }
    })();
    return () => {
      mounted = false;
      stopStatusPoll();
    };
  }, [enabled, txid, alreadyAccelerated, markAccelerated, stopStatusPoll]);

  const requestInvoice = useCallback(async (): Promise<string | null> => {
    const keyedEstimate = estimateRef.current;
    if (!txid || keyedEstimate?.txid !== txid) return null;
    if (invoiceRequestRef.current?.txid === txid) {
      return invoiceRequestRef.current.promise;
    }

    const promise = (async (): Promise<string | null> => {
      try {
        const invoice = await createAccelerationInvoice(
          txid,
          defaultAccelerationBidSats(keyedEstimate.estimate)
        );
        if (!invoice) return null;
        paymentLog.info('onchain.melt.accelerate.invoice_created', {
          bolt11Length: invoice.bolt11.length,
          expiresAtSec: invoice.expiresAtSec,
        });

        // The payment happens in the normal lightning send flow; acknowledge by
        // polling the public status for a few minutes.
        stopStatusPoll();
        const startedAt = Date.now();
        statusPollRef.current = setInterval(() => {
          void (async () => {
            if (Date.now() - startedAt > ACCEL_STATUS_POLL_MAX_MS) {
              stopStatusPoll();
              return;
            }
            try {
              const status = await fetchAccelerationStatus(txid);
              if (isAcknowledgedAccelerationStatus(status)) {
                stopStatusPoll();
                markAccelerated('post_invoice_poll', txid);
              }
            } catch {
              // transient — keep polling until the deadline
            }
          })();
        }, ACCEL_STATUS_POLL_MS);

        return invoice.bolt11;
      } catch (err) {
        paymentLog.warn('onchain.melt.accelerate.invoice_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    })();

    invoiceRequestRef.current = { txid, promise };
    void promise.finally(() => {
      if (invoiceRequestRef.current?.promise === promise) {
        invoiceRequestRef.current = null;
      }
    });
    return promise;
  }, [txid, markAccelerated, stopStatusPoll]);

  const accelerating =
    enabled && !!txid && (alreadyAccelerated || acceleratingTxid === txid);
  const offer = enabled && offerState?.txid === txid ? offerState.offer : null;

  return {
    offer: accelerating ? null : offer,
    accelerating,
    requestInvoice,
  };
}
