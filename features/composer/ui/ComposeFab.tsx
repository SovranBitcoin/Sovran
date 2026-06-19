/**
 * @fileoverview Floating "new post" button for the feed.
 *
 * The feed's only write entry point — opens the composer for a fresh post.
 */
import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { INVARIANT_BLACK } from '@/shared/lib/brandColors';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { isExpo55NativeTabsSupported } from '@/navigation/nativeTabs';
import { useOpenComposer } from '@/features/composer/publish/useComposerActions';

/** Gap between the FAB and the tab bar's top edge. */
const FAB_TAB_BAR_GAP = 16;

export function ComposeFab() {
  const openComposer = useOpenComposer();
  // Inverted fill: the theme `accent` token is the foreground colour (white in
  // dark themes), which made a white icon invisible. Fill with foreground and
  // draw the icon in the background colour — high contrast in both themes.
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const insets = useSafeAreaInsets();
  // Match the AI tab composer's bottom anchor: on the NativeTabs (liquid-glass)
  // path the system already grows `insets.bottom` to cover the tab bar + home
  // indicator, so the FAB sits flush above the bar at `insets.bottom`. On the
  // SovranTabBar path the screen content already stops at the bar's top edge,
  // so `0` is flush. Adding the tab-bar height (as a list padding would) here
  // double-counts it and floats the FAB too high.
  const bottom = (isExpo55NativeTabsSupported() ? insets.bottom : 0) + FAB_TAB_BAR_GAP;
  const onPress = useCallback(() => openComposer({ mode: 'new' }), [openComposer]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="New post"
      style={[styles.fab, { backgroundColor: foreground, bottom }]}>
      <Icon name="mdi:pencil" size={24} color={background} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: INVARIANT_BLACK,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
