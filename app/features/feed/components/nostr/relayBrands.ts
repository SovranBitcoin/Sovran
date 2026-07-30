/**
 * Brand registry for known relay software, keyed on the NIP-11 `software`
 * URL. Gives a recognized implementation (e.g. Block's Buzz) its product
 * accent on the feed's RelayCard; unknown software renders the neutral
 * themed card. Feature-scoped — promote to `shared/` only when a second
 * consumer appears.
 */
import { BUZZ_ACCENT, BUZZ_INK } from '@/shared/lib/brandColors';

interface RelayBrand {
  /** Product name shown in the brand pill (e.g. "Buzz"). */
  label: string;
  /** Brand accent hex — pill background + card border tint. */
  accent: string;
  /** Readable-on-accent text hex for the pill label. */
  ink: string;
}

/** Keys are normalized (lowercased, trailing-slash-stripped) `software` URLs. */
const RELAY_BRANDS: Record<string, RelayBrand> = {
  'https://github.com/block/buzz': { label: 'Buzz', accent: BUZZ_ACCENT, ink: BUZZ_INK },
};

export function relayBrandForSoftware(software: string | undefined): RelayBrand | undefined {
  if (!software) return undefined;
  return RELAY_BRANDS[software.trim().replace(/\/+$/, '').toLowerCase()];
}
