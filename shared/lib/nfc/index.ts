/**
 * NFC module: adapter for colada POS flows and standalone token write.
 *
 * - createNfcAdapter(): NfcIOAdapter for colada machine
 * - writeTokenToNFC(): write token to tag (e.g. P2P sharing); throws NfcError
 * - NfcError: typed errors with .code for UI handling
 */

export { NfcError, isUserCancelError } from './errors';
export { createNfcAdapter } from './adapter';
export { writeTokenToNFC } from './write-token';
export { useNfcSupported } from './useNfcSupported';
export { isNfcEnabled, isNfcSupported } from './status';
export { releaseSession, setNfcTagConnectedListener } from './session';
export { isAmbientNfcCycle, setAmbientNfcCycle } from './ambient';
