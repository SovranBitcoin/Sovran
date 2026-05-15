/**
 * NFC-specific errors with machine-readable codes for UI handling.
 */

import { NfcError as NfcManagerError } from 'react-native-nfc-manager';

export class NfcError extends Error {
  code: string;
  statusWord?: string;

  constructor(message: string, code: string, statusWord?: string) {
    super(message);
    this.name = 'NfcError';
    this.code = code;
    this.statusWord = statusWord;
  }
}

/**
 * The user tapped Cancel on the iOS NFC system sheet (or the Android
 * equivalent). Not a failure — callers should treat it as a no-op and
 * skip the error popup.
 *
 * `react-native-nfc-manager` raises `NfcError.UserCancel` from
 * `requestTechnology` on iOS sheet cancel, and a raw `'cancelled'`
 * Error on the Android path.
 */
export function isUserCancelError(e: unknown): boolean {
  if (e instanceof NfcManagerError.UserCancel) return true;
  if (e instanceof Error && e.message === 'cancelled') return true;
  return false;
}
