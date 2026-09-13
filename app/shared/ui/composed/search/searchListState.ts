import type { ReadStatus } from '@/shared/lib/read/useCachedRead';

/** A search scope's read status; `idle` = the query is too short to search. */
export type SearchStatus = 'idle' | ReadStatus;

type SearchListState = 'rows' | 'placeholders' | 'no-results' | 'error' | 'nothing';

/**
 * What a search result list shows for a scope, from its read status and
 * what it already has. Rows on screen always win: a refresh, a failure or a
 * refinement never replaces visible results with placeholders or an error.
 */
export function searchListState(
  status: SearchStatus,
  resultCount: number,
  queryLength: number,
  minQueryLength: number
): SearchListState {
  if (resultCount > 0) return 'rows';
  if (status === 'idle' || queryLength < minQueryLength) return 'nothing';
  if (status === 'loading') return 'placeholders';
  if (status === 'error') return 'error';
  if (status === 'empty' || status === 'ready') return 'no-results';
  // revalidating with nothing yet: still the first paint.
  return 'placeholders';
}
