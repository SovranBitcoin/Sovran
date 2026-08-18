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

// Pill width is sized to fit just the *active* label so "Euro" doesn't carry
// the same footprint as "British Pound". The pill reflows when the user
// toggles sat ↔ fiat or picks a different `displayCurrency`.
//
//   chrome  = icon-box (ICON_SIZE) + iconRightSpacing (6)
//             + chevron (12) + chevron mr-2 (8)
//             + BalancePill HORIZONTAL_PADDING * 2 (24)
//   label   = label glyphs × bold size-14 Oxygen avg (~8 px)
//   safety  = +8 px to absorb font-metric variance across iOS/Android.
const PILL_CHROME_WIDTH = ICON_SIZE + 6 + 12 + 8 + 24;
const LABEL_GLYPH_WIDTH = 8;
const LABEL_SAFETY_PADDING = 8;

function widthForLabel(label: string): number {
  return PILL_CHROME_WIDTH + label.length * LABEL_GLYPH_WIDTH + LABEL_SAFETY_PADDING;
}

function CurrencyGlyph({ currency }: { currency: SwapperCurrency }) {
  if (currency === 'sat') {
    return <CurrencyIcon currency="sat" width={ICON_SIZE} />;
  }
  return <Icon name={FIAT_FLAG_NAMES[currency]} size={ICON_SIZE} />;
}

interface CurrencySwapperPillProps {
  /** Current input mode of the amount entry ('unit' = typing sats on the
   *  sat account). The pill shows the currency name + icon for this mode —
   *  tap to switch to the other. */
  inputMode: 'unit' | 'fiat';
  /** Tap handler — caller flips the input mode (or whatever the swap does
   *  in their flow). */
  onPress?: () => void;
  /** Override pill width. Defaults to a value sized to the active label,
   *  so the pill grows or shrinks as the user toggles currencies. */
  width?: number;
  /** Override pill height. Defaults to 36 (smaller than the header pill
   *  so the amount-entry layout stays balanced). */
  height?: number;
}

export function CurrencySwapperPill({
  inputMode,
  onPress,
  width,
  height = 36,
}: CurrencySwapperPillProps) {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const activeCurrency: SwapperCurrency = inputMode === 'unit' ? 'sat' : displayCurrency;
  const label = CURRENCY_LABELS[activeCurrency];
  const resolvedWidth = width ?? widthForLabel(label);

  return (
    <BalancePill
      // `iconBoxSize` collapses the default 32×32 wrapper down to the
      // glyph size so the icon sits snug against the left edge instead
      // of floating in a big centered box (the default suits the header
      // pill, not the compact swapper).
      iconNode={<CurrencyGlyph currency={activeCurrency} />}
      iconBoxSize={ICON_SIZE}
      iconRightSpacing={6}
      ctaLabel={label}
      balance={0}
      onPress={onPress}
      width={resolvedWidth}
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
