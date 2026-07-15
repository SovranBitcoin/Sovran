/**
 * URL utility functions for consistent URL handling across the application
 */

import { err, errAsync, ok, Result, ResultAsync } from 'neverthrow';
import { Linking } from 'react-native';
import { cashuLog } from '@/shared/lib/logger';

type OpenUrlError =
  | { type: 'invalid-url'; raw: string }
  | { type: 'unsupported-scheme'; scheme: string }
  | { type: 'open-failed'; cause: unknown };

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Pure validator. Parses `raw`, requires an allowlisted scheme. Returns the
 * normalised `URL` on success. The allowlist exists to keep relay/server-
 * supplied strings from triggering deep links (e.g. `javascript:`, `file:`,
 * `intent://`) when handed to the native opener.
 */
export function validateExternalUrl(raw: string): Result<URL, OpenUrlError> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    cashuLog.warn('url.external.validate.failed', {
      rawLength: raw.length,
      reason: 'invalid-url',
    });
    return err({ type: 'invalid-url', raw });
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    cashuLog.warn('url.external.validate.failed', {
      rawLength: raw.length,
      reason: 'unsupported-scheme',
      scheme: parsed.protocol,
    });
    return err({ type: 'unsupported-scheme', scheme: parsed.protocol });
  }
  cashuLog.debug('url.external.validate.ok', {
    rawLength: raw.length,
    scheme: parsed.protocol,
    hostLength: parsed.host.length,
    pathLength: parsed.pathname.length,
  });
  return ok(parsed);
}

/**
 * Open an externally-supplied URL through the native opener. Validates the
 * scheme first and surfaces both validation and `Linking.openURL` rejections
 * to the caller via `ResultAsync` so failures aren't silently swallowed.
 */
export function openExternalUrl(raw: string): ResultAsync<void, OpenUrlError> {
  const validated = validateExternalUrl(raw);
  if (validated.isErr()) return errAsync(validated.error);
  cashuLog.info('url.external.open.start', {
    rawLength: raw.length,
    scheme: validated.value.protocol,
    hostLength: validated.value.host.length,
  });
  return ResultAsync.fromPromise(
    Linking.openURL(validated.value.toString()).then(() => undefined),
    (cause): OpenUrlError => {
      cashuLog.warn('url.external.open.failed', {
        rawLength: raw.length,
        scheme: validated.value.protocol,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      });
      return { type: 'open-failed', cause };
    }
  );
}

/**
 * Produces a protocol-free, domain-lowercased key for comparing / caching mint URLs.
 *
 * Strips http(s)://, lowercases only the domain portion, removes `www.` prefix
 * and trailing slash. Path casing is preserved (e.g. `/Bitcoin` stays `/Bitcoin`).
 *
 * NOTE: This is intentionally different from coco-cashu-core's `normalizeMintUrl`,
 * which keeps the protocol and uses the URL constructor. This version is designed
 * for UI-layer cache keys where protocol is irrelevant.
 */
export function normalizeMintUrlKey(url: string): string {
  // Scheme matching is case-insensitive: iOS sentence-capitalization turns a
  // hand-typed URL into "Https://…", which must key identically.
  const withoutProtocol = url.replace(/^https?:\/\//i, '');
  const slashIndex = withoutProtocol.indexOf('/');
  if (slashIndex === -1) {
    const result = withoutProtocol
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\/$/, '');
    cashuLog.debug('url.mint.normalize_key', {
      inputLength: url.length,
      resultLength: result.length,
      hadProtocol: /^https?:\/\//i.test(url),
      hadPath: false,
    });
    return result;
  }
  const domain = withoutProtocol
    .slice(0, slashIndex)
    .toLowerCase()
    .replace(/^www\./, '');
  const path = withoutProtocol.slice(slashIndex).replace(/\/$/, '');
  const result = domain + path;
  cashuLog.debug('url.mint.normalize_key', {
    inputLength: url.length,
    resultLength: result.length,
    hadProtocol: /^https?:\/\//i.test(url),
    hadPath: true,
    domainLength: domain.length,
    pathLength: path.length,
  });
  return result;
}

/**
 * Extract the domain name from a URL, removing protocol and path
 * @param url - The URL to extract domain from
 * @returns The domain name or the original string if no valid URL
 *
 * @example
 * extractDomain('https://mint.example.com/path') // 'mint.example.com'
 * extractDomain('http://test.com') // 'test.com'
 * extractDomain('invalid-url') // 'invalid-url'
 */
export function extractDomain(url: string): string {
  if (!url) {
    cashuLog.debug('url.domain.extract', { inputLength: 0, resultLength: 0, empty: true });
    return '';
  }

  try {
    // Remove both http and https protocols (case-insensitively — iOS
    // sentence-capitalization produces "Https://…")
    const withoutProtocol = url.replace(/^https?:\/\//i, '');
    // Split by '/' and take the first part (domain)
    const result = withoutProtocol.split('/')[0] || url;
    cashuLog.debug('url.domain.extract', {
      inputLength: url.length,
      resultLength: result.length,
      hadProtocol: /^https?:\/\//i.test(url),
    });
    return result;
  } catch {
    cashuLog.warn('url.domain.extract.failed', {
      inputLength: url.length,
    });
    return url;
  }
}

/**
 * Extract mint name from URL, falling back to domain if no specific name
 * @param url - The mint URL
 * @param mintInfo - Optional mint info object with name property
 * @returns The mint name or domain as fallback
 *
 * @example
 * getMintDisplayName('https://mint.example.com', { name: 'Example Mint' }) // 'Example Mint'
 * getMintDisplayName('https://mint.example.com') // 'mint.example.com'
 */
/**
 * Normalizes a raw mint URL for API calls by ensuring https:// prefix,
 * lowercasing the domain, stripping `www.`, and preserving path casing.
 *
 * Use this before hitting any HTTP endpoint that expects a full URL.
 * For cache-key comparisons use `normalizeMintUrlKey` instead.
 */
export function normalizeUrlForApi(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  // Case-insensitive: "Https://mint" (iOS sentence-capitalization) must not
  // survive as a phantom "https:" domain segment.
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '');
  const slashIndex = withoutProtocol.indexOf('/');
  if (slashIndex === -1) {
    const domain = withoutProtocol.toLowerCase().replace(/^www\./, '');
    const result = `https://${domain}`;
    cashuLog.debug('url.api.normalize', {
      inputLength: rawUrl.length,
      trimmedLength: trimmed.length,
      resultLength: result.length,
      hadPath: false,
    });
    return result;
  }
  const domain = withoutProtocol
    .slice(0, slashIndex)
    .toLowerCase()
    .replace(/^www\./, '');
  const path = withoutProtocol.slice(slashIndex);
  const result = `https://${domain}${path}`;
  cashuLog.debug('url.api.normalize', {
    inputLength: rawUrl.length,
    trimmedLength: trimmed.length,
    resultLength: result.length,
    hadPath: true,
    domainLength: domain.length,
    pathLength: path.length,
  });
  return result;
}

export function getMintDisplayName(url: string, mintInfo?: { name?: string } | null): string {
  if (!url) {
    cashuLog.debug('url.mint.display_name', {
      inputLength: 0,
      hasMintInfoName: !!mintInfo?.name,
      source: 'unknown',
    });
    return 'Unknown Mint';
  }

  const result = mintInfo?.name || extractDomain(url) || 'Unknown Mint';
  cashuLog.debug('url.mint.display_name', {
    inputLength: url.length,
    resultLength: result.length,
    hasMintInfoName: !!mintInfo?.name,
    source: mintInfo?.name ? 'mint-info' : result === 'Unknown Mint' ? 'unknown' : 'domain',
  });
  return result;
}
