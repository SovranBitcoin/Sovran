import type { ReadStatus } from '@/shared/lib/read/useCachedRead';

/** A search scope's read status; `idle` = the query is too short to search. */
export type SearchStatus = 'idle' | ReadStatus;

type SearchListState = 'rows' | 'placeholders' | 'no-results' | 'error' | 'nothing';

/**
 * What a search result list shows for a scope, from its read status and
 * what it already has. Rows on screen always win: a refresh, a failure or a
 * refinement never replaces visible results with placeholders or an error.
 *
 * `remoteQueryLength` is the length of what the remote search is given: `0`
 * when it is off for this query. Below the minimum the remote search never
 * starts, so an empty local answer is final and says so; at or above it,
 * `idle` means the debounce has not fired yet.
 */
export function searchListState(
  status: SearchStatus,
  resultCount: number,
  queryLength: number,
  minQueryLength: number,
  remoteQueryLength = queryLength
): SearchListState {
  if (resultCount > 0) return 'rows';
  if (queryLength === 0) return 'nothing';
  if (status === 'idle') return remoteQueryLength < minQueryLength ? 'no-results' : 'nothing';
  if (queryLength < minQueryLength) return 'nothing';
  if (status === 'loading') return 'placeholders';
  if (status === 'error') return 'error';
  if (status === 'empty' || status === 'ready') return 'no-results';
  // revalidating with nothing yet: still the first paint.
  return 'placeholders';
}
