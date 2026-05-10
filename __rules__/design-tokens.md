# Design tokens — the rules

Every non-color style choice (spacing, radius, opacity, animation timing, z-index, icon size, shadow, hit slop) routes through one locked scale in `shared/styles/tokens.ts`. Colors flow through `useThemeColor` / CSS variables — see [`__rules__/dates.md`](./dates.md)-style cousin guidance for those.

```ts
import { spacing, radius, alpha, duration, zIndex, iconSize, hitSlop, shadow, minTouchTarget }
  from '@/shared/styles/tokens';
```

## Why locked

Audit found 32 distinct opacity stops, six z-index levels with no hierarchy, animation durations from 150 to 1500ms picked freeform. That's not personalisation — that's drift. A constrained scale costs one extra import and removes a class of "this looks slightly off" bugs nobody can pinpoint.

## The scales

| Token | Keys | Use for |
|---|---|---|
| `spacing` | `xs/sm/md/lg/xl/2xl/3xl/4xl` (4–48px, 4-pt grid) | `padding`, `margin`, HStack/VStack `spacing` |
| `radius` | `sm/md/lg/xl/2xl/pill` (4–20, 999) | `borderRadius` |
| `alpha` | `faint/subtle/soft/muted/disabled/strong/prominent` (0.08–0.85) | second arg to `opacity(color, …)`, `style.opacity` |
| `duration` | `instant/quick/standard/slow/deliberate/spin/loop` (100–1500ms) | Reanimated `withTiming(target, { duration })` |
| `zIndex` | `base/raised/sticky/dropdown/modal/toast/overlay` (0–9999) | `style.zIndex` |
| `iconSize` | `xs/sm/md/lg/xl/2xl/3xl` (12–48) | `<Icon size={…} />` |
| `hitSlop` | `default/generous` | `<Pressable hitSlop={…}>` |
| `minTouchTarget` | `44` | minimum height/width for any tappable target |
| `shadow` | `sm/md/lg` (cross-platform shadow + elevation pairs) | spread into `style`; pass `shadowColor` from theme |

## Don't

- ❌ Magic numbers in `style={{ ... }}`. Pick a token: `padding: spacing.lg` not `padding: 16`.
- ❌ Inventing a new opacity value because none of `faint/subtle/soft/muted/disabled/strong/prominent` quite fits. Snap to the nearest stop. **Constraining the set is the entire point.**
- ❌ A new `duration` for the same beat ("but mine is 320ms not 300"). Use `standard`. The 20ms difference is invisible; the inconsistency isn't.
- ❌ A z-index above `overlay` (9999). If you need to outrank an overlay, the overlay is wrong, not the new layer.
- ❌ Importing the `opacity` function and the `alpha` token under the same name. `import opacity from 'hex-color-opacity'` + `import { alpha } from '@/shared/styles/tokens'` — call sites read `opacity(color, alpha.muted)`.

## Exempt: art-directed multi-stop gradients

A `LinearGradient colors={[...]}` array with stops like `[opacity(c, 0.45), opacity(c, 0.1), opacity(c, 0)]` is a designer's tuning, not a token consumer. Leave those alone unless you're reworking the gradient. The rule applies to standalone single-value calls (`opacity(c, 0.57)` → `opacity(c, alpha.disabled)`).

## When to add a new value

Extend `tokens.ts` only when:
1. A genuinely new presentation is needed (a new product surface that needs its own beat / depth / scale step), AND
2. ≥ 2 surfaces will share it.

Adding a one-off because "this single screen really wants 0.45" is exactly the drift the scale exists to prevent. The rule is "snap or extend deliberately", never "snap or invent".

When you do add, pick an intent name (`alpha.placeholder`), not a number-shaped name (`alpha.fortyFive`).

## Existing call sites

Migration is incremental. The Cluster 2 rollout migrated:
- All 26 z-index sites (full coverage — small set, clean hierarchy gain).
- Standalone opacity outliers in `MetricsFooter`, `ClaimUsernameScreen`.
- All 4 spinner `duration: 1000` sites → `duration.spin`.
- 3 fade-timing outliers (180/220ms) → `duration.quick`.

Existing calls still using on-scale literals (e.g. `padding: 16`, `opacity(c, 0.5)`) work fine and aren't a regression — they just don't yet read by intent. Migrate opportunistically when you're already touching the file.
