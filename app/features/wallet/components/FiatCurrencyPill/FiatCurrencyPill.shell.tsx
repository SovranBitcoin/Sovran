/**
 * Shared pill chrome for the non-glass FiatCurrencyPill variants (flat +
 * androidMenu). The variants differ only in how the currency menu opens
 * (ActionSheetIOS vs the app-wide `actionMenuPopup` host); the pressable pill
 * itself is identical, and the tap/long-press arbitration comes from
 * `useFiatCurrencyPill`.
 */

import React from 'react';
import { withAlpha } from '@/shared/lib/color';

import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';

const BARE_HIT_SLOP = { top: 12, bottom: 12, left: 24, right: 24 };

interface FiatPillShellProps {
  text: string;
  textSize: number;
  iosHeight: number;
  testID?: string;
  accessibilityLabel?: string;
  primaryHandler?: () => void;
  longPressHandler?: () => void;
}

export function FiatPillShell({
  text,
  textSize,
  iosHeight,
  testID,
  accessibilityLabel,
  primaryHandler,
  longPressHandler,
}: FiatPillShellProps): React.ReactElement {
  const [textColor, surfaceSecondary, muted] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
  ] as const);
  const paint = useStylePaint();
  // Outside the glass style the conversion is a line of secondary type under
  // the balance, not a second pill: the figure above it is the only object
  // with weight. `hitSlop` keeps the tap target at 48 around the bare text.
  if (paint.style.surface !== 'glass') {
    return (
      <Pressable
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        disabled={!primaryHandler && !longPressHandler}
        hitSlop={BARE_HIT_SLOP}
        onPress={primaryHandler}
        onLongPress={longPressHandler}>
        <Text size={16} family={paint.style.type.family} color={paint.text.secondary}>
          {text}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      // The liquid tier renders a UIKit UIButton, which is announced as a
      // button natively; this fallback had the label but never the role.
      accessibilityRole="button"
      disabled={!primaryHandler && !longPressHandler}
      onPress={primaryHandler}
      onLongPress={longPressHandler}>
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="overflow-hidden rounded-full"
        style={{
          // The approved flat contract (CircleActionButton/BalancePill recipe);
          // these sit over the same wallet wallpaper as those buttons do.
          backgroundColor: surfaceSecondary,
          borderWidth: 1,
          borderColor: withAlpha(muted, 0.3),
          paddingHorizontal: 14,
          paddingVertical: 6,
          minHeight: iosHeight,
        }}>
        <Text overpass size={textSize} bold color={textColor} style={{ letterSpacing: 0.3 }}>
          {text}
        </Text>
      </HStack>
    </Pressable>
  );
}
