/**
 * The drag-handle bar shown at the top of Android sheet surfaces.
 * react-native-screens' sheetGrabberVisible is iOS-only, so Android sheets
 * draw their own. One component so the standalone-modal chrome
 * (FormSheetChrome) and the flow-sheet header (FlowSheetHeader) stay
 * pixel-identical.
 */
import { StyleSheet, View } from 'react-native';
import { withAlpha } from '@/shared/lib/color';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha, spacing } from '@/shared/styles/tokens';

export function SheetGrabber() {
  const [foreground] = useThemeColor(['foreground'] as const);
  return (
    <View style={[styles.grabber, { backgroundColor: withAlpha(foreground, alpha.disabled) }]} />
  );
}

const styles = StyleSheet.create({
  grabber: {
    alignSelf: 'center',
    width: 32,
    height: 4,
    borderRadius: 2,
    marginTop: spacing.sm,
  },
});
