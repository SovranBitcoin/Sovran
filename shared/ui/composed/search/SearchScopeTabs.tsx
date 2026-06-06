/**
 * @fileoverview The one scope-tab row, shared by every search surface.
 *
 * A single horizontal row of `FeedTabButton` pills driven by ONE `selected`
 * value — `active = scope === selected` is the only selection signal, so it is
 * structurally impossible for two pills to read as selected at once. This
 * replaces the Contacts pill-bar + separate People/Posts toggle (which needed a
 * fragile `suppressActiveHighlight` flag to stay single-selected) and the Feed's
 * inline search-tab branch.
 */
import React from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { FeedTabButton } from '@/features/feed/components/FeedTabButton';
import type { SearchScopeId } from './scopes';

export type { SearchScopeId } from './scopes';

type SearchScopeTabsProps = {
  /** Visible scopes, in order. The caller filters out empty ones. */
  scopes: readonly SearchScopeId[];
  selected: SearchScopeId;
  onSelect: (id: SearchScopeId) => void;
};

export function SearchScopeTabs({ scopes, selected, onSelect }: SearchScopeTabsProps) {
  return (
    <FlatList
      horizontal
      data={scopes}
      keyExtractor={(item) => item}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      renderItem={({ item }) => (
        <FeedTabButton label={item} active={item === selected} onPress={() => onSelect(item)} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 4,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
});
