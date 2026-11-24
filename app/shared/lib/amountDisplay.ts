import type { AmountValue } from 'wallet/amount';

import { formatAmount } from '@/shared/lib/currency';

// Fiat amounts already include their symbol (e.g. "$1,234.56"); only sats
// modes need decoration. Mode 2 is already suffixed by formatAmount.
//
// The ⚡︎ uses U+FE0E (VS15) to request the text-presentation glyph — without
// it, some OSes render the emoji-color variant which doesn't extract to a
// vector path inside the glass surface.
// U+2009 thin space sits ~\u00BD the width of a regular space and reads as the
// natural gap between a currency glyph and the digits it labels. Mirrored in
// FiatAmountDisplay so toggling fiat \u2194 sat keeps the symbol cadence identical.
function decorateSats(formatted: string, unit: string, displayBtc: number): string {
  if (unit !== 'sat') return formatted;
  if (displayBtc === 0 || displayBtc === 3) return `\u20BF\u2009${formatted}`;
  if (displayBtc === 1) return `${formatted}\u2009\u26A1\uFE0E`;
  return formatted;
}

/** An amount as the app shows it: the person's BTC/sats preference and its unit glyph. */
export function formatDisplayAmount(amount: AmountValue, unit: string, displayBtc: number): string {
  return decorateSats(
    formatAmount({ amount, unit }, { useUserPreference: true, displayPreference: displayBtc }),
    unit,
    displayBtc
  );
}
