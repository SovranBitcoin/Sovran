/**
 * Canonical mapping of coco/cashu error strings to user-friendly text. Used by
 * PaymentStatusToast / SwapStatusToast to render the failure subtitle.
 *
 * Patterns are checked in order, first match wins. Substring patterns
 * lowercase the input before comparing; regex patterns match against the
 * trimmed-but-cased original.
 */
import { paymentLog } from '@/shared/lib/logger';

const MESSAGE_MAP: { id: string; pattern: string | RegExp; text: string }[] = [
  {
    id: 'outputs_already_signed',
    pattern: 'outputs have already been signed before',
    text: 'Trying again should fix this. If not contact support.',
  },
  { id: 'inactive_keyset', pattern: 'keyset id inactive', text: 'You need to update your wallet' },
  { id: 'bad_mint_response', pattern: 'bad response', text: 'Mint problem. Try a different mint.' },
  {
    id: 'rate_limited',
    pattern: 'rate limit exceeded',
    text: 'Too many requests. Try again later.',
  },
  {
    id: 'token_already_spent',
    pattern: 'token already spent',
    text: 'This token has already been spent. Each token can only be redeemed once',
  },
  {
    id: 'proof_already_spent',
    pattern: 'proof already spent',
    text: 'This token has already been spent. Each token can only be redeemed once',
  },
  {
    id: 'already_spent',
    pattern: 'already spent',
    text: 'This token has already been spent. Each token can only be redeemed once',
  },
  {
    id: 'insufficient_funds',
    pattern: 'insufficient funds',
    text: 'You do not have enough funds to complete this transaction.',
  },
  {
    id: 'p2pk_witness_missing',
    pattern: 'witness is missing for p2pk',
    text: "This happens when you try to spend ecash locked to someone else's pubkey",
  },
  {
    id: 'mint_quote_already_issued',
    pattern: 'mint quote already issued',
    text: 'This invoice has already been paid.',
  },
  {
    id: 'invoice_already_paid',
    pattern: 'invoice already paid',
    text: 'This invoice has already been paid.',
  },
  {
    id: 'quote_already_issued',
    pattern: 'quote already issued',
    text: 'This invoice has already been paid.',
  },
  {
    id: 'lightning_payment_failed',
    pattern: 'lightning payment failed',
    text: "Your mint isn't well connected to the recipient's lightning network.",
  },
  {
    id: 'no_route',
    pattern: 'no_route',
    text: "Your mint isn't well connected to the recipient's lightning network.",
  },
  {
    id: 'mint_not_trusted_regex',
    pattern: /mint .* is not trusted/i,
    text: 'Mint is not trusted. Add it in settings first.',
  },
  {
    id: 'not_trusted',
    pattern: 'not trusted',
    text: 'Mint is not trusted. Add it in settings first.',
  },
  {
    id: 'operation_already_in_progress',
    pattern: 'operation already in progress',
    text: 'Another operation is in progress. Please wait.',
  },
  {
    id: 'operation_not_found',
    pattern: 'operation not found',
    text: 'Operation not found. It may have been cancelled.',
  },
  {
    id: 'invalid_token',
    pattern: 'invalid token',
    text: 'Invalid token. The token may be corrupted or from an unsupported mint.',
  },
  {
    id: 'network_request_failed',
    pattern: 'network request failed',
    text: 'Network error. Check your connection and try again.',
  },
  {
    id: 'connection_failed',
    pattern: 'connection failed',
    text: 'Network error. Check your connection and try again.',
  },
  {
    id: 'quote_expired',
    pattern: 'quote expired',
    text: 'Payment quote expired. Please create a new one.',
  },
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

function resolveText(rawMessage: string): {
  text: string;
  matchId: string | null;
  fallback: boolean;
} {
  const trimmed = rawMessage.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return { text: 'Payment failed', matchId: 'empty', fallback: true };

  for (const { id, pattern, text } of MESSAGE_MAP) {
    if (typeof pattern === 'string') {
      if (lower.includes(pattern.toLowerCase())) return { text, matchId: id, fallback: false };
    } else {
      if (pattern.test(trimmed)) return { text, matchId: id, fallback: false };
    }
  }

  const truncated =
    trimmed.length > MAX_RAW_LENGTH ? trimmed.slice(0, MAX_RAW_LENGTH) + '…' : trimmed;
  return { text: truncated, matchId: null, fallback: true };
}

/**
 * Parse a coco/cashu error into user-friendly text for the payment status
 * toast. Falls back to the truncated raw message when no pattern matches.
 */
export function parsePaymentError(error: unknown): string {
  const raw = extractMessage(error);
  const result = resolveText(raw);
  paymentLog.debug('payment.error.parse', {
    errorType: error instanceof Error ? error.name : typeof error,
    rawLength: raw.length,
    trimmedLength: raw.trim().length,
    matchId: result.matchId,
    fallback: result.fallback,
    outputLength: result.text.length,
  });
  return result.text;
}
