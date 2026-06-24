/**
 * @fileoverview Opaque search layer mounted above tab content.
 *
 * The header owns the search state and input. This layer keeps the underlying
 * Wallet, Feed, or Contacts surface mounted while search is active, so closing
 * search returns to the exact same tab/list state.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { zIndex } from '@/shared/styles/tokens';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { UnifiedSearch } from './UnifiedSearch';
import type { EmptySearchPrompt } from './RecentSearches';
import type { RecentSearchSurface } from './useRecentSearches';

type SearchOverlayProps = {
  recentContext: RecentSearchSurface;
  emptyPrompt?: EmptySearchPrompt;
  /** Used by transparent-header surfaces such as Wallet. */
  topInset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function SearchOverlay({
  recentContext,
  emptyPrompt,
  topInset = 0,
  style,
  testID = `search-overlay-${recentContext}`,
}: SearchOverlayProps) {
  const { isSearching } = useSearchContext();
  const surface = useThemeColor('surface');
  const overlayStyle = [styles.overlay, { backgroundColor: surface, paddingTop: topInset }, style];

  if (!isSearching) return null;

  return (
    <View testID={testID} style={overlayStyle}>
      <UnifiedSearch recentContext={recentContext} emptyPrompt={emptyPrompt} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: zIndex.overlay,
  },
});
