/**
 * Simple fuzzy search implementation for filtering mints
 * Matches against both URL and name fields
 */

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
