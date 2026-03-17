// ---------------------------------------------------------------------------
// Screen Actions — availability logic (pure, UI-agnostic)
// ---------------------------------------------------------------------------

import type { ActionAvailability, ScreenActionName, ScreenType } from './types';

type AvailabilityMap<S extends ScreenType> = Record<ScreenActionName[S], ActionAvailability>;

// ---------------------------------------------------------------------------
// Per-screen rules
// ---------------------------------------------------------------------------

function sendTokenAvailability(entry: Record<string, unknown>): AvailabilityMap<'sendToken'> {
  const state = entry.state as string | undefined;
  const token = entry.token;
  const operationId = entry.operationId;

  const isPaid = state === 'finalized' || state === 'rolledBack';
  const hasToken = token != null;
  const canAct = !isPaid && hasToken;

  return {
    copy: { available: canAct },
    share: { available: canAct },
    nfc: { available: canAct },
    copyAsEmoji: { available: canAct },
    checkStatus: {
      available: canAct && state === 'pending',
    },
    cancel: {
      available: canAct && operationId != null,
      ...(!operationId && canAct ? { reason: 'Legacy entry — cannot cancel' } : {}),
    },
  };
}

function receiveTokenAvailability(entry: Record<string, unknown>): AvailabilityMap<'receiveToken'> {
  const token = entry.token;
  const id = entry.id as string | undefined;
  const isScanPlaceholder = id?.startsWith('receive-') ?? false;
  const isRedeemed = !isScanPlaceholder;

  return {
    redeem: { available: !isRedeemed && token != null },
  };
}

function mintQuoteAvailability(entry: Record<string, unknown>): AvailabilityMap<'mintQuote'> {
  const state = entry.state as string | undefined;
  const isPaid = state === 'ISSUED' || state === 'PAID';

  return {
    copy: { available: !isPaid },
    share: { available: !isPaid },
  };
}

function meltQuoteAvailability(entry: Record<string, unknown>): AvailabilityMap<'meltQuote'> {
  const state = entry.state as string | undefined;
  const quoteId = entry.quoteId as string | undefined;
  const isPaid = state === 'PAID';
  const isPending = state === 'PENDING';
  const isPreview = !quoteId;

  return {
    pay: { available: !isPaid && !isPending && state === 'UNPAID' },
    cancel: { available: !isPreview && (state === 'UNPAID' || isPending) },
  };
}

function paymentRequestAvailability(
  entry: Record<string, unknown>
): AvailabilityMap<'paymentRequest'> {
  const metadata = entry.metadata as Record<string, unknown> | undefined;
  const phase = metadata?.phase as string | undefined;
  const isPreview = phase === 'preview' || !phase;
  const isDelivered = phase === 'delivered';

  return {
    confirm: { available: isPreview },
    cancel: { available: !isDelivered },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const AVAILABILITY_FNS: {
  [S in ScreenType]: (entry: Record<string, unknown>) => AvailabilityMap<S>;
} = {
  sendToken: sendTokenAvailability,
  receiveToken: receiveTokenAvailability,
  mintQuote: mintQuoteAvailability,
  meltQuote: meltQuoteAvailability,
  paymentRequest: paymentRequestAvailability,
};

/**
 * Pure function — derives which actions are available from the history entry.
 * No side-effects, no React, no wallet dependencies.
 */
export function getAvailableActions<S extends ScreenType>(
  screenType: S,
  entry: Record<string, unknown>
): Record<ScreenActionName[S], ActionAvailability> {
  const fn = AVAILABILITY_FNS[screenType] as (
    e: Record<string, unknown>
  ) => Record<ScreenActionName[S], ActionAvailability>;
  return fn(entry);
}
