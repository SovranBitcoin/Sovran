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

/** Reply/comment accent (#3B9EFF). Fixed cross-theme blue used to highlight
 *  the comment icon when the viewer has replied to a post — a sibling to the
 *  fixed pink "like" accent (so the cue reads the same on every theme, unlike
 *  the theme-derived `link` token which can render greyish). */
export const COMMENT_ACCENT = '#3B9EFF';

/** Bitcoin orange (#F7931A). Used wherever a "bitcoin-accepting" or
 *  "bitcoin-denominated" semantic cue is rendered: BTCMap markers, splitBill
 *  participant pills, mint-info bitcoin glyphs. Matches `orange-300` in
 *  `themeEngine.ts`; declared here too so callers don't reach into the theme
 *  layer for a value that's identical across every theme. */
export const BITCOIN_ACCENT = '#F7931A';

/** Fixed white for theme-invariant surfaces such as QR backgrounds, bitcoin
 *  symbol cutouts, and iOS glass wash layers that must not invert by theme. */
export const INVARIANT_WHITE = '#FFFFFF';

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

/** Fixed pink "like" accent (#ff5a7a). Used wherever a liked/favourited cue is
 *  rendered cross-theme (feed MetricsFooter, image-overlay BottomPanel) so the
 *  cue reads identically on every theme — sibling to COMMENT_ACCENT. */
export const LIKE_ACCENT = '#ff5a7a';

/** Amber/gold accent (#f59e0b, Tailwind amber-500). Fixed cross-theme warning
 *  and highlight colour: routing-warning text/icon (SettingsRoutingScreen) and
 *  the hero-transition gold highlight. */
export const AMBER_ACCENT = '#f59e0b';

/** Theme-invariant dark gradient shown as a wallpaper preview placeholder
 *  before (or in place of) a resolved palette. Used by UnitPreviewCard and
 *  WallpaperThumbnail for the `palette[shade] || …` fallback and the solid
 *  loading background (`.d800`). */
export const WALLPAPER_PLACEHOLDER = {
  d800: '#1a1a1a',
  d900: '#0d0d0d',
  d950: INVARIANT_BLACK,
} as const;
