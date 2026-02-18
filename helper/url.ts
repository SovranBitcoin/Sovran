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
