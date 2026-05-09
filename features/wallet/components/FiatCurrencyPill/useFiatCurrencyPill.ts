import { useCallback } from 'react';
import { DisplayCurrency, useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

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
}

interface FiatCurrencyPillShared {
  success: string;
  green400: string;
  green500: string;
  handleSelectCurrency: (currency: DisplayCurrency) => void;
  text: string;
  iosHeight: number;
  iosWidth: number;
  onPress?: () => void;
  enableCurrencyMenu: boolean;
  textSize: number;
}

export function useFiatCurrencyPill({
  displayText,
  onPress,
  onSelectCurrency,
  showToggleGlyph = false,
  textSize = 14,
  enableCurrencyMenu = true,
}: FiatCurrencyPillProps): FiatCurrencyPillShared {
  const [success, green400, green500] = useThemeColor([
    'success',
    'green-400',
    'green-500',
  ] as const);
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

  return {
    success,
    green400,
    green500,
    handleSelectCurrency,
    text,
    iosHeight,
    iosWidth,
    onPress,
    enableCurrencyMenu,
    textSize,
  };
}
