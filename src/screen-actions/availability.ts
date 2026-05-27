// ---------------------------------------------------------------------------
// Screen Actions — availability logic (pure, UI-agnostic)
// ---------------------------------------------------------------------------

import type { ActionAvailability, ScreenActionName, ScreenType } from './types';
import {
  evaluateMintMethodAmountAvailability,
  isMethodImplemented,
  methodContextHasSupportingMint,
  type MintMethodAmountAvailability,
} from '../mint-capabilities';
import type { AmountEntryMethodContext, MintMethodRequirement } from '../types';

type AvailabilityMap<S extends ScreenType> = Record<ScreenActionName[S], ActionAvailability>;

function getSelectedMintUrl(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.selectedMintUrl === 'string' && entry.selectedMintUrl.length > 0) {
    return entry.selectedMintUrl;
  }
  if (typeof entry.mintUrl === 'string' && entry.mintUrl.length > 0) {
    return entry.mintUrl;
  }
  return undefined;
}

function getAmountAvailability(
  methodContext: AmountEntryMethodContext | undefined,
  requirement: MintMethodRequirement,
  amount: number,
  selectedMintUrl: string | undefined,
  options: { requireBalance?: boolean } = {}
): MintMethodAmountAvailability | null {
  if (!methodContext) return null;
  return evaluateMintMethodAmountAvailability(methodContext, requirement, {
    amount,
    ...(selectedMintUrl ? { selectedMintUrl } : {}),
    ...(options.requireBalance != null ? { requireBalance: options.requireBalance } : {}),
  });
}

function hasCompatibleCandidate(
  availability: MintMethodAmountAvailability | null,
  fallbackWhenContextMissing: boolean
): boolean {
  return availability ? availability.availableCandidates.length > 0 : fallbackWhenContextMissing;
}

function methodAmountReason(
  _availability: MintMethodAmountAvailability | null,
  fallback: string
): string {
  return fallback;
}

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
    copy: {
      available: canAct,
      variants: [
        {
          id: 'text',
          label: 'as Text',
          description: 'Copy the token string',
          icon: 'lets-icons:copy',
          available: canAct,
        },
        {
          id: 'emoji',
          label: 'as Emoji',
          description: 'Copy as an emoji-packed string',
          icon: 'fluent:emoji-24-filled',
          available: canAct,
        },
      ],
    },
    share: { available: canAct },
    nfc: { available: canAct },
    // Deprecated — surfaced via `copy.variants[emoji]` instead. Retained so
    // the wallet's existing handler (emojiPickerPopup) can still be invoked
    // under the hood when the variant fires. Remove in Phase 5.
    copyAsEmoji: { available: canAct },
    checkStatus: {
      available: canAct && state === 'pending',
    },
    cancel: {
      available: canAct && operationId != null,
      ...(!operationId && canAct ? { reason: 'Legacy entry — cannot cancel' } : {}),
    },
    back: { available: true },
  };
}

function receiveTokenAvailability(entry: Record<string, unknown>): AvailabilityMap<'receiveToken'> {
  const token = entry.token;
  const id = entry.id as string | undefined;
  const isScanPlaceholder = id?.startsWith('receive-') ?? false;
  const isRedeemed = !isScanPlaceholder;

  return {
    redeem: { available: !isRedeemed && token != null },
    back: { available: true },
  };
}

function mintQuoteAvailability(entry: Record<string, unknown>): AvailabilityMap<'mintQuote'> {
  const state = entry.state as string | undefined;
  const isPaid = state === 'ISSUED' || state === 'PAID';

  return {
    copy: { available: !isPaid },
    share: { available: !isPaid },
    back: { available: true },
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
    back: { available: true },
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
    back: { available: true },
  };
}

function amountEntryAvailability(entry: Record<string, unknown>): AvailabilityMap<'amountEntry'> {
  const effectiveSat = typeof entry.effectiveSatAmount === 'number' ? entry.effectiveSatAmount : 0;
  const destination = entry.destination as string | undefined;
  const isSendEcash = destination === 'sendEcash';
  const isMeltQuote = destination === 'meltQuote';
  const isMintQuote = destination === 'mintQuote';
  const isPaymentRequest = destination === 'paymentRequest';
  const meltTarget = typeof entry.meltTarget === 'string' ? entry.meltTarget : '';
  const hasMeltTarget = meltTarget.length > 0;
  const hasFiatToggle =
    typeof entry.fiatCurrency === 'string' &&
    entry.fiatCurrency.length > 0 &&
    typeof entry.btcPrice === 'number' &&
    entry.btcPrice > 0;

  // The Next menu surfaces applicable rails and disables the ones that do not
  // apply to the current flow. Onchain is only listed when at least one trusted
  // mint advertises the relevant method for this direction. This
  // mirrors the Copy menu's "always-visible, per-variant availability" shape
  // so the UX is consistent across the app: users see every possible payment
  // method, learn which ones exist, and get a reason string for anything
  // currently unavailable.
  //
  // Gate on effectiveSatAmount rather than the raw numericValue so fiat-mode
  // entries that round to zero sats (e.g. "$0.000001") don't enable the
  // button and produce a silent no-op when the handler — which only sees
  // effectiveSatAmount — early-returns.
  const nextCanFire = effectiveSat >= 1 && Number.isFinite(effectiveSat);
  const unit = typeof entry.unit === 'string' ? entry.unit : 'sat';
  const methodContext = entry.methodContext as AmountEntryMethodContext | undefined;
  const selectedMintUrl = getSelectedMintUrl(entry);
  const receiveLightningRequirement: MintMethodRequirement = {
    operation: 'mint',
    method: 'bolt11',
    unit,
  };
  const receiveOnchainRequirement: MintMethodRequirement = {
    operation: 'mint',
    method: 'onchain',
    unit,
  };
  const sendLightningRequirement: MintMethodRequirement = {
    operation: 'melt',
    method: 'bolt11',
    unit,
  };
  const sendOnchainRequirement: MintMethodRequirement = {
    operation: 'melt',
    method: 'onchain',
    unit,
  };
  const receiveLightningAvailability = getAmountAvailability(
    methodContext,
    receiveLightningRequirement,
    effectiveSat,
    selectedMintUrl
  );
  const receiveOnchainSupported = methodContextHasSupportingMint(
    methodContext,
    receiveOnchainRequirement
  );
  const receiveOnchainAvailability = getAmountAvailability(
    methodContext,
    receiveOnchainRequirement,
    effectiveSat,
    selectedMintUrl
  );
  const sendLightningAvailability = getAmountAvailability(
    methodContext,
    sendLightningRequirement,
    effectiveSat,
    selectedMintUrl,
    { requireBalance: true }
  );
  const receiveLightningCompatible = hasCompatibleCandidate(receiveLightningAvailability, true);
  const receiveOnchainCompatible = hasCompatibleCandidate(receiveOnchainAvailability, false);
  const sendLightningCompatible = hasCompatibleCandidate(sendLightningAvailability, true);
  const sendOnchainSupported = methodContextHasSupportingMint(
    methodContext,
    sendOnchainRequirement
  );

  // ── ecash ──────────────────────────────────────────────────────────
  let ecashAvailable = false;
  let ecashDescription: string | undefined;
  let ecashReason: string | undefined;
  let ecashLabel = 'as Ecash';
  if (isMintQuote) {
    ecashReason = 'Not available for receive';
  } else if (isMeltQuote) {
    ecashReason = 'Lightning destination';
  } else if (isPaymentRequest) {
    ecashAvailable = nextCanFire;
    ecashDescription = 'Send a Cashu payment request';
    ecashLabel = 'as Ecash (payment request)';
  } else if (isSendEcash) {
    ecashAvailable = nextCanFire;
    ecashDescription = 'Send as a Cashu token';
  } else {
    ecashReason = 'Unavailable';
  }

  // ── lightning ──────────────────────────────────────────────────────
  // When a concrete meltTarget is present, surface it in the description so
  // the user sees exactly what's about to be paid — `user@domain` for lud16 /
  // NIP-05 targets, truncated middle for bolt11 / LNURL strings.
  const formatLightningTarget = (target: string): string => {
    const trimmed = target.trim();
    if (trimmed.includes('@')) return trimmed;
    if (trimmed.length <= 18) return trimmed;
    return `${trimmed.slice(0, 9)}…${trimmed.slice(-9)}`;
  };

  let lightningAvailable = false;
  let lightningDescription: string | undefined;
  let lightningReason: string | undefined;
  if (isMintQuote) {
    lightningAvailable = nextCanFire && receiveLightningCompatible;
    lightningDescription = 'Create a Lightning invoice';
    if (!receiveLightningCompatible) {
      lightningReason = methodAmountReason(
        receiveLightningAvailability,
        'No trusted mint supports Lightning receive'
      );
    }
  } else if (isMeltQuote) {
    lightningAvailable = nextCanFire && sendLightningCompatible;
    lightningDescription = hasMeltTarget
      ? `Pay ${formatLightningTarget(meltTarget)} over Lightning`
      : 'Pay over Lightning';
    if (!sendLightningCompatible) {
      lightningReason = methodAmountReason(
        sendLightningAvailability,
        'No trusted mint can pay over Lightning'
      );
    }
  } else if (isPaymentRequest) {
    lightningReason = 'Not supported for payment requests';
  } else if (isSendEcash) {
    if (hasMeltTarget) {
      lightningAvailable = nextCanFire && sendLightningCompatible;
      lightningDescription = `Pay ${formatLightningTarget(meltTarget)} over Lightning`;
      if (!sendLightningCompatible) {
        lightningReason = methodAmountReason(
          sendLightningAvailability,
          'No trusted mint can pay over Lightning'
        );
      }
    } else {
      lightningReason = 'No Lightning target';
    }
  } else {
    lightningReason = 'Unavailable';
  }

  // ── onchain ────────────────────────────────────────────────────────
  // Coco currently supports reusable onchain mint quotes only. Only surface
  // onchain when at least one trusted mint advertises the relevant NUT method.
  const receiveOnchainImplemented = isMethodImplemented(receiveOnchainRequirement);
  const sendOnchainImplemented = isMethodImplemented(sendOnchainRequirement);
  const showOnchainReceive = isMintQuote && receiveOnchainImplemented && receiveOnchainSupported;
  const showOnchainSend = !isMintQuote && sendOnchainImplemented && sendOnchainSupported;
  const onchainAvailable = showOnchainReceive ? nextCanFire && receiveOnchainCompatible : false;
  const onchainDescription = showOnchainReceive
    ? 'Create an onchain receive address'
    : showOnchainSend
      ? 'Pay to an onchain address'
      : undefined;
  const onchainReason = showOnchainReceive
    ? receiveOnchainCompatible
      ? undefined
      : methodAmountReason(
          receiveOnchainAvailability,
          'No trusted mint can create an onchain receive address'
        )
    : showOnchainSend
      ? 'Onchain send is not supported yet'
      : undefined;

  // Base order — available entries bubble to the top via a stable sort below
  // so the user sees executable options first and disabled/"coming soon" rows
  // sink to the bottom.
  const baseVariants = [
    {
      id: 'ecash',
      label: ecashLabel,
      icon: 'ph:coins',
      available: ecashAvailable,
      ...(ecashDescription ? { description: ecashDescription } : {}),
      ...(ecashReason ? { reason: ecashReason } : {}),
    },
    {
      id: 'lightning',
      label: 'as Lightning',
      icon: 'mingcute:lightning-fill',
      available: lightningAvailable,
      ...(lightningDescription ? { description: lightningDescription } : {}),
      ...(lightningReason ? { reason: lightningReason } : {}),
    },
    ...(showOnchainReceive || showOnchainSend
      ? [
          {
            id: 'onchain',
            label: 'as Onchain',
            icon: 'hugeicons:blockchain-01',
            available: onchainAvailable,
            ...(onchainDescription ? { description: onchainDescription } : {}),
            ...(onchainReason ? { reason: onchainReason } : {}),
          },
        ]
      : []),
  ];
  const nextVariants = baseVariants
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      if (a.v.available !== b.v.available) return a.v.available ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ v }) => v);
  const hasAvailableNextVariant = nextVariants.some((variant) => variant.available);
  const nextUnavailableReason =
    nextVariants.find((variant) => !variant.available && variant.id !== 'ecash' && variant.reason)
      ?.reason ??
    nextVariants.find((variant) => !variant.available && variant.reason)?.reason;

  return {
    setInput: { available: true },
    toggle: { available: hasFiatToggle },
    next: {
      available: nextCanFire && hasAvailableNextVariant,
      ...(nextCanFire && !hasAvailableNextVariant && nextUnavailableReason
        ? { reason: nextUnavailableReason }
        : {}),
      variants: nextVariants,
    },
    paste: { available: isSendEcash },
    scanQr: { available: isSendEcash },
    cancel: { available: true },
    back: { available: true },
  };
}

function mintInfoAvailability(entry: Record<string, unknown>): AvailabilityMap<'mintInfo'> {
  const isTrusted = entry.isTrusted === true;
  const hasMintUrl = typeof entry.mintUrl === 'string' && entry.mintUrl.length > 0;
  return {
    trust: { available: !isTrusted },
    copy: { available: hasMintUrl },
    share: { available: hasMintUrl },
    back: { available: true },
  };
}

function mintSelectorAvailability(entry: Record<string, unknown>): AvailabilityMap<'mintSelector'> {
  const items = entry.items;
  const hasItems = Array.isArray(items) && items.length > 0;
  const isManagement = !entry.destination;

  return {
    select: { available: hasItems },
    getInfo: { available: isManagement },
    addMint: { available: isManagement },
    cancel: { available: true },
    back: { available: true },
  };
}

function receiveAvailability(entry: Record<string, unknown>): AvailabilityMap<'receive'> {
  const hasNpc = typeof entry.npcAddress === 'string' && entry.npcAddress.length > 0;
  const hasP2pk = typeof entry.p2pkKey === 'string' && entry.p2pkKey.length > 0;
  const isReceiveHub =
    entry.type === 'receive' && typeof entry.id === 'string' && entry.id === 'receive-hub';
  const unit = entry.unit as string | undefined;
  const hubLoaded = isReceiveHub;
  const methodContext = entry.methodContext as AmountEntryMethodContext | undefined;
  const canReceiveLightning = methodContextHasSupportingMint(methodContext, {
    operation: 'mint',
    method: 'bolt11',
    unit: unit ?? 'sat',
  });

  return {
    copy: { available: hasNpc || hasP2pk },
    share: { available: hasNpc || hasP2pk },
    paste: { available: hubLoaded },
    fixedAmount: {
      available: hubLoaded && canReceiveLightning,
      ...(!canReceiveLightning ? { reason: 'No trusted mint supports Lightning receive' } : {}),
    },
    scanQr: { available: hubLoaded },
    changeNpcMint: { available: hubLoaded && hasNpc && unit === 'sat' },
    back: { available: true },
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
