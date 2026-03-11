import { decodePaymentRequest } from '@cashu/cashu-ts';
import { nip19 } from 'nostr-tools';

import {
  getLightningAmount,
  isLightningInvoice,
  isValidEcashToken,
  isLightningAddress,
  isLnurlp,
  lnTrim,
} from '@/shared/lib/cashu/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedPaymentKind =
  | 'ecashToken'
  | 'cashuPaymentRequest'
  | 'lightningInvoice'
  | 'lightningAddress'
  | 'lnurlp';

export interface SupportedPaymentOption {
  kind: SupportedPaymentKind;
  value: string;
  amount?: number | null;
  source: 'standalone' | 'bip321';
  paramKey?: string | null;
}

export interface ParsedBip321Container {
  address: string | null;
  amountBtc: string | null;
  label: string | null;
  message: string | null;
  params: Record<string, string[]>;
  unsupportedParamKeys: string[];
}

export interface ParsedPaymentInput {
  raw: string;
  normalized: string;
  type: 'ur' | 'supported' | 'mintUrl' | 'npub' | 'bip321' | 'unknown';
  container: 'standalone' | 'bip321' | null;
  options: SupportedPaymentOption[];
  bip321?: ParsedBip321Container;
  mintUrl?: string;
  npub?: string;
  warnings: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENERIC_PREFIXES = [
  'cashu://',
  'cashu:',
  'lightning://',
  'lightning:',
  'lightning=',
];

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

const OPTION_PRIORITY: Record<SupportedPaymentKind, number> = {
  cashuPaymentRequest: 0,
  ecashToken: 1,
  lightningInvoice: 2,
  lightningAddress: 3,
  lnurlp: 4,
};

// ---------------------------------------------------------------------------
// Helpers (pure, no side effects)
// ---------------------------------------------------------------------------

function sanitizeInput(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripRepeatedPrefixes(value: string, prefixes: string[]): string {
  let next = sanitizeInput(value);

  while (true) {
    const lower = next.toLowerCase();
    const matched = prefixes.find((prefix) => lower.startsWith(prefix));
    if (!matched) return next;
    next = next.slice(matched.length).trim();
  }
}

function firstOrNull(values?: string[]): string | null {
  return values && values.length > 0 ? values[0] : null;
}

function dedupeKey(option: SupportedPaymentOption): string {
  if (option.kind === 'ecashToken') {
    return `${option.kind}:${option.value}`;
  }
  return `${option.kind}:${option.value.toLowerCase()}`;
}

function pushOption(
  target: SupportedPaymentOption[],
  option: SupportedPaymentOption,
  seen: Set<string>
) {
  const key = dedupeKey(option);
  if (seen.has(key)) return;
  seen.add(key);
  target.push(option);
}

function sortOptions(options: SupportedPaymentOption[]): SupportedPaymentOption[] {
  return [...options].sort((a, b) => OPTION_PRIORITY[a.kind] - OPTION_PRIORITY[b.kind]);
}

function isPaymentRequest(input: string): boolean {
  const trimmed = stripRepeatedPrefixes(input, ['cashu://', 'cashu:']);
  const lower = trimmed.toLowerCase();

  const looksLikeCreq = lower.startsWith('creqa') || lower.startsWith('creqb');
  if (!looksLikeCreq) return false;

  try {
    decodePaymentRequest(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function parseNpub(input: string): string | null {
  const trimmed = sanitizeInput(input);
  const value = trimmed.toLowerCase().startsWith('nostr:') ? trimmed.slice(6) : trimmed;

  if (!value.startsWith('npub1')) return null;

  try {
    const decoded = nip19.decode(value);
    return decoded.type === 'npub' ? value : null;
  } catch {
    return null;
  }
}

function normalizeLightningCandidate(value: string): string {
  return lnTrim(stripRepeatedPrefixes(value, ['lightning://', 'lightning:', 'lightning=']));
}

// ---------------------------------------------------------------------------
// Value → SupportedPaymentOption[]
// ---------------------------------------------------------------------------

function extractSupportedOptionsFromValue(
  input: string,
  source: 'standalone' | 'bip321',
  paramKey: string | null = null
): SupportedPaymentOption[] {
  const raw = sanitizeInput(input);
  if (!raw) return [];

  const seen = new Set<string>();
  const options: SupportedPaymentOption[] = [];

  const variants = new Set<string>();
  const strippedGeneric = stripRepeatedPrefixes(raw, GENERIC_PREFIXES);
  const decodedRaw = safeDecodeURIComponent(raw);
  const decodedStripped = safeDecodeURIComponent(strippedGeneric);

  variants.add(raw);
  variants.add(strippedGeneric);
  variants.add(decodedRaw);
  variants.add(decodedStripped);

  for (const variant of variants) {
    const cashuCandidate = stripRepeatedPrefixes(variant, ['cashu://', 'cashu:']);

    if (cashuCandidate && isValidEcashToken(cashuCandidate)) {
      pushOption(
        options,
        { kind: 'ecashToken', value: cashuCandidate, source, paramKey },
        seen
      );
    }

    if (cashuCandidate && isPaymentRequest(cashuCandidate)) {
      pushOption(
        options,
        { kind: 'cashuPaymentRequest', value: cashuCandidate, source, paramKey },
        seen
      );
    }

    const lightningCandidate = normalizeLightningCandidate(variant);

    if (lightningCandidate && isLightningInvoice(lightningCandidate)) {
      pushOption(
        options,
        {
          kind: 'lightningInvoice',
          value: lightningCandidate,
          amount: getLightningAmount(lightningCandidate) || null,
          source,
          paramKey,
        },
        seen
      );
      continue;
    }

    if (lightningCandidate && isLightningAddress(lightningCandidate)) {
      pushOption(
        options,
        { kind: 'lightningAddress', value: lightningCandidate, source, paramKey },
        seen
      );
      continue;
    }

    if (lightningCandidate && isLnurlp(lightningCandidate)) {
      pushOption(
        options,
        { kind: 'lnurlp', value: lightningCandidate, source, paramKey },
        seen
      );
    }
  }

  return sortOptions(options);
}

// ---------------------------------------------------------------------------
// BIP-321 container parser
// ---------------------------------------------------------------------------

function parseBip321Container(input: string): ParsedBip321Container | null {
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

  const unsupportedParamKeys = Object.keys(params).filter(
    (key) => !KNOWN_BIP321_KEYS.has(key)
  );

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

export function parsePaymentInput(rawInput: string): ParsedPaymentInput {
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

  // UR animated QR fragments
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
    const options: SupportedPaymentOption[] = [];

    if (bip321.address) {
      for (const option of extractSupportedOptionsFromValue(bip321.address, 'bip321', null)) {
        pushOption(options, option, seen);
      }
    }

    for (const [paramKey, values] of Object.entries(bip321.params)) {
      for (const value of values) {
        for (const option of extractSupportedOptionsFromValue(value, 'bip321', paramKey)) {
          pushOption(options, option, seen);
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
      type: options.length > 0 ? 'supported' : 'bip321',
      container: 'bip321',
      options: sortOptions(options),
      bip321,
      warnings,
      errors,
    };
  }

  // Standalone supported payment types
  const standaloneOptions = extractSupportedOptionsFromValue(normalized, 'standalone');
  if (standaloneOptions.length > 0) {
    return {
      raw: rawInput,
      normalized,
      type: 'supported',
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
  const npub = parseNpub(normalized);
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
