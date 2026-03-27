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
  const hasOperationId = !!(entry.operationId || metadata?.operationId);
  const isPreview = (phase === 'preview' || !phase) && !hasOperationId;
  const isDelivered = phase === 'delivered' || hasOperationId;

  return {
    confirm: { available: isPreview },
    cancel: { available: !isDelivered },
  };
}

function amountEntryAvailability(entry: Record<string, unknown>): AvailabilityMap<'amountEntry'> {
  const numericValue = typeof entry.numericValue === 'number' ? entry.numericValue : 0;
  const destination = entry.destination as string | undefined;
  const isSendEcash = destination === 'sendEcash';
  const hasFiatToggle =
    typeof entry.fiatCurrency === 'string' &&
    entry.fiatCurrency.length > 0 &&
    typeof entry.btcPrice === 'number' &&
    entry.btcPrice > 0;

  return {
    setInput: { available: true },
    toggle: { available: hasFiatToggle },
    next: { available: numericValue > 0 },
    paste: { available: isSendEcash },
    scanQr: { available: isSendEcash },
  };
}

function mintInfoAvailability(entry: Record<string, unknown>): AvailabilityMap<'mintInfo'> {
  const isTrusted = entry.isTrusted === true;
  const hasMintUrl = typeof entry.mintUrl === 'string' && entry.mintUrl.length > 0;
  return {
    trust: { available: !isTrusted },
    copy: { available: hasMintUrl },
    share: { available: hasMintUrl },
  };
}

function mintSelectorAvailability(
  entry: Record<string, unknown>
): AvailabilityMap<'mintSelector'> {
  const items = entry.items;
  const hasItems = Array.isArray(items) && items.length > 0;
  const isManagement = !entry.destination;

  return {
    select: { available: hasItems },
    getInfo: { available: isManagement },
    addMint: { available: isManagement },
  };
}

function receiveAvailability(entry: Record<string, unknown>): AvailabilityMap<'receive'> {
  const hasNpc = typeof entry.npcAddress === 'string' && entry.npcAddress.length > 0;
  const hasP2pk = typeof entry.p2pkKey === 'string' && entry.p2pkKey.length > 0;
  const isReceiveHub =
    entry.type === 'receive' && typeof entry.id === 'string' && entry.id === 'receive-hub';
  const unit = entry.unit as string | undefined;
  const hubLoaded = isReceiveHub;

  return {
    copy: { available: hasNpc || hasP2pk },
    share: { available: hasNpc || hasP2pk },
    paste: { available: hubLoaded },
    fixedAmount: { available: hubLoaded },
    scanQr: { available: hubLoaded },
    changeNpcMint: { available: hubLoaded && hasNpc && unit === 'sat' },
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
  receive: receiveAvailability,
  mintInfo: mintInfoAvailability,
  amountEntry: amountEntryAvailability,
  mintSelector: mintSelectorAvailability,
};

/**
 * Pure check — is the payment request entry still in preview state?
 * Returns false once an operationId is present (i.e. the operation executed).
 */
export function isPaymentRequestPreview(entry: Record<string, unknown>): boolean {
  const metadata = entry.metadata as Record<string, unknown> | undefined;
  const phase = metadata?.phase as string | undefined;
  const hasOperationId = !!(entry.operationId || metadata?.operationId);
  return (phase === 'preview' || !phase) && !hasOperationId;
}

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
