/**
 * URL utility functions for consistent URL handling across the application
 */

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
 * Remove protocol from URL (both http and https)
 * @param url - The URL to remove protocol from
 * @returns URL without protocol
 *
 * @example
 * removeProtocol('https://mint.example.com/path') // 'mint.example.com/path'
 * removeProtocol('http://test.com') // 'test.com'
 */
export function removeProtocol(url: string): string {
  if (!url) return '';
  return url.replace(/^https?:\/\//, '');
}

/**
 * Check if a string contains a URL protocol (http or https)
 * @param str - The string to check
 * @returns True if the string contains a URL protocol
 *
 * @example
 * hasUrlProtocol('https://example.com') // true
 * hasUrlProtocol('http://test.com') // true
 * hasUrlProtocol('just text') // false
 */
export function hasUrlProtocol(str: string): boolean {
  if (!str) return false;
  return str.includes('https://') || str.includes('http://');
}

/**
 * Determine the appropriate protocol for a URL based on content
 * @param url - The URL to analyze
 * @returns 'http://' for .onion domains, 'https://' for others
 *
 * @example
 * getProtocolForUrl('example.onion') // 'http://'
 * getProtocolForUrl('example.com') // 'https://'
 */
export function getProtocolForUrl(url: string): string {
  if (!url) return 'https://';
  return url.includes('.onion') ? 'http://' : 'https://';
}

/**
 * Normalize a URL by ensuring it has the correct protocol
 * @param url - The URL to normalize
 * @returns Normalized URL with appropriate protocol
 *
 * @example
 * normalizeUrl('example.com') // 'https://example.com'
 * normalizeUrl('test.onion') // 'http://test.onion'
 * normalizeUrl('https://already.com') // 'https://already.com'
 */
export function normalizeUrl(url: string): string {
  if (!url) return '';

  // If already has protocol, return as is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  const protocol = getProtocolForUrl(url);
  return `${protocol}${url}`;
}

/**
 * Check if a URL looks like a mint URL
 * @param url - The URL to check
 * @returns True if the URL appears to be a mint URL
 *
 * @example
 * looksLikeMintUrl('https://mint.example.com') // true
 * looksLikeMintUrl('https://api.example.com') // false
 */
export function looksLikeMintUrl(url: string): boolean {
  if (!url) return false;

  const domain = extractDomain(url);
  return (
    domain.includes('mint') ||
    domain.includes('cashu') ||
    domain.includes('8333') ||
    domain.includes('minibits')
  );
}

/**
 * Format a URL for display purposes (remove protocol and truncate if needed)
 * @param url - The URL to format
 * @param maxLength - Maximum length for the display string
 * @returns Formatted URL for display
 *
 * @example
 * formatUrlForDisplay('https://mint.example.com/path', 20) // 'mint.example.com/path'
 * formatUrlForDisplay('https://verylongdomain.com', 10) // 'verylongdo...'
 */
export function formatUrlForDisplay(url: string, maxLength: number = 50): string {
  if (!url) return '';

  const withoutProtocol = removeProtocol(url);

  if (withoutProtocol.length <= maxLength) {
    return withoutProtocol;
  }

  return withoutProtocol.substring(0, maxLength - 3) + '...';
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
export function getMintDisplayName(url: string, mintInfo?: { name?: string }): string {
  if (!url) return 'Unknown Mint';

  return mintInfo?.name || extractDomain(url) || 'Unknown Mint';
}
