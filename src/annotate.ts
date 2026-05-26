// ---------------------------------------------------------------------------
// Option Annotation & Recommendation
//
// Annotates each PaymentOption with a status (recommended / available /
// disabled) and a human-readable reason. Uses a declarative rules table
// per option kind. After annotation, sorts by status and promotes the
// first available option to recommended when no option is naturally
// recommended.
// ---------------------------------------------------------------------------

import { localizeReason } from './formatting/locales';
import {
  buildMethodAwareMintCandidates,
  hasMintSupportingMethod,
  isMethodImplemented,
} from './mint-capabilities';
import type {
  PaymentOption,
  WalletContext,
  Detectors,
  PaymentRequestInfo,
  AnnotatedOption,
  OptionStatus,
  RecommendationRule,
  MintMethodRequirement,
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

function lightningMeltRequirement(): MintMethodRequirement {
  return { operation: 'melt', method: 'bolt11', unit: 'sat' };
}

function onchainMeltRequirement(): MintMethodRequirement {
  return { operation: 'melt', method: 'onchain', unit: 'sat' };
}

function compatibleMeltCandidates(
  option: PaymentOption,
  ctx: WalletContext,
  requirement: MintMethodRequirement
) {
  return buildMethodAwareMintCandidates(ctx, requirement, {
    amount: option.amount ?? undefined,
    requireBalance: true,
  });
}

function hasCompatibleMeltMethod(
  option: PaymentOption,
  ctx: WalletContext,
  requirement: MintMethodRequirement
): boolean {
  return compatibleMeltCandidates(option, ctx, requirement).some(
    (candidate) => candidate.status !== 'disabled'
  );
}

function firstMeltMethodReason(
  option: PaymentOption,
  ctx: WalletContext,
  requirement: MintMethodRequirement,
  locale: string = 'en'
) {
  return (
    compatibleMeltCandidates(option, ctx, requirement).find((candidate) => candidate.reason)
      ?.reason ?? localizeReason(totalBalance(ctx) > 0 ? 'MINT_METHOD_UNSUPPORTED' : 'NO_BALANCE', locale)
  );
}

function hasLightningOption(options: PaymentOption[]): boolean {
  return options.some(
    (option) =>
      option.kind === 'lightningInvoice' ||
      option.kind === 'lightningAddress' ||
      option.kind === 'lnurlp'
  );
}

function hasMintHint(info?: PaymentRequestInfo | null): boolean {
  return (info?.mints ?? []).length > 0;
}

function paymentRequestShouldPreferLightning(
  option: PaymentOption,
  options: PaymentOption[],
  info?: PaymentRequestInfo | null
): boolean {
  return option.source === 'bip321' && !hasMintHint(info) && hasLightningOption(options);
}

// ---------------------------------------------------------------------------
// Rules tables
// ---------------------------------------------------------------------------

const PAYMENT_REQUEST_RULES: RecommendationRule[] = [
  {
    applies: (option, ctx, info) => hasMatchingMintWithBalance(option, ctx, info),
    status: 'recommended',
    reason: (_o, _c, _i, locale) => localizeReason('PAYABLE_ECASH', locale ?? 'en'),
  },
  {
    applies: (option, ctx, info) => noTrustedMintInRequest(option, ctx, info),
    status: 'disabled',
    reason: (_o, _c, _i, locale) => localizeReason('NO_VALID_MINT', locale ?? 'en'),
  },
  {
    applies: (option, ctx, info) => !hasMatchingMintWithBalance(option, ctx, info),
    status: 'disabled',
    reason: (_o, _c, _i, locale) => localizeReason('INSUFFICIENT_BALANCE', locale ?? 'en'),
  },
];

const LIGHTNING_RULES: RecommendationRule[] = [
  {
    applies: (option, ctx) => hasCompatibleMeltMethod(option, ctx, lightningMeltRequirement()),
    status: 'available',
    reason: () => null,
  },
  {
    applies: () => true,
    status: 'disabled',
    reason: (option, ctx, _i, locale) =>
      firstMeltMethodReason(option, ctx, lightningMeltRequirement(), locale ?? 'en'),
  },
];

const ONCHAIN_RULES: RecommendationRule[] = [
  {
    applies: (_option, ctx) => !hasMintSupportingMethod(ctx, onchainMeltRequirement()),
    status: 'disabled',
    reason: (_o, _c, _i, locale) => ({
      code: 'MINT_METHOD_UNSUPPORTED',
      message:
        locale === 'en'
          ? 'No trusted mint supports onchain sending'
          : 'No trusted mint supports onchain sending',
    }),
  },
  {
    applies: () => !isMethodImplemented(onchainMeltRequirement()),
    status: 'disabled',
    reason: (_o, _c, _i, locale) => ({
      code: 'PAYMENT_METHOD_NOT_IMPLEMENTED',
      message: locale === 'en' ? 'Onchain send is not supported yet' : 'Onchain send is not supported yet',
    }),
  },
  {
    applies: (option, ctx) => hasCompatibleMeltMethod(option, ctx, onchainMeltRequirement()),
    status: 'available',
    reason: () => null,
  },
  {
    applies: () => true,
    status: 'disabled',
    reason: (option, ctx, _i, locale) =>
      firstMeltMethodReason(option, ctx, onchainMeltRequirement(), locale ?? 'en'),
  },
];

const RULES_BY_KIND: Partial<Record<string, RecommendationRule[]>> = {
  paymentRequest: PAYMENT_REQUEST_RULES,
  lightningInvoice: LIGHTNING_RULES,
  lightningAddress: LIGHTNING_RULES,
  lnurlp: LIGHTNING_RULES,
  onchainAddress: ONCHAIN_RULES,
};

// ---------------------------------------------------------------------------
// Sort order
// ---------------------------------------------------------------------------

const STATUS_SORT: Record<OptionStatus, number> = {
  recommended: 0,
  available: 1,
  disabled: 2,
};

const PROMOTION_SORT: Partial<Record<PaymentOption['kind'], number>> = {
  lightningInvoice: 0,
  lightningAddress: 0,
  lnurlp: 0,
  ecashToken: 1,
  paymentRequest: 2,
};

// ---------------------------------------------------------------------------
// Annotate a single option
// ---------------------------------------------------------------------------

function annotateOption(
  option: PaymentOption,
  options: PaymentOption[],
  ctx: WalletContext,
  detectors: Detectors,
  locale: string = 'en'
): AnnotatedOption {
  const rules = RULES_BY_KIND[option.kind];
  if (!rules) {
    return { option, status: 'available', reason: null };
  }

  const info =
    option.kind === 'paymentRequest' ? detectors.getPaymentRequestInfo(option.value) : null;

  if (
    option.kind === 'paymentRequest' &&
    paymentRequestShouldPreferLightning(option, options, info)
  ) {
    return { option, status: 'available', reason: null };
  }

  for (const rule of rules) {
    if (rule.applies(option, ctx, info)) {
      return {
        option,
        status: rule.status,
        reason: rule.reason(option, ctx, info, locale),
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
  detectors: Detectors,
  locale: string = 'en'
): AnnotatedOption[] {
  const annotated = options
    .map((o) => annotateOption(o, options, ctx, detectors, locale))
    .sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status]);

  const hasRecommended = annotated.some((a) => a.status === 'recommended');
  let result: AnnotatedOption[];
  if (!hasRecommended) {
    const available = annotated
      .filter((a) => a.status === 'available')
      .sort(
        (a, b) =>
          (PROMOTION_SORT[a.option.kind] ?? 10) - (PROMOTION_SORT[b.option.kind] ?? 10)
      );
    const firstAvailable = available[0];
    if (firstAvailable) {
      result = annotated.map((a) =>
        a === firstAvailable ? { ...a, status: 'recommended' as OptionStatus } : a
      );
    } else {
      result = annotated;
    }
  } else {
    result = annotated;
  }

  return result;
}
