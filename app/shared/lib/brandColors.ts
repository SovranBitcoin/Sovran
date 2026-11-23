/**
 * Cross-feature brand color constants — values that are NOT theme tokens
 * (they don't change between themes) but DO need a single source of truth
 * because they appear at multiple call sites and carry semantic meaning.
 *
 * For theme-aware colors, use `useThemeColor` from `@/shared/hooks/useThemeColor`.
 */

/** Apple system blue (#0A84FF). Used wherever bluetooth / BLE-mesh peer
 *  state is rendered: NetworkSheet, splitBill participant rows. */
export const BLUETOOTH_ACCENT = '#0A84FF';

/** Apple system green (#34C759). Used to indicate live/connected peer or
 *  channel state — bitchat mesh broadcast icon, BLE peer connected dots. */
export const CONNECTED_ACCENT = '#34C759';

/** Bitcoin orange (#F7931A). Used wherever a "bitcoin-accepting" or
 *  "bitcoin-denominated" semantic cue is rendered: BTCMap markers, splitBill
 *  participant pills, mint-info bitcoin glyphs. Matches `orange-300` in
 *  `themeEngine.ts`; declared here too so callers don't reach into the theme
 *  layer for a value that's identical across every theme. */
export const BITCOIN_ACCENT = '#F7931A';

/** Fixed white for theme-invariant surfaces such as QR backgrounds, bitcoin
 *  symbol cutouts, and iOS glass wash layers that must not invert by theme. */
export const INVARIANT_WHITE = '#FFFFFF';

/** Near-black base (#0F0F12) under the boot splash's QR-button look-alike
 *  layers; kept exact so the splash-to-QR-button handoff is pixel-identical. */
export const SPLASH_QR_BASE = '#0F0F12';

/** Fixed black for theme-invariant QR foregrounds. Scanners expect dark modules
 *  on a light background, so this intentionally does not follow app theme. */
export const INVARIANT_BLACK = '#000000';

/** Blue-white corona for the NearPay lightning effect — BLUETOOTH_ACCENT
 *  blended ~60% toward white. Theme-invariant: it reads as light emission
 *  (additive blend over the radar), not as a surface color. */
export const LIGHTNING_INNER_GLOW = '#9CCBFF';

/** Pale rim-light hugging the avatar circle during a lightning strike.
 *  Slightly bluer than INVARIANT_WHITE so the white bolt cores stay the
 *  brightest element in the effect. */
export const LIGHTNING_RIM = '#BFE0FF';

/** Storm-gold lightning palette — warm analog of the electric-blue set
 *  (same derivation: glow = outer blended ~60% toward white, rim ~75%).
 *  Selected via the `palette` prop on LightningStrike — pending crackle
 *  stays electric-blue; the receive celebration strikes in gold. */
export const LIGHTNING_GOLD = '#FFB300';

/** Warm pale-gold corona — LIGHTNING_GOLD analog of LIGHTNING_INNER_GLOW. */
export const LIGHTNING_GOLD_GLOW = '#FFE099';

/** Pale gold rim-light — LIGHTNING_GOLD analog of LIGHTNING_RIM. */
export const LIGHTNING_GOLD_RIM = '#FFECBF';

/** Theme-invariant dark success tint for animated frosted payment toasts. */
export const TOAST_SUCCESS_DARK_BG = '#089A2C';

/** Theme-invariant dark danger tint for animated frosted payment toasts. */
export const TOAST_DANGER_DARK_BG = '#9A082E';

/** Theme-invariant dark warning tint for animated frosted payment toasts. */
export const TOAST_WARNING_DARK_BG = '#9A6A08';

/** Layout-guide red (#FF2D55). The review overlay's lines: a colour no theme
 *  or wallpaper uses, so a guide is never mistaken for part of the design. */
export const LAYOUT_GUIDE = '#FF2D55';
