/**
 * @fileoverview The one search experience, the body of the Search tab.
 *
 * One sectioned list instead of scope tabs: the action card for a pasted
 * payment string, then People, Mints and Nearby, each shown only when it has
 * rows. Local matches answer on the first character; the remote people search
 * streams in under them. An empty query shows recents.
 */
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { useSearchAggregates } from './useSearchAggregates';
import { useRecentSearches, type RecentSearchSurface } from './useRecentSearches';
import { SearchResultRows } from './SearchResultRows';
import { RecentSearches, type EmptySearchPrompt } from './RecentSearches';

export function UnifiedSearch({
  recentContext,
  emptyPrompt,
}: {
  recentContext: RecentSearchSurface;
  emptyPrompt?: EmptySearchPrompt;
}) {
  const { searchQuery, setQuery } = useSearchContext();
  const aggregates = useSearchAggregates(searchQuery);
  const { addQuery } = useRecentSearches(recentContext);
  const { query: trimmed, recordable } = aggregates;

  // Keep a settled query that found something, so it shows up in this
  // surface's recents. Payment strings and secrets are never recordable.
  const lastRecordedRef = useRef('');
  useEffect(() => {
    if (!recordable || lastRecordedRef.current === trimmed) return;
    lastRecordedRef.current = trimmed;
    addQuery(trimmed);
  }, [trimmed, recordable, addQuery]);

  return (
    <View className="flex-1" testID="search-results">
      {trimmed.length === 0 ? (
        <RecentSearches surface={recentContext} onPickQuery={setQuery} prompt={emptyPrompt} />
      ) : (
        <SearchResultRows
          items={aggregates.items}
          status={aggregates.peopleStatus}
          onRetry={aggregates.retryPeople}
          searchQuery={searchQuery}
          remoteQueryLength={aggregates.remoteQueryLength}
        />
      )}
    </View>
  );
}
