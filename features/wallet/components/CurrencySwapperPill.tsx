/**
 * Compact "[icon | currency name | caret]" pill used by the amount-entry
 * screen as a sat↔fiat toggle. Wraps `BalancePill` (the same chrome the
 * wallet header uses) in `ctaLabel` mode so the layout, capability
 * variants (liquid/blur/flat), and tap affordance stay consistent across
 * surfaces — only the inner copy changes.
 *
 * The pill displays the *current* input mode: "Bitcoin" while typing
 * sats, and the selected fiat currency (e.g. "US Dollar") while typing
 * fiat. Tapping swaps modes.
 *
 * Currency selection (USD/EUR/GBP) is owned by `useSettingsStore`. This
 * component only reads it.
 */
import React from 'react';

import Icon, { CurrencyIcon } from '@/assets/icons';
import BalancePill from '@/shared/ui/composed/BalancePill';
import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';

type SwapperCurrency = DisplayCurrency | 'sat';

const ICON_SIZE = 20;

// Country-flag glyphs for fiat (matches `MintCurrencyTabs.tsx`'s use of
// `circle-flags:*`) so the swapper visually echoes the same currency
// chrome used elsewhere in the app. Bitcoin uses the branded orange
// gradient disc from `CurrencyIcon` — the same component that renders
// the BTC tile on the Select Mint screen — sized to match the flags.
const CURRENCY_LABELS: Record<SwapperCurrency, string> = {
  sat: 'Bitcoin',
  usd: 'US Dollar',
  eur: 'Euro',
  gbp: 'British Pound',
};

const FIAT_FLAG_NAMES: Record<DisplayCurrency, string> = {
  usd: 'circle-flags:us',
  eur: 'circle-flags:eu',
  gbp: 'circle-flags:gb',
};

function CurrencyGlyph({ currency }: { currency: SwapperCurrency }) {
  if (currency === 'sat') {
    return <CurrencyIcon currency="sat" width={ICON_SIZE} />;
  }
  return <Icon name={FIAT_FLAG_NAMES[currency]} size={ICON_SIZE} />;
}

interface CurrencySwapperPillProps {
  /** Current input mode of the amount entry. The pill shows the
   *  currency name + icon for this mode — tap to switch to the other. */
  inputMode: 'sat' | 'fiat';
  /** Tap handler — caller flips the input mode (or whatever the swap does
   *  in their flow). */
  onPress?: () => void;
  /** Override pill width. Defaults to a compact 130. */
  width?: number;
  /** Override pill height. Defaults to 36 (smaller than the header pill
   *  so the amount-entry layout stays balanced). */
  height?: number;
}

export function CurrencySwapperPill({
  inputMode,
  onPress,
  width = 130,
  height = 36,
}: CurrencySwapperPillProps) {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const activeCurrency: SwapperCurrency = inputMode === 'sat' ? 'sat' : displayCurrency;

  return (
    <BalancePill
      // `iconBoxSize` collapses the default 32×32 wrapper down to the
      // glyph size so the icon sits snug against the left edge instead
      // of floating in a big centered box (the default suits the header
      // pill, not the compact swapper).
      iconNode={<CurrencyGlyph currency={activeCurrency} />}
      iconBoxSize={ICON_SIZE}
      iconRightSpacing={6}
      ctaLabel={CURRENCY_LABELS[activeCurrency]}
      balance={0}
      onPress={onPress}
      width={width}
      height={height}
      // Let BalanceDisplay span the full pill height so its inner
      // HStack's `align="center"` handles vertical centering at the
      // pixel level — flat/blur variants don't get SwiftUI's layout
      // engine, so a smaller `contentHeight` inside a fixed-height
      // pressable was leaving the icon + label visibly off-center.
      contentHeight={height}
    />
  );
}
