// ---------------------------------------------------------------------------
// Input Normalization
//
// Pure string operations: strip payment URI prefixes, zero-width chars,
// BOM, URI-decode. No protocol-specific detection — that's the parser's job.
// ---------------------------------------------------------------------------

import { logger } from './logger';

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

const GENERIC_PREFIXES = [
  'web+cashu://',
  'web+cashu:',
  'cashu://',
  'cashu:',
  'lightning://',
  'lightning:',
  'lightning=',
];

const LIGHTNING_PREFIXES = ['lightning://', 'lightning:', 'lightning='];

// Hosts that historically render `?token=` or `#token` fragments containing a
// raw cashuA/cashuB token. Users frequently share these as web links.
const WEB_WALLET_HOSTS: readonly {
  host: string;
  source: 'query' | 'fragment';
  param?: string;
}[] = [
  { host: 'wallet.cashu.me', source: 'query', param: 'token' },
  { host: 'wallet.cashu.me', source: 'fragment' },
  { host: 'wallet.nutstash.app', source: 'fragment' },
  { host: 'wallet.nutstash.app', source: 'query', param: 'token' },
];

/**
 * Remove zero-width characters and BOM, then trim whitespace.
 */
export function sanitizeInput(value: string): string {
  const zeroWidthMatches = value.match(ZERO_WIDTH_RE);
  const sanitized = value.replace(ZERO_WIDTH_RE, '').trim();
  if (sanitized.length !== value.length || zeroWidthMatches) {
    logger.debug('normalize.sanitize.changed', {
      inputLength: value.length,
      outputLength: sanitized.length,
      zeroWidthCount: zeroWidthMatches?.length ?? 0,
      trimmed: sanitized.length !== value.replace(ZERO_WIDTH_RE, '').length,
    });
  }
  return sanitized;
}

/**
 * Safely decode a URI component; returns the original on failure.
 */
export function safeDecodeURIComponent(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded !== value) {
      logger.debug('normalize.decode.changed', {
        inputLength: value.length,
        outputLength: decoded.length,
        percentCount: (value.match(/%/g) ?? []).length,
      });
    }
    return decoded;
  } catch {
    logger.warn('normalize.decode.failed', {
      inputLength: value.length,
      percentCount: (value.match(/%/g) ?? []).length,
    });
    return value;
  }
}

/**
 * Iteratively strip any of the given prefixes (case-insensitive).
 * Handles double-prefixed strings like `lightning:lightning:lnbc...`.
 */
export function stripPrefixes(value: string, prefixes: string[]): string {
  let next = sanitizeInput(value);
  let strippedCount = 0;
  const strippedPrefixes: string[] = [];

  for (;;) {
    const lower = next.toLowerCase();
    const matched = prefixes.find((p) => lower.startsWith(p));
    if (!matched) {
      if (strippedCount > 0) {
        logger.debug('normalize.prefixes.stripped', {
          inputLength: value.length,
          outputLength: next.length,
          strippedCount,
          prefixes: strippedPrefixes,
        });
      }
      return next;
    }
    strippedCount += 1;
    strippedPrefixes.push(matched);
    next = next.slice(matched.length).trim();
  }
}

/**
 * Strip all known generic payment prefixes.
 */
export function stripGenericPrefixes(value: string): string {
  return stripPrefixes(value, GENERIC_PREFIXES);
}

/**
 * Strip Lightning-specific prefixes and trim (equivalent to `lnTrim`).
 */
export function stripLightningPrefixes(value: string): string {
  return stripPrefixes(value, LIGHTNING_PREFIXES);
}

/**
 * Strip Cashu-specific prefixes.
 */
export function stripCashuPrefixes(value: string): string {
  return stripPrefixes(value, [
    'web+cashu://',
    'web+cashu:',
    'cashu://',
    'cashu:',
  ]);
}

/**
 * Pull the underlying token out of a known web-wallet share URL. Returns
 * null if the input isn't a recognised wallet host. Pure string work —
 * downstream detection decides whether the extracted value is a valid
 * cashu token.
 */
function extractWebWalletToken(value: string): string | null {
  const trimmed = sanitizeInput(value);
  if (!/^https?:\/\//i.test(trimmed)) {
    logger.debug('normalize.webWallet.skipped', {
      reason: 'not_http_url',
      inputLength: trimmed.length,
    });
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    logger.warn('normalize.webWallet.parseFailed', {
      inputLength: trimmed.length,
    });
    return null;
  }

  const host = url.hostname.toLowerCase();
  for (const entry of WEB_WALLET_HOSTS) {
    if (entry.host !== host) continue;
    if (entry.source === 'query' && entry.param) {
      const raw = url.searchParams.get(entry.param);
      if (raw) {
        const token = safeDecodeURIComponent(raw).trim();
        logger.info('normalize.webWallet.tokenExtracted', {
          host,
          source: entry.source,
          param: entry.param,
          tokenLength: token.length,
        });
        return token;
      }
    } else if (entry.source === 'fragment') {
      const frag = url.hash.replace(/^#/, '');
      if (frag) {
        const token = safeDecodeURIComponent(frag).trim();
        logger.info('normalize.webWallet.tokenExtracted', {
          host,
          source: entry.source,
          tokenLength: token.length,
        });
        return token;
      }
    }
  }
  logger.debug('normalize.webWallet.noToken', {
    host,
    queryKeyCount: Array.from(url.searchParams.keys()).length,
    hasFragment: url.hash.length > 0,
  });
  return null;
}

// QR codes encode bech32/Lightning payloads in UPPERCASE (denser alphanumeric
// mode). bolt11/bolt12/LNURL/bech32-addresses are single-case and
// case-insensitive, so an all-caps one must be lowercased before its decoder
// will accept it. base64url payloads (cashu `cashuA/B`, NUT-18 `creq`) are
// case-SENSITIVE and always contain lowercase, so they never match this and are
// left untouched.
const LN_BECH32_UPPER_PREFIX = /^(LNBC|LNTB|LNTBS|LNBCRT|LNO1|LNURL1|BC1|TB1|BCRT1)/;

function lowercaseLnBech32Variant(value: string): string | null {
  if (/[a-z]/.test(value)) return null; // has lowercase → not an all-caps QR body
  if (!LN_BECH32_UPPER_PREFIX.test(value)) return null;
  const lowered = value.toLowerCase();
  return lowered !== value ? lowered : null;
}

/**
 * Produce a set of input variants for detection: raw, stripped, decoded,
 * and decoded-stripped. Deduplicates automatically.
 */
export function inputVariants(raw: string): Set<string> {
  const sanitized = sanitizeInput(raw);
  const stripped = stripGenericPrefixes(sanitized);
  const decodedRaw = safeDecodeURIComponent(sanitized);
  const decodedStripped = safeDecodeURIComponent(stripped);

  const variants = new Set<string>();
  variants.add(sanitized);
  variants.add(stripped);
  variants.add(decodedRaw);
  variants.add(decodedStripped);

  // Uppercase QR bech32/LN bodies → lowercase so decoders accept them.
  for (const v of [sanitized, stripped]) {
    const lowered = lowercaseLnBech32Variant(v);
    if (lowered) variants.add(lowered);
  }

  const webWalletToken = extractWebWalletToken(sanitized);
  if (webWalletToken) {
    variants.add(webWalletToken);
    variants.add(stripGenericPrefixes(webWalletToken));
  }

  logger.debug('normalize.inputVariants.result', {
    rawLength: raw.length,
    sanitizedLength: sanitized.length,
    variantCount: variants.size,
    addedStripped: stripped !== sanitized,
    addedDecodedRaw: decodedRaw !== sanitized,
    addedDecodedStripped: decodedStripped !== stripped,
    webWalletTokenLength: webWalletToken?.length ?? null,
  });

  return variants;
}
