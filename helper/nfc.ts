/**
 * @fileoverview NFC Payment – re-exports from modular implementation.
 *
 * Use:
 * - NfcPayment.performPayment() for POS Cashu payments
 * - writeTokenToNFC() for writing tokens to tags (e.g. P2P)
 * - NfcError for typed error handling
 */

export { NfcError, NfcPayment, performNfcPayment, writeTokenToNFC } from './nfc/index';
export type { PaymentOptions, PaymentResult, NfcTokenWriteResult } from './nfc/index';
