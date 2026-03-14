// ---------------------------------------------------------------------------
// Option Annotation & Recommendation
//
// Annotates each PaymentOption with a status (recommended / available /
// disabled) and a human-readable reason. Uses a declarative rules table
// per option kind. After annotation, sorts by status and promotes the
// first available option to recommended when no option is naturally
// recommended.
// ---------------------------------------------------------------------------

import type {
  PaymentOption,
  WalletContext,
  Detectors,
  PaymentRequestInfo,
  AnnotatedOption,
  OptionStatus,
  RecommendationRule,
} from './types';

// ---------------------------------------------------------------------------
// Rule predicates
// ---------------------------------------------------------------------------

function hasMatchingMintWithBalance(
  _option: PaymentOption,
  ctx: WalletContext,
  info?: PaymentRequestInfo | null
): boolean {
  const mints = info?.mints ?? [];
  const amount = info?.amount ?? 0;

  const candidates =
    mints.length === 0 ? ctx.trustedMintUrls : mints.filter((m) => ctx.trustedMintUrls.includes(m));

  return candidates.some((m) => (ctx.mintBalances[m] ?? 0) >= amount);
}

function noTrustedMintInRequest(
  _option: PaymentOption,
  ctx: WalletContext,
  info?: PaymentRequestInfo | null
): boolean {
  const mints = info?.mints ?? [];
  if (mints.length === 0) return false;
  return !mints.some((m) => ctx.trustedMintUrls.includes(m));
}

function totalBalance(ctx: WalletContext): number {
  return Object.values(ctx.mintBalances).reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// Rules tables
// ---------------------------------------------------------------------------

const PAYMENT_REQUEST_RULES: RecommendationRule[] = [
  {
    applies: (option, ctx, info) => hasMatchingMintWithBalance(option, ctx, info),
    status: 'recommended',
    reason: () => 'Payable with Cashu \u2014 no fees',
  },
  {
    applies: (option, ctx, info) => noTrustedMintInRequest(option, ctx, info),
    status: 'disabled',
    reason: () => 'No valid mint',
  },
  {
    applies: (option, ctx, info) => !hasMatchingMintWithBalance(option, ctx, info),
    status: 'disabled',
    reason: () => 'Insufficient balance',
  },
];

const LIGHTNING_RULES: RecommendationRule[] = [
  {
    applies: (_option, ctx) => totalBalance(ctx) > 0,
    status: 'available',
    reason: () => null,
  },
  {
    applies: () => true,
    status: 'disabled',
    reason: () => 'No balance',
  },
];

const RULES_BY_KIND: Partial<Record<string, RecommendationRule[]>> = {
  paymentRequest: PAYMENT_REQUEST_RULES,
  lightningInvoice: LIGHTNING_RULES,
  lightningAddress: LIGHTNING_RULES,
  lnurlp: LIGHTNING_RULES,
};

// ---------------------------------------------------------------------------
// Sort order
// ---------------------------------------------------------------------------

const STATUS_SORT: Record<OptionStatus, number> = {
  recommended: 0,
  available: 1,
  disabled: 2,
};

// ---------------------------------------------------------------------------
// Annotate a single option
// ---------------------------------------------------------------------------

function annotateOption(
  option: PaymentOption,
  ctx: WalletContext,
  detectors: Detectors
): AnnotatedOption {
  const rules = RULES_BY_KIND[option.kind];
  if (!rules) {
    return { option, status: 'available', reason: null };
  }

  const info =
    option.kind === 'paymentRequest' ? detectors.getPaymentRequestInfo(option.value) : null;

  for (const rule of rules) {
    if (rule.applies(option, ctx, info)) {
      return {
        option,
        status: rule.status,
        reason: rule.reason(option, ctx, info),
      };
    }
  }

  return { option, status: 'available', reason: null };
}

// ---------------------------------------------------------------------------
// Annotate all options
// ---------------------------------------------------------------------------

export function annotateOptions(
  options: PaymentOption[],
  ctx: WalletContext,
  detectors: Detectors
): AnnotatedOption[] {
  const annotated = options
    .map((o) => annotateOption(o, ctx, detectors))
    .sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status]);

  const hasRecommended = annotated.some((a) => a.status === 'recommended');
  if (!hasRecommended) {
    const firstAvailable = annotated.find((a) => a.status === 'available');
    if (firstAvailable) {
      return annotated.map((a) =>
        a === firstAvailable ? { ...a, status: 'recommended' as OptionStatus } : a
      );
    }
  }

  return annotated;
}
