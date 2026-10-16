import { createContext, useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { LAYOUT_GUIDE } from '@/shared/lib/brandColors';
import { useAppStyle } from '@/shared/styles/appStyle';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
const LINE = StyleSheet.hairlineWidth * 2;

/**
 * Whether the guides are switched on. Supplied by `LayoutGuidesProvider` from the
 * review setting, so this file reads no store and a surface that draws in its
 * own window (a system sheet) can mount `<LayoutGuides />` unconditionally.
 */
export const LayoutGuidesEnabled = createContext(false);

/**
 * Thin red lines where content is supposed to sit: the active style's gutter
 * on both sides, and the top and bottom safe-area edges. Drawn over the screen it is mounted in and never
 * takes a touch. Renders nothing while the guides are switched off.
 *
 * It exists for reviews. Whether a card lines up with the heading above it is
 * read off the line in a screenshot rather than estimated.
 */
export function LayoutGuides() {
  // Read with a fallback: a preview or a test may have no provider above.
  const insets = useContext(SafeAreaInsetsContext) ?? NO_INSETS;
  const { gutter } = useAppStyle().space;
  if (!useContext(LayoutGuidesEnabled)) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="layout-guides">
      <View style={[styles.vertical, { left: gutter }]} />
      <View style={[styles.vertical, { right: gutter }]} />
      {insets.top > 0 ? <View style={[styles.horizontal, { top: insets.top }]} /> : null}
      {insets.bottom > 0 ? <View style={[styles.horizontal, { bottom: insets.bottom }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  vertical: {
    backgroundColor: LAYOUT_GUIDE,
    bottom: 0,
    opacity: 0.55,
    position: 'absolute',
    top: 0,
    width: LINE,
  },
  horizontal: {
    backgroundColor: LAYOUT_GUIDE,
    height: LINE,
    left: 0,
    opacity: 0.55,
    position: 'absolute',
    right: 0,
  },
});
