import { useCallback } from 'react';
import { DisplayCurrency, useSettingsStore } from '@/shared/stores/global/settingsStore';

export interface FiatCurrencyPillProps {
  /** Display string, e.g. "≈ $12.34" */
  displayText: string;
  /** Called on a normal tap (e.g. toggle sats/fiat input mode) */
  onPress?: () => void;
  /** Optional override for currency selection side-effects */
  onSelectCurrency?: (currency: DisplayCurrency) => void;
  /** Append a small toggle glyph (e.g. "⇄") to hint tap-to-toggle behavior */
  showToggleGlyph?: boolean;
  /** Text size for both iOS + non-iOS renderers */
  textSize?: number;
  /** Enable the iOS ContextMenu for fiat currency selection (wallet UX). */
  enableCurrencyMenu?: boolean;
  /** Stable id for the tappable pill (e2e). */
  testID?: string;
  /** AX label for the tappable pill — required for the id to reach the AX tree on iOS. */
  accessibilityLabel?: string;
}

interface FiatCurrencyPillShared {
  handleSelectCurrency: (currency: DisplayCurrency) => void;
  text: string;
  iosHeight: number;
  iosWidth: number;
  onPress?: () => void;
  enableCurrencyMenu: boolean;
  /**
   * The tap/long-press arbitration, as data: with an external `onPress`, tap
   * toggles sats/fiat and long-press opens the currency menu; otherwise tap
   * opens it. Native-menu variants feed this straight into their
   * `shouldOpenOnLongPress`-style flags.
   */
  menuOpensOnLongPress: boolean;
  /** Same arbitration as handlers, for variants that own their menu opener. */
  handlersFor: (openMenu: () => void) => {
    primaryHandler?: () => void;
    longPressHandler?: () => void;
  };
  textSize: number;
  testID?: string;
  accessibilityLabel?: string;
}

export function useFiatCurrencyPill({
  displayText,
  onPress,
  onSelectCurrency,
  showToggleGlyph = false,
  textSize = 14,
  enableCurrencyMenu = true,
  testID,
  accessibilityLabel,
}: FiatCurrencyPillProps): FiatCurrencyPillShared {
  const setDisplayCurrency = useSettingsStore((state) => state.setDisplayCurrency);

  const handleSelectCurrency = useCallback(
    (currency: DisplayCurrency) => {
      if (onSelectCurrency) {
        onSelectCurrency(currency);
        return;
      }
      setDisplayCurrency(currency);
    },
    [onSelectCurrency, setDisplayCurrency]
  );

  const text = showToggleGlyph ? `${displayText}  ⇄` : displayText;
  const iosHeight = 34;
  const iosWidth = Math.max(72, Math.round(text.length * (textSize * 0.62) + 28));

  const menuOpensOnLongPress = enableCurrencyMenu && !!onPress;
  const handlersFor = (openMenu: () => void) => ({
    primaryHandler: enableCurrencyMenu && !onPress ? openMenu : onPress,
    longPressHandler: menuOpensOnLongPress ? openMenu : undefined,
  });

  return {
    handleSelectCurrency,
    text,
    iosHeight,
    iosWidth,
    onPress,
    enableCurrencyMenu,
    menuOpensOnLongPress,
    handlersFor,
    textSize,
    testID,
    accessibilityLabel,
  };
}
