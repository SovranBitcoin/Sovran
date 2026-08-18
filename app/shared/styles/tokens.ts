/**
 * Design tokens — the locked scales every non-color style choice routes
 * through.
 *
 * **Why locked.** Audit found 32 distinct opacity values, six different
 * z-index levels with no hierarchy, animation durations from 150 to 1500ms
 * picked freeform, and border-radius values 4/6/8/10/12/14/16/18/20 all in
 * use. That's not personalisation — that's drift. A constrained scale costs
 * one extra import per style and removes a class of "this looks slightly
 * off" bugs that nobody can pinpoint.
 *
 * **Why intent names.** Where a value has obvious meaning, the export uses
 * that meaning directly (`opacity.muted`, `duration.quick`, `zIndex.modal`)
 * rather than a number-shaped key. The point is that callers think about
 * what they want, not what number to type. Where the dimension is itself a
 * size (spacing, radius, icon size), t-shirt keys map to the underlying
 * scale step.
 *
 * **What's NOT here.** Colors. Those flow through `useThemeColor` and
 * `--color-*` CSS variables — they have to be runtime-resolvable so dark/
 * light/wallpaper switches take effect. These tokens are static module
 * constants baked into the bundle.
 *
 * See `skills/sovran-ui/references/design-tokens.md` for usage guidance.
 */

import { Platform, type ViewStyle } from 'react-native';

// ─── Spacing ──────────────────────────────────────────────────────────────
// 4-pt grid. Used for `padding`, `margin`, and HStack/VStack `spacing` props.
// Outliers from the audit (6, 10, 14, 18, 40) all snap cleanly to a step.

export const spacing = {
  /** 4px — minimal gap between adjacent inline elements (icon + label). */
  xs: 4,
  /** 8px — tight padding inside compact UI (chips, badges). */
  sm: 8,
  /** 12px — default row padding, chip/button internal spacing. */
  md: 12,
  /** 16px — standard screen edge padding, card internal padding. */
  lg: 16,
  /** 20px — generous gap between sections within a card. */
  xl: 20,
  /** 24px — section breathing room. */
  '2xl': 24,
  /** 32px — separator between distinct page regions. */
  '3xl': 32,
  /** 48px — full-screen empty-state and large vertical padding. */
  '4xl': 48,
} as const;

// ─── Border radius ────────────────────────────────────────────────────────
// Outliers (6, 10, 14, 18) snap to nearest scale step. Use `pill` for fully
// rounded buttons / circles instead of `borderRadius: 999` magic number.

export const radius = {
  /** 4px — input fields, small chips. */
  sm: 4,
  /** 8px — secondary buttons, list rows. */
  md: 8,
  /** 12px — cards, primary buttons. */
  lg: 12,
  /** 16px — large cards, sheets. */
  xl: 16,
  /** 20px — hero cards, profile cards. */
  '2xl': 20,
  /** Fully rounded — circles, pill buttons, avatars. */
  pill: 999,
} as const;

// ─── Alpha (opacity values) ───────────────────────────────────────────────
// The big consolidation. Audit found 32 unique stops in `opacity(color, x)`
// calls; this scale collapses them to seven intent-named tokens. Named
// `alpha` (not `opacity`) to avoid collision with the `hex-color-opacity`
// package's `opacity()` function — reads naturally as
// `opacity(themeColor, alpha.muted)` or `style={{ opacity: alpha.disabled }}`.

export const alpha = {
  /** 0.08 — barely-there separators, divider lines on dark surfaces. */
  faint: 0.08,
  /** 0.15 — subtle borders, subtle background tints. */
  subtle: 0.15,
  /** 0.25 — soft chip / pill backgrounds, dim icon. */
  soft: 0.25,
  /** 0.4 — muted secondary text, dim icon labels. */
  muted: 0.4,
  /** 0.5 — disabled state for any interactive element. */
  disabled: 0.5,
  /** 0.66 — strong but not solid (semi-prominent secondary text). */
  strong: 0.66,
  /** 0.85 — almost solid (overlay text, modal scrim contents). */
  prominent: 0.85,
} as const;

// ─── Animation timing ─────────────────────────────────────────────────────
// In milliseconds. Pass to Reanimated's `withTiming(target, { duration })`.
// Outliers (150, 180, 220, 350, 600, 1000) all map to one of these.

export const duration = {
  /** 100ms — fastest perceptible UI feedback (haptic, micro-press). */
  instant: 100,
  /** 200ms — tap feedback, hover, opacity flips. */
  quick: 200,
  /** 300ms — default for layout / property transitions. */
  standard: 300,
  /** 500ms — modal slide-in, sheet present. */
  slow: 500,
  /** 800ms — multi-step success animations (the "bloom" beat). */
  deliberate: 800,
  /** 1000ms — brisk full rotation for active spinners (loading icons). */
  spin: 1000,
  /** 1500ms — slow full rotation for ambient spinners and breathing loops. */
  loop: 1500,
} as const;

// ─── Z-index hierarchy ───────────────────────────────────────────────────
// Replaces the freeform 1 / 10 / 50 / 99 / 1000 / 9999 sprawl with a
// hierarchy that documents INTENT. If a new layer is needed, pick the next
// gap (e.g. `dropdown + 1`) and add a token here, don't pick a magic number.

export const zIndex = {
  /** 0 — default document flow. */
  base: 0,
  /** 1 — slightly raised above siblings (visual layering). */
  raised: 1,
  /** 10 — sticky headers, anchor pills, tab bars. */
  sticky: 10,
  /** 100 — dropdowns, popovers, tooltips. */
  dropdown: 100,
  /** 1000 — modals, sheets (gorhom BottomSheet's host layer). */
  modal: 1000,
  /** 2000 — toasts, popups that float above modals. */
  toast: 2000,
  /** 9999 — full-screen overlays, hero transitions, debug overlays. */
  overlay: 9999,
} as const;

// ─── Icon size ────────────────────────────────────────────────────────────
// For `<Icon size={...} />`. The audit found 20+ unique sizes in use; this
// scale covers every meaningful tier without tempting another off-grid pick.

export const iconSize = {
  /** 12px — inline icons in dense rows (timestamps, metadata). */
  xs: 12,
  /** 14px — secondary action chips, stat pills. */
  sm: 14,
  /** 16px — DEFAULT. Body-line icons, button glyphs. */
  md: 16,
  /** 20px — primary action buttons, list-row leading icons. */
  lg: 20,
  /** 24px — header buttons, navigation icons. */
  xl: 24,
  /** 32px — empty-state glyphs, large feature icons. */
  '2xl': 32,
  /** 48px — hero glyphs, full-screen empty states. */
  '3xl': 48,
} as const;

// ─── Hit slop / minimum touch target ─────────────────────────────────────
// Apple HIG and Material both recommend ≥ 44pt. Anything smaller needs
// explicit hit slop to remain accessible.

export const hitSlop = {
  /** Default 8px on all sides — for buttons and chips already ≥ 36pt. */
  default: { top: 8, bottom: 8, left: 8, right: 8 },
  /** 12px — for genuinely small icons (e.g. `iconSize.sm`). */
  generous: { top: 12, bottom: 12, left: 12, right: 12 },
} as const;

/** Minimum interactive element height. iOS HIG: 44pt. Material: 48pt.
 *  Use 44 by default; bump to 48 only when the parent has dense vertical
 *  packing that hides the difference. */
const minTouchTarget = 44;

// ─── Shadows ──────────────────────────────────────────────────────────────
// Cross-platform pairs: iOS shadow* props + Android elevation. Apply with
// the spread operator: `style={[{ ...shadow.md, shadowColor: foreground }, …]}`.
// Color is intentionally NOT baked in — pass it from the call site so it
// adapts to theme.

type Shadow = Pick<ViewStyle, 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'>;

export const shadow: Record<'sm' | 'md' | 'lg', Shadow> = {
  /** Subtle card lift. */
  sm: Platform.select({
    ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2 },
    default: { elevation: 2 },
  }),
  /** Standard popover / floating button. */
  md: Platform.select({
    ios: { shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6 },
    default: { elevation: 5 },
  }),
  /** Modals, sheets, top-level overlays. */
  lg: Platform.select({
    ios: { shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 16 },
    default: { elevation: 12 },
  }),
};

// ─── Typography scale ─────────────────────────────────────────────────────
// One scale for label/text sizing so visual hierarchy is consistent across
// screens. Map to the nearest step instead of inventing sizes:
//   xs  — badges, tiny counters ("CURRENT", filter count)
//   sm  — captions, list subtitles, empty-state subtitles
//   md  — body text, secondary button labels
//   lg  — primary button labels, list titles, inputs
//   xl  — screen/header titles
//   2xl — large card titles (map stats)
// Keypads and balance displays are display-scale and stay bespoke.

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 14,
  lg: 16,
  xl: 17,
  '2xl': 18,
} as const;

// ─── Control heights ──────────────────────────────────────────────────────
// Interactive-element height scale. `base` matches minTouchTarget (44pt,
// Apple HIG); `cta` is the Material-density footer button; `fab` is the
// circular action button tier.

export const controlHeight = {
  compact: 36,
  base: 44,
  cta: 48,
  fab: 52,
} as const;

/**
 * Header icon-button diameter — the "mint-selector chrome" contract: every
 * headerLeft/headerRight control is a surface-secondary circle with a 1px
 * `opacity(muted, 0.3)` border, sized to match the wallet mint selector
 * (HEADER_LAYOUT.BUTTON_HEIGHT, 54) on Android. iOS native nav bars cap
 * custom views at ~44pt, so iOS keeps the 44 diameter (border still applies).
 */
export const headerButtonSize = Platform.select({ android: 54, default: minTouchTarget });
