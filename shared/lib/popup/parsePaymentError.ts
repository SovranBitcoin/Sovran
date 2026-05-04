/**
 * Canonical mapping of coco/cashu error strings to user-friendly text. Used by
 * PaymentStatusToast / SwapStatusToast to render the failure subtitle.
 *
 * Patterns are checked in order, first match wins. Substring patterns
 * lowercase the input before comparing; regex patterns match against the
 * trimmed-but-cased original.
 */
const MESSAGE_MAP: { pattern: string | RegExp; text: string }[] = [
  {
    pattern: 'outputs have already been signed before',
    text: 'Trying again should fix this. If not contact support.',
  },
  { pattern: 'keyset id inactive', text: 'You need to update your wallet' },
  { pattern: 'bad response', text: 'Mint problem. Try a different mint.' },
  { pattern: 'rate limit exceeded', text: 'Too many requests. Try again later.' },
  {
    pattern: 'token already spent',
    text: 'This token has already been spent. Each token can only be redeemed once',
  },
  {
    pattern: 'proof already spent',
    text: 'This token has already been spent. Each token can only be redeemed once',
  },
  {
    pattern: 'already spent',
    text: 'This token has already been spent. Each token can only be redeemed once',
  },
  {
    pattern: 'insufficient funds',
    text: 'You do not have enough funds to complete this transaction.',
  },
  {
    pattern: 'witness is missing for p2pk',
    text: "This happens when you try to spend ecash locked to someone else's pubkey",
  },
  { pattern: 'mint quote already issued', text: 'This invoice has already been paid.' },
  { pattern: 'invoice already paid', text: 'This invoice has already been paid.' },
  { pattern: 'quote already issued', text: 'This invoice has already been paid.' },
  {
    pattern: 'lightning payment failed',
    text: "Your mint isn't well connected to the recipient's lightning network.",
  },
  {
    pattern: 'no_route',
    text: "Your mint isn't well connected to the recipient's lightning network.",
  },
  { pattern: /mint .* is not trusted/i, text: 'Mint is not trusted. Add it in settings first.' },
  { pattern: 'not trusted', text: 'Mint is not trusted. Add it in settings first.' },
  {
    pattern: 'operation already in progress',
    text: 'Another operation is in progress. Please wait.',
  },
  {
    pattern: 'operation not found',
    text: 'Operation not found. It may have been cancelled.',
  },
  {
    pattern: 'invalid token',
    text: 'Invalid token. The token may be corrupted or from an unsupported mint.',
  },
  {
    pattern: 'network request failed',
    text: 'Network error. Check your connection and try again.',
  },
  {
    pattern: 'connection failed',
    text: 'Network error. Check your connection and try again.',
  },
  { pattern: 'quote expired', text: 'Payment quote expired. Please create a new one.' },
];

const MAX_RAW_LENGTH = 80;

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const msg =
      (error as { message?: string; error?: string }).message ??
      (error as { error?: string }).error;
    if (typeof msg === 'string') return msg;
  }
  return String(error);
}

function resolveText(rawMessage: string): string {
  const trimmed = rawMessage.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return 'Payment failed';

  for (const { pattern, text } of MESSAGE_MAP) {
    if (typeof pattern === 'string') {
      if (lower.includes(pattern.toLowerCase())) return text;
    } else {
      if (pattern.test(trimmed)) return text;
    }
  }

  const truncated =
    trimmed.length > MAX_RAW_LENGTH ? trimmed.slice(0, MAX_RAW_LENGTH) + '…' : trimmed;
  return truncated;
}

/**
 * Parse a coco/cashu error into user-friendly text for the payment status
 * toast. Falls back to the truncated raw message when no pattern matches.
 */
export function parsePaymentError(error: unknown): string {
  const raw = extractMessage(error);
  return resolveText(raw);
}
