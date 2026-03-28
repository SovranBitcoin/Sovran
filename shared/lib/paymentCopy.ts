/**
 * Single source of truth for payment flow copy strings.
 *
 * Used by HistoryEntryTimeline (transaction detail) and PaymentStatusToast
 * (multi-stage notification). Both components import from here so the
 * user sees consistent language across the app.
 */

// ── Mint quote (receive via Lightning) ─────────────────────────────────

export const MINT_COPY = {
  UNPAID:  { label: 'Waiting for payment', info: 'Pay the invoice to receive funds' },
  PAID:    { label: 'Payment received',    info: 'Adding to wallet...' },
  ISSUED:  { label: 'Complete',            info: (amount: number) => `+${amount} sats added to wallet` },
  expired: { label: 'Expired',             info: 'Invoice expired without payment' },
} as const;

// ── Melt quote (send via Lightning) ────────────────────────────────────

export const MELT_COPY = {
  UNPAID:  { label: 'Ready to send', info: 'Tap Send to complete payment' },
  PENDING: { label: 'Sending',       info: 'Payment in progress...' },
  PAID:    { label: 'Sent',          info: 'Payment complete' },
  expired: { label: 'Expired',       info: 'Quote expired' },
} as const;

// ── Send (ecash token) ────────────────────────────────────────────────

export const SEND_COPY = {
  prepared:   { label: 'Created',   info: 'Ready to share' },
  pending:    { label: 'Pending',   info: 'Waiting for recipient' },
  finalized:  { label: 'Claimed',   info: 'Claimed by recipient' },
  rolledBack: { label: 'Cancelled', info: 'Token funds returned to your balance' },
} as const;

// ── Payment request (NUT-18 / Nostr) ──────────────────────────────────

export const PAYMENT_REQUEST_COPY = {
  prepared:   { label: 'Created',   info: 'Creating token...' },
  nostrSent:  { label: 'Delivered', infoSending: 'Sending...', infoSent: 'Sent via Nostr' },
  finalized:  { label: 'Claimed',   info: 'Claimed by recipient' },
  rolledBack: { label: 'Cancelled', info: 'Token funds returned to your balance' },
} as const;

// ── Receive (ecash token) ─────────────────────────────────────────────

export const RECEIVE_COPY = {
  pending:      { label: 'Pending',         info: 'Tap Redeem to add to wallet' },
  redeemed:     { label: 'Added to wallet', info: (amount: number) => `+${amount} sats added to wallet` },
  alreadySpent: { label: 'Already spent',   info: 'Token was already redeemed elsewhere' },
} as const;

// ── Toast copy (multi-stage notification) ─────────────────────────────
//
// `message` = title line shown throughout the toast lifetime.
// `processing` / `delivered` / `confirmed` / `failed` = subtitle per state.
// For `confirmed`, the toast component appends the formatted amount.

export const TOAST_COPY = {
  receive: {
    message: 'Payment received',
    processing: 'Adding to wallet...',
    confirmed: 'Received',
    failed: 'Payment failed',
  },
  send: {
    message: 'Payment sent',
    processing: 'Sending...',
    confirmed: 'Sent',
    failed: 'Payment failed',
  },
  'payment-request': {
    message: 'Payment request sent',
    processing: 'Waiting for recipient',
    delivered: 'Delivered to recipient',
    confirmed: 'Claimed by recipient',
    failed: 'Payment failed',
  },
  melt: {
    message: 'Payment sent',
    processing: 'Sending...',
    confirmed: 'Sent',
    failed: 'Payment failed',
  },
  'receive-ecash': {
    message: 'Payment received',
    processing: 'Redeeming...',
    confirmed: 'Received',
    failed: 'Payment failed',
  },
} as const;
