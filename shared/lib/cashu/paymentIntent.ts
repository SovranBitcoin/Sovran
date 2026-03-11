import { decodePaymentRequest } from '@cashu/cashu-ts';

import type {
  ParsedPaymentInput,
  SupportedPaymentOption,
} from '@/shared/lib/cashu/paymentInputParser';

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

export type PaymentIntent =
  | { type: 'receiveEcash'; option: SupportedPaymentOption }
  | { type: 'sendCashuPaymentRequest'; option: SupportedPaymentOption }
  | { type: 'payLightningInvoice'; option: SupportedPaymentOption }
  | { type: 'payLightningAddress'; option: SupportedPaymentOption }
  | { type: 'payLnurlp'; option: SupportedPaymentOption }
  | { type: 'openMintUrl'; url: string }
  | { type: 'openNpub'; npub: string }
  | { type: 'chooseOption'; parsed: ParsedPaymentInput; options: AnnotatedOption[] }
  | { type: 'ignore'; parsed: ParsedPaymentInput; reason: string };

// ---------------------------------------------------------------------------
// Recommendation annotations (declarative)
// ---------------------------------------------------------------------------

export type OptionStatus = 'recommended' | 'available' | 'disabled';

export interface AnnotatedOption {
  option: SupportedPaymentOption;
  status: OptionStatus;
  reason: string | null;
}

export interface WalletContext {
  trustedMintUrls: string[];
  mintBalances: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Recommendation rules — a declarative table of (predicate → status + reason)
// ---------------------------------------------------------------------------

type RecommendationRule = {
  applies: (option: SupportedPaymentOption, ctx: WalletContext) => boolean;
  status: OptionStatus;
  reason: (option: SupportedPaymentOption, ctx: WalletContext) => string | null;
};

function getCreqMints(option: SupportedPaymentOption): string[] {
  try {
    const decoded = decodePaymentRequest(option.value.trim());
    return decoded.mints ?? [];
  } catch {
    return [];
  }
}

function getCreqAmount(option: SupportedPaymentOption): number | undefined {
  try {
    const decoded = decodePaymentRequest(option.value.trim());
    return decoded.amount;
  } catch {
    return undefined;
  }
}

function hasMatchingMintWithBalance(
  option: SupportedPaymentOption,
  ctx: WalletContext
): boolean {
  const mints = getCreqMints(option);
  const amount = getCreqAmount(option) ?? 0;

  // No mints specified = any mint is acceptable
  const candidates =
    mints.length === 0 ? ctx.trustedMintUrls : mints.filter((m) => ctx.trustedMintUrls.includes(m));

  return candidates.some((m) => (ctx.mintBalances[m] ?? 0) >= amount);
}

const CREQ_RULES: RecommendationRule[] = [
  {
    applies: (option, ctx) => hasMatchingMintWithBalance(option, ctx),
    status: 'recommended',
    reason: () => 'Payable with Cashu — no fees',
  },
  {
    applies: (option, ctx) => {
      const mints = getCreqMints(option);
      // No mints = any mint works, so there's always a "valid" mint
      if (mints.length === 0) return false;
      return !mints.some((m) => ctx.trustedMintUrls.includes(m));
    },
    status: 'disabled',
    reason: () => 'No valid mint',
  },
  {
    applies: (option, ctx) => !hasMatchingMintWithBalance(option, ctx),
    status: 'disabled',
    reason: () => 'Insufficient balance',
  },
];

const LIGHTNING_RULES: RecommendationRule[] = [
  {
    applies: (_option, ctx) => {
      const totalBalance = Object.values(ctx.mintBalances).reduce((a, b) => a + b, 0);
      return totalBalance > 0;
    },
    status: 'available',
    reason: () => null,
  },
  {
    applies: () => true,
    status: 'disabled',
    reason: () => 'No balance',
  },
];

const RULES_BY_KIND: Record<string, RecommendationRule[]> = {
  cashuPaymentRequest: CREQ_RULES,
  lightningInvoice: LIGHTNING_RULES,
  lightningAddress: LIGHTNING_RULES,
  lnurlp: LIGHTNING_RULES,
};

// ---------------------------------------------------------------------------
// Annotate a single option using the rules table
// ---------------------------------------------------------------------------

function annotateOption(
  option: SupportedPaymentOption,
  ctx: WalletContext
): AnnotatedOption {
  const rules = RULES_BY_KIND[option.kind];
  if (!rules) {
    return { option, status: 'available', reason: null };
  }

  for (const rule of rules) {
    if (rule.applies(option, ctx)) {
      return { option, status: rule.status, reason: rule.reason(option, ctx) };
    }
  }

  return { option, status: 'available', reason: null };
}

// ---------------------------------------------------------------------------
// Annotate all options, sorting recommended first
// ---------------------------------------------------------------------------

const STATUS_SORT: Record<OptionStatus, number> = {
  recommended: 0,
  available: 1,
  disabled: 2,
};

export function annotateOptions(
  options: SupportedPaymentOption[],
  ctx: WalletContext
): AnnotatedOption[] {
  const annotated = options
    .map((o) => annotateOption(o, ctx))
    .sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status]);

  // If no option is recommended but at least one is available, promote the first available to recommended
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

// ---------------------------------------------------------------------------
// Resolve intent (pure)
// ---------------------------------------------------------------------------

const INTENT_BY_KIND: Record<
  string,
  (option: SupportedPaymentOption) => PaymentIntent
> = {
  ecashToken: (option) => ({ type: 'receiveEcash', option }),
  cashuPaymentRequest: (option) => ({ type: 'sendCashuPaymentRequest', option }),
  lightningInvoice: (option) => ({ type: 'payLightningInvoice', option }),
  lightningAddress: (option) => ({ type: 'payLightningAddress', option }),
  lnurlp: (option) => ({ type: 'payLnurlp', option }),
};

export function resolvePaymentIntent(
  parsed: ParsedPaymentInput,
  ctx?: WalletContext
): PaymentIntent {
  if (parsed.options.length > 1 && ctx) {
    const annotated = annotateOptions(parsed.options, ctx);
    return { type: 'chooseOption', parsed, options: annotated };
  }

  if (parsed.options.length > 1) {
    const annotated = parsed.options.map((option) => ({
      option,
      status: 'available' as OptionStatus,
      reason: null,
    }));
    return { type: 'chooseOption', parsed, options: annotated };
  }

  if (parsed.options.length === 1) {
    const [option] = parsed.options;
    const resolve = INTENT_BY_KIND[option.kind];
    if (resolve) return resolve(option);
  }

  if (parsed.type === 'mintUrl' && parsed.mintUrl) {
    return { type: 'openMintUrl', url: parsed.mintUrl };
  }

  if (parsed.type === 'npub' && parsed.npub) {
    return { type: 'openNpub', npub: parsed.npub };
  }

  if (parsed.type === 'bip321') {
    return {
      type: 'ignore',
      parsed,
      reason: 'Bitcoin URI contained no supported payment option',
    };
  }

  return { type: 'ignore', parsed, reason: 'Unsupported input' };
}

// ---------------------------------------------------------------------------
// NFC fallback helper
// ---------------------------------------------------------------------------

/**
 * For NFC scenarios: pick the best fallback option from a parsed input.
 * If a cashuPaymentRequest failed (e.g. NFC connection lost), this returns
 * the next best option (typically a lightning invoice) if one exists.
 */
export function getNfcFallbackOption(
  parsed: ParsedPaymentInput,
  failedKind: SupportedPaymentOption['kind']
): SupportedPaymentOption | null {
  return parsed.options.find((o) => o.kind !== failedKind) ?? null;
}
