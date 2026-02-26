/**
 * NFC module: Cashu POS payments and token write.
 *
 * - NfcPayment.performPayment(): full POS flow (read request → create token → write back)
 * - writeTokenToNFC(): write token to tag (e.g. P2P sharing)
 * - NfcError: typed errors with .code for UI handling
 */

export { NfcError } from './errors';
export { NfcPayment, performNfcPayment } from './payment';
export type { PaymentOptions, PaymentResult } from './payment';
export { writeTokenToNFC } from './write-token';
export type { NfcTokenWriteResult } from './write-token';
