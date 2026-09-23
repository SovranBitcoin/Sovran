/**
 * @fileoverview The one search experience, mounted by every surface.
 *
 * Contacts, Feed, and Wallet mount this through `SearchOverlay` and get the
 * identical UX: one scope-tab row (All / People / Posts / Mints / Groups), an
 * "All" default that aggregates people + places + mints into one ranked list,
 * and a consistent empty-query recents view. A single `selectedScope` value
 * drives the highlight, so two tabs can never read as selected at once.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { SearchPostsList } from '@/features/contacts/components/SearchPostsList';
import { useSearchAggregates, type SearchAggregates } from './useSearchAggregates';
import { useRecentSearches, type RecentSearchSurface } from './useRecentSearches';
import { SearchScopeTabs } from './SearchScopeTabs';
import { computeVisibleScopes, resolveSelectedScope, type SearchScopeId } from './scopes';
import { SearchResultRows } from './SearchResultRows';
import { RecentSearches, type EmptySearchPrompt } from './RecentSearches';

const SCOPE_ROW_HEIGHT = 56;

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
  const [separator] = useThemeColor(['separator-secondary'] as const);
  const [selectedScope, setSelectedScope] = useState<SearchScopeId>('All');

  const { query: trimmed, counts } = aggregates;

  // Visible scopes: All always; the rest only when they have results for the
  // current query. Empty query → show the full row (recents render below).
  const visibleScopes = useMemo(() => computeVisibleScopes(trimmed, counts), [trimmed, counts]);

  // Single-selection invariant: if the active scope's tab disappears, fall back
  // to All. This is the only reset path — there is no second selection axis.
  useEffect(() => {
    const resolved = resolveSelectedScope(visibleScopes, selectedScope);
    if (resolved !== selectedScope) setSelectedScope(resolved);
  }, [visibleScopes, selectedScope]);

  // Record the committed query under this surface once results settle with at
  // least one hit, so it shows up in this surface's recent-search chips.
  const lastRecordedRef = useRef('');
  useEffect(() => {
    if (!trimmed || aggregates.loading) return;
    const total = counts.people + counts.groups + counts.mints;
    if (total > 0 && lastRecordedRef.current !== trimmed) {
      lastRecordedRef.current = trimmed;
      addQuery(trimmed);
    }
  }, [trimmed, aggregates.loading, counts, addQuery]);

  return (
    <View style={styles.root}>
      <View style={[styles.scopeRow, { borderBottomColor: separator }]}>
        <SearchScopeTabs
          scopes={visibleScopes}
          selected={selectedScope}
          onSelect={setSelectedScope}
        />
      </View>
      <View style={styles.body}>
        {trimmed.length === 0 ? (
          <RecentSearches surface={recentContext} onPickQuery={setQuery} prompt={emptyPrompt} />
        ) : (
          <ScopeBody scope={selectedScope} aggregates={aggregates} searchQuery={searchQuery} />
        )}
      </View>
    </View>
  );
}

function ScopeBody({
  scope,
  aggregates,
  searchQuery,
}: {
  scope: SearchScopeId;
  aggregates: SearchAggregates;
  searchQuery: string;
}) {
  // `key={scope}`: every branch below (bar Posts) returns the SAME component
  // type at the SAME position, so React reconciles them as one element and the
  // FlashList underneath keeps its recycled cells and scroll offset across a
  // scope change. The rows for the new scope then only appear once a scroll
  // forces the cells to re-render. A per-scope key makes each scope its own
  // list, which is what it is.
  switch (scope) {
    case 'People':
      return (
        <SearchResultRows
          key={scope}
          results={aggregates.people}
          status={aggregates.peopleStatus}
          onRetry={aggregates.retryPeople}
          searchQuery={searchQuery}
        />
      );
    case 'Posts':
      return <SearchPostsList pubkeys={aggregates.postsAuthors} />;
    case 'Mints':
      return (
        <SearchResultRows
          key={scope}
          results={aggregates.mints}
          status={aggregates.mintsStatus}
          onRetry={aggregates.retryMints}
          searchQuery={searchQuery}
        />
      );
    case 'Groups':
      return (
        <SearchResultRows
          key={scope}
          results={aggregates.groups}
          status="ready"
          searchQuery={searchQuery}
        />
      );
    case 'All':
    default:
      // People is the primary read for the All scope; mints ride along.
      return (
        <SearchResultRows
          key="All"
          results={aggregates.all}
          status={aggregates.peopleStatus}
          onRetry={aggregates.retryPeople}
          searchQuery={searchQuery}
        />
      );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scopeRow: {
    height: SCOPE_ROW_HEIGHT,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1 },
});
