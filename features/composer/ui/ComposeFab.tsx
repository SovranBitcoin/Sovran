/**
 * @fileoverview Floating "new post" button for the feed.
 *
 * The feed's only write entry point — opens the composer for a fresh post.
 */
import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';

import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { INVARIANT_BLACK, INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useTabBarBottomPadding } from '@/shared/hooks/useTabBarBottomPadding';
import { useOpenComposer } from '@/features/composer/publish/useComposerActions';

export function ComposeFab() {
  const openComposer = useOpenComposer();
  const [accent] = useThemeColor(['accent'] as const);
  // Float above the native tab bar + home indicator (no fixed bottom offset).
  const bottom = useTabBarBottomPadding(16);
  const onPress = useCallback(() => openComposer({ mode: 'new' }), [openComposer]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="New post"
      style={[styles.fab, { backgroundColor: accent, bottom }]}>
      <Icon name="mdi:pencil" size={24} color={INVARIANT_WHITE} />
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
