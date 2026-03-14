// ---------------------------------------------------------------------------
// Input Normalization
//
// Pure string operations: strip payment URI prefixes, zero-width chars,
// BOM, URI-decode. No protocol-specific detection — that's the parser's job.
// ---------------------------------------------------------------------------

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

const GENERIC_PREFIXES = ['cashu://', 'cashu:', 'lightning://', 'lightning:', 'lightning='];

const LIGHTNING_PREFIXES = ['lightning://', 'lightning:', 'lightning='];

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
  return stripPrefixes(value, ['cashu://', 'cashu:']);
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
  return variants;
}
