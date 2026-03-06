/**
 * URL utility functions for consistent URL handling across the application
 */

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
  const withoutProtocol = url.replace(/^https?:\/\//, '');
  const slashIndex = withoutProtocol.indexOf('/');
  if (slashIndex === -1) {
    return withoutProtocol
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  }
  const domain = withoutProtocol
    .slice(0, slashIndex)
    .toLowerCase()
    .replace(/^www\./, '');
  const path = withoutProtocol.slice(slashIndex).replace(/\/$/, '');
  return domain + path;
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
  if (!url) return '';

  try {
    // Remove both http and https protocols
    const withoutProtocol = url.replace(/^https?:\/\//, '');
    // Split by '/' and take the first part (domain)
    return withoutProtocol.split('/')[0] || url;
  } catch {
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
  const withoutProtocol = trimmed.replace(/^https?:\/\//, '');
  const slashIndex = withoutProtocol.indexOf('/');
  if (slashIndex === -1) {
    const domain = withoutProtocol.toLowerCase().replace(/^www\./, '');
    return `https://${domain}`;
  }
  const domain = withoutProtocol
    .slice(0, slashIndex)
    .toLowerCase()
    .replace(/^www\./, '');
  const path = withoutProtocol.slice(slashIndex);
  return `https://${domain}${path}`;
}

export function getMintDisplayName(url: string, mintInfo?: { name?: string } | null): string {
  if (!url) return 'Unknown Mint';

  return mintInfo?.name || extractDomain(url) || 'Unknown Mint';
}
