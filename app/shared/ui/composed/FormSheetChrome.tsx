/**
 * Header chrome for the standalone modal routes that present as native
 * Android formSheets (config/modalScreens.ts ANDROID_SHEET_OPTIONS).
 * react-native-screens renders no native header inside an Android formSheet
 * (RNS #2657, unfixed through 4.x), and sheetGrabberVisible is iOS-only —
 * so on Android this draws the grabber bar + centered title + close button
 * the native header would have provided. On iOS it renders children
 * untouched (the blurred native header is already there).
 *
 * Layout mirrors FlowSheetHeader: the chrome is an absolute OVERLAY with the
 * eased AndroidHeaderScrim behind it (solid through the title row, fade tail
 * below the bar), and children fill the sheet from the very top.
 * AndroidSheetRoot publishes FLOW_SHEET_HEADER_HEIGHT through
 * SheetHeaderHeightContext, so composed Screen/ModalLayoutWrapper children
 * auto-inset below the bar and their content scrolls UNDER the fade — same
 * treatment as the flow sheets. Screens not using the composed Screen must
 * inset themselves by FLOW_SHEET_HEADER_HEIGHT.
 *
 * Apply in the standalone ROUTE files only (app/sendToken.tsx etc.), not in
 * screen components — the same screens are pushed inside flow stacks where
 * the native header exists.
 */
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { headerButtonSize, spacing, fontSize } from '@/shared/styles/tokens';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { SheetGrabber } from '@/shared/ui/composed/SheetGrabber';
import { AndroidSheetRoot } from '@/shared/ui/composed/AndroidSheetRoot';
import { AndroidHeaderScrim } from '@/shared/ui/composed/AndroidHeaderScrim';
import { FLOW_SHEET_HEADER_HEIGHT, SCRIM_TOTAL_HEIGHT } from '@/shared/ui/composed/FlowSheetHeader';

interface FormSheetChromeProps {
  title?: string;
  children: React.ReactNode;
  /** Page background the scrim fades from — only needed when the hosted
   *  screen overrides its bgColor away from the theme background. */
  scrimColor?: string;
}

function AndroidFormSheetChrome({ title, children, scrimColor }: FormSheetChromeProps) {
  const background = useThemeColor('background');
  return (
    // AndroidSheetRoot pins the sheet to exact full height — RNS single-detent
    // sheets otherwise size to content (variable top gap) — and publishes the
    // chrome height so composed Screens inset + scroll under the fade.
    <AndroidSheetRoot headerHeight={FLOW_SHEET_HEADER_HEIGHT}>
      <View style={styles.container}>
        {children}
        <View style={styles.chrome} pointerEvents="box-none">
          <View style={styles.scrimLayer} pointerEvents="none">
            <AndroidHeaderScrim
              backgroundColor={scrimColor ?? background}
              height={SCRIM_TOTAL_HEIGHT}
              anchor={FLOW_SHEET_HEADER_HEIGHT / SCRIM_TOTAL_HEIGHT - 0.1}
            />
          </View>
          <SheetGrabber />
          <HStack align="center" style={styles.titleRow}>
            <ScreenHeaderAction
              icon="material-symbols:close-rounded"
              onPress={() => router.back()}
            />
            <Text bold size={fontSize.xl} style={styles.title} numberOfLines={1}>
              {title ?? ''}
            </Text>
            {/* Balances the close button so the title stays visually centered. */}
            <View style={styles.titleSpacer} />
          </HStack>
        </View>
      </View>
    </AndroidSheetRoot>
  );
}

export function FormSheetChrome({ title, children, scrimColor }: FormSheetChromeProps) {
  if (Platform.OS !== 'android') return <>{children}</>;
  return (
    <AndroidFormSheetChrome title={title} scrimColor={scrimColor}>
      {children}
    </AndroidFormSheetChrome>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Absolute overlay — children fill the sheet from the top and scroll under
  // this bar (they inset via SheetHeaderHeightContext). box-none so the close
  // button stays tappable while empty chrome regions pass touches through.
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: FLOW_SHEET_HEADER_HEIGHT,
  },
  // Taller than the chrome (fade tail below the bar) — overflow stays
  // default-visible; pointerEvents none so the tail can't eat touches.
  scrimLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCRIM_TOTAL_HEIGHT,
  },
  titleRow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
  titleSpacer: { width: headerButtonSize },
});
