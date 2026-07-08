import type { Result } from "neverthrow";

export type PaymentCopyVariables = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface PaymentCopyOptions {
  locale?: string;
  overrides?: Partial<PaymentCopyCatalog>;
}

export type PaymentCopyError =
  | { type: "missing-key"; key: string }
  | { type: "missing-variable"; key: string; variable: string };

export type PaymentCopyResult = Result<string, PaymentCopyError>;

export interface PaymentCopyResolver {
  text: (key: PaymentCopyKey, variables?: PaymentCopyVariables) => string;
  resolve: (
    key: PaymentCopyKey,
    variables?: PaymentCopyVariables,
  ) => PaymentCopyResult;
}

export type PaymentCopyKey =
  | "timeline.mint.unpaid.label"
  | "timeline.mint.unpaid.info"
  | "timeline.mint.unpaid.onchainInfo"
  | "timeline.mint.paid.label"
  | "timeline.mint.paid.info"
  | "timeline.mint.issued.label"
  | "timeline.mint.issued.info"
  | "timeline.mint.expired.label"
  | "timeline.mint.expired.info"
  | "timeline.mint.failed.label"
  | "timeline.mint.failed.info"
  | "timeline.melt.unpaid.label"
  | "timeline.melt.unpaid.info"
  | "timeline.melt.pending.label"
  | "timeline.melt.pending.info"
  | "timeline.melt.paid.label"
  | "timeline.melt.paid.info"
  | "timeline.melt.expired.label"
  | "timeline.melt.expired.info"
  | "timeline.send.prepared.label"
  | "timeline.send.prepared.info"
  | "timeline.send.pending.label"
  | "timeline.send.pending.info"
  | "timeline.send.finalized.label"
  | "timeline.send.finalized.info"
  | "timeline.send.rolledBack.label"
  | "timeline.send.rolledBack.info"
  | "timeline.paymentRequest.prepared.label"
  | "timeline.paymentRequest.prepared.info"
  | "timeline.paymentRequest.nostrSent.label"
  | "timeline.paymentRequest.nostrSent.infoSending"
  | "timeline.paymentRequest.nostrSent.infoSent"
  | "timeline.paymentRequest.finalized.label"
  | "timeline.paymentRequest.finalized.info"
  | "timeline.paymentRequest.rolledBack.label"
  | "timeline.paymentRequest.rolledBack.info"
  | "timeline.receive.pending.label"
  | "timeline.receive.pending.info"
  | "timeline.receive.accepted.label"
  | "timeline.receive.waiting.label"
  | "timeline.receive.waiting.info"
  | "timeline.receive.redeemed.label"
  | "timeline.receive.redeemed.info"
  | "timeline.receive.alreadySpent.label"
  | "timeline.receive.alreadySpent.info"
  | "timeline.receiveRequest.requested.label"
  | "timeline.receiveRequest.requested.info"
  | "timeline.receiveRequest.paid.label"
  | "timeline.receiveRequest.paid.info"
  | "timeline.status.failed"
  | "timeline.status.complete"
  | "timeline.status.inProgress"
  | "timeline.status.waiting"
  | "timeline.status.awaitingPayment"
  | "timeline.status.ready"
  | "timeline.status.cancelled"
  | "timeline.status.alreadySpent"
  | "timeline.status.pending"
  | "timeline.onchain.waitingFirstConfirmation"
  | "timeline.onchain.paymentConfirmed"
  | "timeline.onchain.confirmations"
  | "timeline.onchain.confirmingLabel"
  | "timeline.onchain.confirmedLabel"
  | "timeline.onchain.waitingForMint"
  | "timeline.flow.receive"
  | "timeline.flow.send"
  | "timeline.flow.payment"
  | "timeline.flow.transaction"
  | "send.warning.mintOffline.title"
  | "send.warning.mintOffline.description"
  | "send.warning.deviceOffline.title"
  | "send.warning.deviceOffline.description"
  | "send.warning.mintUnreachable.title"
  | "send.warning.mintUnreachable.description"
  | "history.refresh.sentWith"
  | "history.refresh.sendingWith"
  | "history.refresh.receivedWith"
  | "history.refresh.receivingWith"
  | "history.refresh.processingWith"
  | "history.refresh.mintAlt"
  | "toast.receive.message"
  | "toast.receive.processing"
  | "toast.receive.confirmed"
  | "toast.receive.failed"
  | "toast.send.message"
  | "toast.send.processing"
  | "toast.send.confirmed"
  | "toast.send.failed"
  | "toast.paymentRequest.message"
  | "toast.paymentRequest.processing"
  | "toast.paymentRequest.delivered"
  | "toast.paymentRequest.confirmed"
  | "toast.paymentRequest.failed"
  | "toast.melt.message"
  | "toast.melt.processing"
  | "toast.melt.confirmed"
  | "toast.melt.failed"
  | "toast.receiveEcash.message"
  | "toast.receiveEcash.processing"
  | "toast.receiveEcash.confirmed"
  | "toast.receiveEcash.failed"
  | "send.destination.redeemAmount"
  | "send.destination.redeem"
  | "send.destination.payAmount"
  | "send.destination.pay"
  | "send.destination.payRequest"
  | "send.destination.payInvoice"
  | "send.destination.sendAmount"
  | "send.destination.sendOnchain"
  | "send.destination.openMint"
  | "send.destination.unsupported";

export type PaymentCopyCatalog = Record<PaymentCopyKey, string>;
