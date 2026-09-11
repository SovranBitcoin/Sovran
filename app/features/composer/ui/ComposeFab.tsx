/**
 * @fileoverview Floating "new post" button for the feed.
 *
 * The feed's only write entry point — opens the composer for a fresh post.
 */
import { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { useScreenInsets } from '@/shared/hooks/useScreenInsets';

import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { INVARIANT_BLACK } from '@/shared/lib/brandColors';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useOpenComposer } from '@/features/composer/publish/useComposerActions';

/** Gap between the FAB and the tab bar's top edge. */
const FAB_TAB_BAR_GAP = 16;
const FAB_SIZE = 56;
export const COMPOSE_FAB_CLEARANCE = FAB_SIZE + FAB_TAB_BAR_GAP * 2;

export function ComposeFab() {
  const openComposer = useOpenComposer();
  // Inverted fill: the theme `accent` token is the foreground colour (white in
  // dark themes), which made a white icon invisible. Fill with foreground and
  // draw the icon in the background colour — high contrast in both themes.
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const insets = useScreenInsets();
  const bottom = insets.bottom + FAB_TAB_BAR_GAP;
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
    width: FAB_SIZE,
    height: FAB_SIZE,
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
