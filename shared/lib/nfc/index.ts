/**
 * NFC module: adapter for coco-payment-ux POS flows and standalone token write.
 *
 * - createNfcAdapter(): NfcIOAdapter for coco-payment-ux machine
 * - writeTokenToNFC(): write token to tag (e.g. P2P sharing); throws NfcError
 * - NfcError: typed errors with .code for UI handling
 */

export { NfcError } from './errors';
export { createNfcAdapter } from './adapter';
export { writeTokenToNFC } from './write-token';
