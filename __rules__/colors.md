# Colors — the rules

The palette is defined in `shared/lib/themeEngine.ts` and consumed via `useThemeColor(token)` (runtime string) or Tailwind utility classes (`text-foreground/60`, `bg-success`). Two layers:

- **Static color ramps** — `red-100..500`, `green-100..500`, etc. The brand reservoir.
- **Semantic tokens** — `success`, `danger`, `warning`, `foreground`, `surface-*`, etc. What components actually consume. Each semantic resolves through the theme so light/dark mode flips automatically.

## Where each ramp comes from

Every ramp is anchored on a known-good reference at the `300` step (the canonical brand color), then graduated 100→500 (near-white → ink). The anchors:

- **`green-300` → Apple System Green `#34C759`** — the universal "trustworthy positive / verified" register from iOS Wallet, Stocks, Messages. The reference for the rest of the palette's saturation profile (~58% HSL sat, LCH chroma ~63).
- **`red-300` → Tailwind red-500 `#EF4444`** — pure red at hue 0°. Apple System Red (`#FF3B30`, hue 3°) read as too orange in this palette.
- **`yellow-300` → `#E0B229`** — amber-yellow at ~hue 45° and ~75% saturation. The original Apple System Yellow (`#FFCC00`) was 100% sat and visually out-shouted the green; pure yellow doesn't desaturate gracefully (it goes mustard fast), so the ramp shifts slightly toward amber to give it room.
- **`blue-300` / `shade-300` → `#2A7AD0`** — Apple-blue hue (~212°) desaturated from the iOS `#007AFF` original to ~67% saturation so it sits next to the green without dominating. `shade-*` mirrors `blue-*` (it's the brand neutral).
- **`purple-300` → Apple System Purple `#AF52DE`**. Note: this is still at ~67% HSL sat / LCH chroma ~80 — slightly louder than the green; revisit if it visually clashes against the new blue/yellow.
- **`orange-300` → Bitcoin Orange `#F7931A`** — culturally non-negotiable for a Bitcoin/Cashu wallet. **Do not swap to Apple System Orange.**

The rules:

- **Pick a known-good anchor** — Apple System for warm semantics, Tailwind for cool, Bitcoin for orange.
- **Match the green's chroma profile** (~LCH C=60–70). The green is the most-used semantic in the app (every success state); louder accents next to it visually compete and look bad. If you're tempted to use a 100%-sat ramp value at the `300` step, dial it down first.
- **Keep saturation in a 55–75% HSL band** — never neon, never washed out. Hue held constant within each ramp (the old purple ramp drifted blue-violet → red-violet mid-scale; don't regress).

## Picking a color

1. **Need "success" / "danger" / "warning" / "foreground" semantics?** Use the semantic token. `useThemeColor('success')` or Tailwind `text-success`. **Never hardcode `#34C759`** — the semantic adapts to theme; the hex doesn't.
2. **Need a specific brand tint** (e.g. social/identity stat color)? Use a static ramp token: `useThemeColor('blue-300')`. Same applies to `green-200` for badge backgrounds, etc.
3. **Need a one-off accent** that doesn't fit either? Stop and think — most "one-offs" should be a new semantic if they're going to recur. If it's truly one-off, document the choice inline (as `STAT_COLOR_SOCIAL` does in `RowStatsAccent.tsx`).

## Foreground variants on light vs dark

`--success-foreground`, `--danger-foreground`, `--warning-foreground` automatically pick the right contrast pair for the current theme:

- **On dark backgrounds** → the ramp's `200` (pastel) for high-contrast pastel text/icon
- **On light backgrounds** → the ramp's `500` (ink) for AA-safe text

When you need success/error TEXT on top of a tinted surface, reach for `text-success-foreground` / `text-danger-foreground`, not the base `text-success`. Base success is for fills/icons; foreground is for ink that has to read on top of a contrasting surface.

## Don't

- ❌ Hardcode hex values in components. The single exception is when the surface itself is theme-invariant (e.g. `ToastSlab`'s `SUCCESS_DARK_BG = '#089A2C'` for a fixed-dark toast over a fixed-white background). Document it inline.
- ❌ Reach for raw Tailwind color classes (`text-red-500`, `bg-blue-600`). Use the semantic (`text-danger`) or the project ramp (`text-red-300`) — Tailwind's red-500 and the project's `red-300` happen to be the same hex today, but the project ramp is what stays in sync if the design system shifts.
- ❌ Add a new semantic token without updating both `themeEngine.ts` (the value) **and** `useThemeColor.ts` (the type union). The type guards future callsites; without it the new token compiles but isn't discoverable.
- ❌ Re-introduce neon. If a saturation is above ~80%, it's in the highlighter zone — finance UIs read this as childish. The ramp tops out at the System / Tailwind anchors for a reason.
- ❌ Pull `green-400` (or any `400`) for a primary success surface. The `300` is the canonical anchor; `400` is for emphasis/depth.
