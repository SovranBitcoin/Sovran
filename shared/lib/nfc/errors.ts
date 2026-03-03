/**
 * NFC-specific errors with machine-readable codes for UI handling.
 */

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
