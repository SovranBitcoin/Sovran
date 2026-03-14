// ---------------------------------------------------------------------------
// Parsing & Classification
//
// Takes raw input + wallet-provided detectors → ParsedPaymentInput.
// Handles standalone strings, BIP-321 containers, UR fragments, mint URLs,
// and npubs. Deduplicates equivalent options across variants.
// ---------------------------------------------------------------------------

import {
  sanitizeInput,
  safeDecodeURIComponent,
  stripCashuPrefixes,
  stripLightningPrefixes,
  inputVariants,
} from './normalize';
import { debugLog } from './debugLog';
import type {
  Detectors,
  PaymentOption,
  PaymentOptionKind,
  Bip321Container,
  ParsedPaymentInput,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KNOWN_BIP321_KEYS = new Set([
  'amount',
  'label',
  'message',
  'pop',
  'req-pop',
  'lightning',
  'lno',
  'pay',
  'sp',
  'pj',
  'req-pj',
  'r',
  'creq',
  'cashu',
  'token',
]);

const OPTION_PRIORITY: Record<PaymentOptionKind, number> = {
  paymentRequest: 0,
  ecashToken: 1,
  lightningInvoice: 2,
  lightningAddress: 3,
  lnurlp: 4,
};

// ---------------------------------------------------------------------------
// Dedup helpers
// ---------------------------------------------------------------------------

function dedupeKey(option: PaymentOption): string {
  if (option.kind === 'ecashToken') return `${option.kind}:${option.value}`;
  return `${option.kind}:${option.value.toLowerCase()}`;
}

function pushOption(target: PaymentOption[], option: PaymentOption, seen: Set<string>): void {
  const key = dedupeKey(option);
  if (seen.has(key)) return;
  seen.add(key);
  target.push(option);
}

function sortOptions(options: PaymentOption[]): PaymentOption[] {
  return [...options].sort((a, b) => OPTION_PRIORITY[a.kind] - OPTION_PRIORITY[b.kind]);
}

function firstOrNull(values?: string[]): string | null {
  return values && values.length > 0 ? values[0] : null;
}

// ---------------------------------------------------------------------------
// Extract supported options from a single value
// ---------------------------------------------------------------------------

function extractOptions(
  input: string,
  source: 'standalone' | 'bip321',
  detectors: Detectors,
  paramKey: string | null = null
): PaymentOption[] {
  const raw = sanitizeInput(input);
  if (!raw) return [];

  const seen = new Set<string>();
  const options: PaymentOption[] = [];

  for (const variant of inputVariants(raw)) {
    const cashuCandidate = stripCashuPrefixes(variant);

    if (cashuCandidate && detectors.isValidEcashToken(cashuCandidate)) {
      pushOption(options, { kind: 'ecashToken', value: cashuCandidate, source, paramKey }, seen);
    }

    if (cashuCandidate && detectors.isPaymentRequest(cashuCandidate)) {
      pushOption(
        options,
        { kind: 'paymentRequest', value: cashuCandidate, source, paramKey },
        seen
      );
    }

    const lightningCandidate = stripLightningPrefixes(variant);

    if (lightningCandidate && detectors.isLightningInvoice(lightningCandidate)) {
      pushOption(
        options,
        {
          kind: 'lightningInvoice',
          value: lightningCandidate,
          amount: detectors.getLightningAmount(lightningCandidate),
          source,
          paramKey,
        },
        seen
      );
      continue;
    }

    if (lightningCandidate && detectors.isLightningAddress(lightningCandidate)) {
      pushOption(
        options,
        { kind: 'lightningAddress', value: lightningCandidate, source, paramKey },
        seen
      );
      continue;
    }

    if (lightningCandidate && detectors.isLnurlp(lightningCandidate)) {
      pushOption(options, { kind: 'lnurlp', value: lightningCandidate, source, paramKey }, seen);
    }
  }

  return sortOptions(options);
}

// ---------------------------------------------------------------------------
// BIP-321 container parser
// ---------------------------------------------------------------------------

function parseBip321Container(input: string): Bip321Container | null {
  const trimmed = sanitizeInput(input);
  if (!trimmed.toLowerCase().startsWith('bitcoin:')) return null;

  let address: string | null = null;
  let params: Record<string, string[]> = {};

  try {
    const url = new URL(trimmed.replace(/^bitcoin:/i, 'bitcoin://x/'));
    const path = url.pathname.replace(/^\/+/, '');
    address = path && path !== 'x' ? path : null;

    for (const [rawKey, value] of url.searchParams.entries()) {
      const key = rawKey.toLowerCase();
      if (!params[key]) params[key] = [];
      params[key].push(value);
    }
  } catch {
    const [beforeQuery, query = ''] = trimmed.split('?');
    address = beforeQuery.replace(/^bitcoin:/i, '').trim() || null;

    for (const pair of query.split('&')) {
      if (!pair) continue;
      const [rawKey = '', rawValue = ''] = pair.split('=');
      const key = safeDecodeURIComponent(rawKey).toLowerCase();
      const value = safeDecodeURIComponent(rawValue);
      if (!key) continue;
      if (!params[key]) params[key] = [];
      params[key].push(value);
    }
  }

  const unsupportedParamKeys = Object.keys(params).filter((key) => !KNOWN_BIP321_KEYS.has(key));

  return {
    address,
    amountBtc: firstOrNull(params.amount),
    label: firstOrNull(params.label),
    message: firstOrNull(params.message),
    params,
    unsupportedParamKeys,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parsePaymentInput(rawInput: string, detectors: Detectors): ParsedPaymentInput {
  // #region agent log
  debugLog({
    location: 'coco-payment-ux/parse.ts:parsePaymentInput',
    message: 'parsePaymentInput entry',
    phase: 'entry',
    data: { inputLen: rawInput?.length },
  });
  // #endregion
  const normalized = sanitizeInput(rawInput);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!normalized) {
    return {
      raw: rawInput,
      normalized,
      type: 'unknown',
      container: null,
      options: [],
      warnings,
      errors: ['Empty input'],
    };
  }

  // UR animated QR fragments — signal to the caller, don't parse further
  if (normalized.toLowerCase().startsWith('ur:')) {
    return {
      raw: rawInput,
      normalized,
      type: 'ur',
      container: null,
      options: [],
      warnings,
      errors,
    };
  }

  // BIP-321 container
  const bip321 = parseBip321Container(normalized);
  if (bip321) {
    const seen = new Set<string>();
    const options: PaymentOption[] = [];

    if (bip321.address) {
      for (const opt of extractOptions(bip321.address, 'bip321', detectors)) {
        pushOption(options, opt, seen);
      }
    }

    for (const [paramKey, values] of Object.entries(bip321.params)) {
      for (const value of values) {
        for (const opt of extractOptions(value, 'bip321', detectors, paramKey)) {
          pushOption(options, opt, seen);
        }
      }
    }

    if (bip321.unsupportedParamKeys.length > 0) {
      warnings.push(
        `Ignored unsupported bitcoin params: ${bip321.unsupportedParamKeys.join(', ')}`
      );
    }

    return {
      raw: rawInput,
      normalized,
      type: options.length > 0 ? 'payment' : 'bip321',
      container: 'bip321',
      options: sortOptions(options),
      bip321,
      warnings,
      errors,
    };
  }

  // Standalone supported payment types
  const standaloneOptions = extractOptions(normalized, 'standalone', detectors);
  if (standaloneOptions.length > 0) {
    return {
      raw: rawInput,
      normalized,
      type: 'payment',
      container: 'standalone',
      options: standaloneOptions,
      warnings,
      errors,
    };
  }

  // Mint URL
  if (/^https?:\/\//i.test(normalized)) {
    return {
      raw: rawInput,
      normalized,
      type: 'mintUrl',
      container: null,
      options: [],
      mintUrl: normalized,
      warnings,
      errors,
    };
  }

  // Nostr npub
  const npub = detectors.parseNpub(normalized);
  if (npub) {
    return {
      raw: rawInput,
      normalized,
      type: 'npub',
      container: null,
      options: [],
      npub,
      warnings,
      errors,
    };
  }

  return {
    raw: rawInput,
    normalized,
    type: 'unknown',
    container: null,
    options: [],
    warnings,
    errors,
  };
}
