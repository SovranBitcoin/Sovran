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
