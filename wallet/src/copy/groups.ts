import { createPaymentCopyResolver, getPaymentCopy } from "./resolve";
import { logger } from "../logger";
import type {
  PaymentCopyKey,
  PaymentCopyResolver,
  PaymentCopyVariables,
} from "./types";

type PaymentCopyText = (
  key: PaymentCopyKey,
  variables?: PaymentCopyVariables,
) => string;

function buildPaymentCopyGroups(text: PaymentCopyText) {
  logger.debug("copy.groups.build", {
    groups: ["mint", "melt", "send", "payment-request", "receive", "toast"],
  });
  return {
    MINT_COPY: {
      UNPAID: {
        label: text("timeline.mint.unpaid.label"),
        info: text("timeline.mint.unpaid.info"),
        onchainInfo: text("timeline.mint.unpaid.onchainInfo"),
      },
      PAID: {
        label: text("timeline.mint.paid.label"),
        info: text("timeline.mint.paid.info"),
      },
      ISSUED: {
        label: text("timeline.mint.issued.label"),
        info: (amount: number) => text("timeline.mint.issued.info", { amount }),
      },
      expired: {
        label: text("timeline.mint.expired.label"),
        info: text("timeline.mint.expired.info"),
      },
      failed: {
        label: text("timeline.mint.failed.label"),
        info: text("timeline.mint.failed.info"),
      },
    },

    MELT_COPY: {
      UNPAID: {
        label: text("timeline.melt.unpaid.label"),
        info: text("timeline.melt.unpaid.info"),
      },
      PENDING: {
        label: text("timeline.melt.pending.label"),
        info: text("timeline.melt.pending.info"),
      },
      PAID: {
        label: text("timeline.melt.paid.label"),
        info: text("timeline.melt.paid.info"),
      },
      expired: {
        label: text("timeline.melt.expired.label"),
        info: text("timeline.melt.expired.info"),
      },
      rolledBack: {
        label: text("timeline.melt.rolledBack.label"),
        info: text("timeline.melt.rolledBack.info"),
      },
      // Onchain SEND (NUT-30): "Sending" (submitting to the mint, completes
      // as "Sent" once the mint accepts) → the bitcoin network phase
      // ("Broadcasting…" → "In mempool · N/6 blocks", segmented ring) →
      // "Confirmed". If the mint settles off-chain (no outpoint) the network
      // phase collapses to "Settled off-chain".
      onchain: {
        sending: {
          label: text("timeline.melt.onchain.sending.label"),
          info: text("timeline.melt.onchain.sending.info"),
        },
        sent: { label: text("timeline.melt.onchain.sent.label") },
        broadcasting: {
          label: text("timeline.melt.onchain.broadcasting.label"),
          info: text("timeline.melt.onchain.broadcasting.info"),
        },
        mempool: { label: text("timeline.melt.onchain.mempool.label") },
        confirmed: { label: text("timeline.melt.onchain.confirmed.label") },
        offchain: {
          label: text("timeline.melt.onchain.offchain.label"),
          info: text("timeline.melt.onchain.offchain.info"),
        },
      },
    },

    SEND_COPY: {
      prepared: {
        label: text("timeline.send.prepared.label"),
        info: text("timeline.send.prepared.info"),
      },
      pending: {
        label: text("timeline.send.pending.label"),
        info: text("timeline.send.pending.info"),
      },
      finalized: {
        label: text("timeline.send.finalized.label"),
        info: text("timeline.send.finalized.info"),
      },
      rolledBack: {
        label: text("timeline.send.rolledBack.label"),
        info: text("timeline.send.rolledBack.info"),
      },
    },

    PAYMENT_REQUEST_COPY: {
      prepared: {
        label: text("timeline.paymentRequest.prepared.label"),
        info: text("timeline.paymentRequest.prepared.info"),
      },
      nostrSent: {
        label: text("timeline.paymentRequest.nostrSent.label"),
        infoSending: text("timeline.paymentRequest.nostrSent.infoSending"),
        infoSent: text("timeline.paymentRequest.nostrSent.infoSent"),
      },
      finalized: {
        label: text("timeline.paymentRequest.finalized.label"),
        info: text("timeline.paymentRequest.finalized.info"),
      },
      rolledBack: {
        label: text("timeline.paymentRequest.rolledBack.label"),
        info: text("timeline.paymentRequest.rolledBack.info"),
      },
    },

    RECEIVE_COPY: {
      pending: {
        label: text("timeline.receive.pending.label"),
        info: text("timeline.receive.pending.info"),
      },
      accepted: {
        label: text("timeline.receive.accepted.label"),
      },
      waiting: {
        label: text("timeline.receive.waiting.label"),
        info: text("timeline.receive.waiting.info"),
      },
      redeemed: {
        label: text("timeline.receive.redeemed.label"),
        info: (amount: number) =>
          text("timeline.receive.redeemed.info", { amount }),
      },
      alreadySpent: {
        label: text("timeline.receive.alreadySpent.label"),
        info: text("timeline.receive.alreadySpent.info"),
      },
      paymentRequest: {
        requested: {
          label: text("timeline.receiveRequest.requested.label"),
          info: text("timeline.receiveRequest.requested.info"),
        },
        paid: {
          label: text("timeline.receiveRequest.paid.label"),
          info: text("timeline.receiveRequest.paid.info"),
        },
      },
    },

    TOAST_COPY: {
      receive: {
        message: text("toast.receive.message"),
        processing: text("toast.receive.processing"),
        confirmed: text("toast.receive.confirmed"),
        failed: text("toast.receive.failed"),
      },
      send: {
        message: text("toast.send.message"),
        processing: text("toast.send.processing"),
        confirmed: text("toast.send.confirmed"),
        failed: text("toast.send.failed"),
      },
      "payment-request": {
        message: text("toast.paymentRequest.message"),
        processing: text("toast.paymentRequest.processing"),
        delivered: text("toast.paymentRequest.delivered"),
        confirmed: text("toast.paymentRequest.confirmed"),
        failed: text("toast.paymentRequest.failed"),
      },
      melt: {
        message: text("toast.melt.message"),
        processing: text("toast.melt.processing"),
        confirmed: text("toast.melt.confirmed"),
        failed: text("toast.melt.failed"),
      },
      "receive-ecash": {
        message: text("toast.receiveEcash.message"),
        processing: text("toast.receiveEcash.processing"),
        confirmed: text("toast.receiveEcash.confirmed"),
        failed: text("toast.receiveEcash.failed"),
      },
    },
  } as const;
}

export function createPaymentCopyGroups(
  resolver: PaymentCopyResolver = createPaymentCopyResolver(),
) {
  logger.debug("copy.groups.createResolverGroups");
  return buildPaymentCopyGroups(resolver.text);
}

const defaultGroups = buildPaymentCopyGroups(getPaymentCopy);

export const MINT_COPY = defaultGroups.MINT_COPY;
export const MELT_COPY = defaultGroups.MELT_COPY;
export const SEND_COPY = defaultGroups.SEND_COPY;
export const PAYMENT_REQUEST_COPY = defaultGroups.PAYMENT_REQUEST_COPY;
export const RECEIVE_COPY = defaultGroups.RECEIVE_COPY;
export const TOAST_COPY = defaultGroups.TOAST_COPY;
