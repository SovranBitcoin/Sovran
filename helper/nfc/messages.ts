/**
 * User-facing messages for NFC error codes.
 * Single source of truth for UI (alerts, toasts).
 */

export interface NfcErrorEntry {
  title: string;
  message: string | ((ctx: { maxAmountSats?: number; errorMessage: string }) => string);
}

/** Map NfcError.code to user-facing title and message. */
export const NFC_ERROR_MESSAGES: Record<string, NfcErrorEntry> = {
  AMOUNT_EXCEEDED: {
    title: 'Payment Rejected',
    message: (ctx) =>
      `The merchant requested more than your limit of ${(ctx.maxAmountSats ?? 0).toLocaleString()} sats.`,
  },
  NOT_SUPPORTED: {
    title: 'NFC Not Supported',
    message: 'Your device does not support NFC.',
  },
  NOT_ENABLED: {
    title: 'NFC Disabled',
    message: 'Please enable NFC in your device settings and try again.',
  },
  EMPTY_PAYMENT_REQUEST: {
    title: 'POS Not Ready',
    message: 'The terminal returned an empty payment request. Please try again.',
  },
  TAG_LOST: {
    title: 'Connection Lost',
    message: 'Lost connection to the terminal. Please hold your device steady and try again.',
  },
  TRANSCEIVE_FAILED: {
    title: 'Connection Lost',
    message: 'Lost connection to the terminal. Please hold your device steady and try again.',
  },
  TECHNOLOGY_REQUEST_FAILED: {
    title: 'Connection Failed',
    message: 'Could not connect to the terminal. Make sure NFC is enabled and try again.',
  },
  NO_AVAILABLE_MINTS: {
    title: 'No Mints Available',
    message: 'You need to add a mint to your wallet before making NFC payments.',
  },
  NO_COMPATIBLE_MINT: {
    title: 'Incompatible Terminal',
    message:
      "This terminal requires a mint you don't have. Add one of the supported mints to your wallet.",
  },
  INSUFFICIENT_BALANCE: {
    title: 'Insufficient Balance',
    message: (ctx) => ctx.errorMessage,
  },
  INSUFFICIENT_BALANCE_AT_COMPATIBLE_MINT: {
    title: 'Insufficient Balance',
    message: (ctx) => ctx.errorMessage,
  },
};

const DEFAULT: NfcErrorEntry = {
  title: 'Payment Failed',
  message: (ctx) => ctx.errorMessage,
};

export interface NfcErrorMessage {
  title: string;
  message: string;
}

/**
 * Resolve user-facing title and message for an NfcError.
 */
export function getNfcErrorMessage(
  code: string,
  errorMessage: string,
  context?: { maxAmountSats?: number }
): NfcErrorMessage {
  const entry = NFC_ERROR_MESSAGES[code] ?? DEFAULT;
  const message =
    typeof entry.message === 'function'
      ? entry.message({ maxAmountSats: context?.maxAmountSats, errorMessage })
      : entry.message;
  return { title: entry.title, message };
}
