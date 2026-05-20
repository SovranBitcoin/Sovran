// ---------------------------------------------------------------------------
// Input Normalization
//
// Pure string operations: strip payment URI prefixes, zero-width chars,
// BOM, URI-decode. No protocol-specific detection — that's the parser's job.
// ---------------------------------------------------------------------------

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
  return value.replace(ZERO_WIDTH_RE, '').trim();
}

/**
 * Safely decode a URI component; returns the original on failure.
 */
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Iteratively strip any of the given prefixes (case-insensitive).
 * Handles double-prefixed strings like `lightning:lightning:lnbc...`.
 */
export function stripPrefixes(value: string, prefixes: string[]): string {
  let next = sanitizeInput(value);

  for (;;) {
    const lower = next.toLowerCase();
    const matched = prefixes.find((p) => lower.startsWith(p));
    if (!matched) return next;
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
  return stripPrefixes(value, ['web+cashu://', 'web+cashu:', 'cashu://', 'cashu:']);
}

/**
 * Pull the underlying token out of a known web-wallet share URL. Returns
 * null if the input isn't a recognised wallet host. Pure string work —
 * downstream detection decides whether the extracted value is a valid
 * cashu token.
 */
export function extractWebWalletToken(value: string): string | null {
  const trimmed = sanitizeInput(value);
  if (!/^https?:\/\//i.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  for (const entry of WEB_WALLET_HOSTS) {
    if (entry.host !== host) continue;
    if (entry.source === 'query' && entry.param) {
      const raw = url.searchParams.get(entry.param);
      if (raw) return safeDecodeURIComponent(raw).trim();
    } else if (entry.source === 'fragment') {
      const frag = url.hash.replace(/^#/, '');
      if (frag) return safeDecodeURIComponent(frag).trim();
    }
  }
  return null;
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

  const webWalletToken = extractWebWalletToken(sanitized);
  if (webWalletToken) {
    variants.add(webWalletToken);
    variants.add(stripGenericPrefixes(webWalletToken));
  }

  return variants;
}
