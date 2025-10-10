/**
 * Simple fuzzy search implementation for filtering mints
 * Matches against both URL and name fields
 */

import { extractDomain } from 'helper/url';

interface SearchableMint {
  url: string;
  name: string;
  mintUrl?: string;
  auditorData?: {
    name?: string;
  };
}

/**
 * Simple fuzzy matching algorithm
 * Returns true if the query matches the text with some tolerance for missing characters
 */
function fuzzyMatch(query: string, text: string): boolean {
  if (!query || !text) return false;

  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  // Exact match
  if (textLower.includes(queryLower)) return true;

  // Fuzzy match - check if all characters in query appear in order in text
  let queryIndex = 0;
  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      queryIndex++;
    }
  }

  return queryIndex === queryLower.length;
}

/**
 * Filter mints based on search query
 * Matches against URL, name, and auditor data name
 */
export function filterMints<T extends SearchableMint>(mints: T[], query: string): T[] {
  if (!query.trim()) return mints;

  const queryLower = query.toLowerCase().trim();

  return mints.filter((mint) => {
    // Check URL match
    if (fuzzyMatch(queryLower, mint.url)) return true;

    // Check name match
    if (fuzzyMatch(queryLower, mint.name)) return true;

    // Check mintUrl match (if different from url)
    if (mint.mintUrl && fuzzyMatch(queryLower, mint.mintUrl)) return true;

    // Check auditor data name match
    if (mint.auditorData?.name && fuzzyMatch(queryLower, mint.auditorData.name)) return true;

    return false;
  });
}

/**
 * Create a pseudo mint item for invalid URLs
 * This allows users to see their input even if it's not a valid mint
 */
export function createPseudoMint(url: string): SearchableMint {
  return {
    url,
    name: extractDomain(url) || url,
    mintUrl: url,
    auditorData: undefined, // No auditor data for pseudo mints
  };
}

/**
 * Check if a URL looks like a mint URL
 * Basic heuristics to determine if a URL might be a mint
 */
export function looksLikeMintUrl(url: string): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Common mint URL patterns
    const mintPatterns = [
      'mint',
      'cashu',
      'ecash',
      'bitcoin',
      'btc',
      'sat',
      'sats',
      'lightning',
      'ln',
    ];

    return mintPatterns.some((pattern) => hostname.includes(pattern));
  } catch {
    return false;
  }
}
