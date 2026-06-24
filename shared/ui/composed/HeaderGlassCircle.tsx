import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Host, Button as SwiftUIButton } from '@expo/ui/swift-ui';
import { environment, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';

import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { headerButtonSize, zIndex } from '@/shared/styles/tokens';

/**
 * App-owned liquid-glass circle for native-header buttons (iOS 26+).
 *
 * Why not the system's shared bar-item background: UIKit sizes that capsule
 * to its own bar metrics — shorter than `headerButtonSize` and stretched to
 * the content's width, so headerLeft/headerRight read as squat pills that
 * don't match the mint selector's glass. This wraps arbitrary RN children
 * (monicon glyphs, SF symbols, badges) in the same `glassEffect` material
 * the BalancePill/CircleActionButton liquid variants use, at a fixed
 * `headerButtonSize` circle — one glass language everywhere. The system
 * capsule is suppressed via the native-stack `hidesSharedBackground` patch.
 *
 * Same RN-content-inside-SwiftUIButton pattern as BalancePill.liquid.
 */
export function HeaderGlassCircle({
  onPress,
  disabled = false,
  children,
  testID,
  accessibilityLabel,
}: {
  onPress?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const colorScheme = useColorScheme();
  const size = headerButtonSize;
  const interactive = !!onPress && !disabled;
  const containerStyle = [styles.box, { opacity: disabled ? 0.4 : 1 }];

  const buttonModifiers = [
    environment('colorScheme', colorScheme),
    frame({ height: size, width: size, alignment: 'center' as const }),
    glassEffect({
      shape: 'circle' as const,
      glass: { variant: 'regular' as const, interactive },
    }),
  ];

  return (
    <View
      style={containerStyle}
      testID={testID}
      accessible={!!accessibilityLabel}
      accessibilityRole={onPress ? 'button' : accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}>
      {/* No matchContents: SwiftUI ideal-size measurement can report
          fractional widths that nudge UIKit's bar-item math; the host is
          a fixed headerButtonSize square. */}
      <Host style={styles.host}>
        <SwiftUIButton modifiers={buttonModifiers} onPress={interactive ? onPress : undefined}>
          <View style={styles.content}>{children}</View>
        </SwiftUIButton>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    height: headerButtonSize,
    justifyContent: 'center',
    width: headerButtonSize,
  },
  content: {
    alignItems: 'center',
    height: headerButtonSize,
    justifyContent: 'center',
    width: headerButtonSize,
  },
  host: {
    height: headerButtonSize,
    width: headerButtonSize,
    zIndex: zIndex.sticky,
  },
});
