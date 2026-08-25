/**
 * Shared pill chrome for the non-glass FiatCurrencyPill variants (flat +
 * androidMenu). The variants differ only in how the currency menu opens
 * (ActionSheetIOS vs the app-wide `actionMenuPopup` host); the pressable pill
 * itself and the tap/long-press arbitration are identical.
 */

import React from 'react';
import { withAlpha } from '@/shared/lib/color';

import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

/**
 * With an external `onPress`, tap toggles sats/fiat and long-press opens the
 * currency menu; otherwise tap opens it. Mirrors `useFiatCurrencyPill`.
 */
export function fiatPillHandlers(
  enableCurrencyMenu: boolean,
  onPress: (() => void) | undefined,
  openMenu: () => void
): { primaryHandler?: () => void; longPressHandler?: () => void } {
  return {
    primaryHandler: enableCurrencyMenu && !onPress ? openMenu : onPress,
    longPressHandler: enableCurrencyMenu && onPress ? openMenu : undefined,
  };
}

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
