/**
 * @fileoverview Opaque search layer mounted above tab content.
 *
 * The header owns the search state and input. This layer keeps the underlying
 * Wallet, Feed, or Contacts surface mounted while search is active, so closing
 * search returns to the exact same tab/list state.
 *
 * The layer is `absoluteFill`, and an absolutely-positioned child is laid out
 * against its parent's BORDER box — `Screen`'s `safeArea` padding does not move
 * it. Every surface that mounts this runs `headerTransparent: true`
 * (SearchLayout), so without an inset of its own the scope tabs and the first
 * results row paint UNDER the profile button and the search field. The inset is
 * therefore taken from the navigator by default rather than left to each caller
 * to remember.
 */
import { useContext, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { HeaderHeightContext } from 'expo-router/react-navigation';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { zIndex } from '@/shared/styles/tokens';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { UnifiedSearch } from './UnifiedSearch';
import type { EmptySearchPrompt } from './RecentSearches';
import type { RecentSearchSurface } from './useRecentSearches';

type SearchOverlayProps = {
  recentContext: RecentSearchSurface;
  emptyPrompt?: EmptySearchPrompt;
  /**
   * Overrides the navigator header height. Only pass this where the header
   * height in context is not the right offset; every ordinary surface should
   * leave it unset and get the measured header.
   */
  topInset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function SearchOverlay({
  recentContext,
  emptyPrompt,
  topInset,
  style,
  testID,
}: SearchOverlayProps) {
  const { isSearching } = useSearchContext();
  const resolvedTestID = testID ?? `search-overlay-${recentContext}`;
  const surface = useThemeColor('surface');
  // Read the context directly (the ModalLayoutWrapper precedent):
  // `useHeaderHeight()` throws outside a Stack, and 0 is the right answer there.
  const navigatorHeaderHeight = useContext(HeaderHeightContext) ?? 0;
  const resolvedTopInset = topInset ?? navigatorHeaderHeight;
  // `paddingTop`, not `top`: the opaque surface must still cover the full
  // screen so the page underneath cannot show through the transparent header,
  // while the CONTENT starts below it.
  const overlayStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.overlay, { backgroundColor: surface, paddingTop: resolvedTopInset }, style],
    [surface, style, resolvedTopInset]
  );

  if (!isSearching) return null;

  return (
    <View testID={resolvedTestID} style={overlayStyle}>
      <UnifiedSearch recentContext={recentContext} emptyPrompt={emptyPrompt} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: zIndex.overlay,
  },
});
