/**
 * Header chrome for the standalone modal routes that present as native
 * Android formSheets (config/modalScreens.ts ANDROID_SHEET_OPTIONS).
 * react-native-screens renders no native header inside an Android formSheet
 * (RNS #2657, unfixed through 4.x), and sheetGrabberVisible is iOS-only —
 * so on Android this draws the grabber bar + centered title + close button
 * the native header would have provided. On iOS it renders children
 * untouched (the blurred native header is already there).
 *
 * Apply in the standalone ROUTE files only (app/sendToken.tsx etc.), not in
 * screen components — the same screens are pushed inside flow stacks where
 * the native header exists.
 */
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha, minTouchTarget, spacing } from '@/shared/styles/tokens';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';

interface FormSheetChromeProps {
  title?: string;
  children: React.ReactNode;
}

function AndroidFormSheetChrome({ title, children }: FormSheetChromeProps) {
  const [foreground] = useThemeColor(['foreground'] as const);
  return (
    <View style={styles.container}>
      <View style={[styles.grabber, { backgroundColor: opacity(foreground, alpha.disabled) }]} />
      <HStack align="center" style={styles.titleRow}>
        <ScreenHeaderAction
          icon="material-symbols:close-rounded"
          color={foreground}
          onPress={() => router.back()}
        />
        <Text bold size={17} style={styles.title} numberOfLines={1}>
          {title ?? ''}
        </Text>
        {/* Balances the close button so the title stays visually centered. */}
        <View style={styles.titleSpacer} />
      </HStack>
      {children}
    </View>
  );
}

export function FormSheetChrome({ title, children }: FormSheetChromeProps) {
  if (Platform.OS !== 'android') return <>{children}</>;
  return <AndroidFormSheetChrome title={title}>{children}</AndroidFormSheetChrome>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  grabber: {
    alignSelf: 'center',
    width: 32,
    height: 4,
    borderRadius: 2,
    marginTop: spacing.sm,
  },
  titleRow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
  titleSpacer: { width: minTouchTarget },
});
