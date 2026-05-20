# Responsive scaling — the rules

Sovran ships from iPhone SE to iPad Pro. Flexbox gets you 80% of the way; the last 20% is dynamic scaling based on the actual viewport. Three pillars.

## 1. Dimensions — use the hook, not the static read

```ts
import { useWindowDimensions } from 'react-native';

const { width, height } = useWindowDimensions();
const cardWidth = width * 0.85;
```

- **Always** `useWindowDimensions()` inside render. It re-runs on rotation, split-screen, foldable hinge events, and external-display reroutes — `Dimensions.get('window')` does not.
- If you genuinely need width outside render (worklet, module scope), call `Dimensions.get('window')` *and* subscribe via `Dimensions.addEventListener('change', ...)` — never read once at module scope and treat it as constant.

## 2. Pixel-ratio scaling — for fonts, gaps, and hairline borders

```ts
import { PixelRatio } from 'react-native';

const fontSize = Math.round(14 * PixelRatio.getFontScale());      // honors OS text-size setting
const hairline = StyleSheet.hairlineWidth;                         // 1 / PixelRatio.get(), already
const tightGap = Math.round(8 / PixelRatio.get()) * PixelRatio.get(); // snap to device pixels
```

- Use `PixelRatio.getFontScale()` for typography that should respect Settings → Display → Text Size. Sovran's own `Text` primitive already opts out via `allowFontScaling={false}` for amounts (see `AmountFormatter.tsx`); deliberate, because numeric balances must not reflow. Pass `allowFontScaling={false}` for critical-width text only.
- Use `StyleSheet.hairlineWidth` for 1-physical-pixel borders. Don't write `borderWidth: 0.5`.

## 3. Flex first — `flex: 1` and `aspectRatio` over fixed dimensions

```tsx
// ✓ stretches to whatever the parent gives it; child stays square
<View style={{ flex: 1, aspectRatio: 1 }} />

// ✗ breaks on iPad / landscape / split-screen
<View style={{ width: 390, height: 390 }} />
```

- Reach for `flex: 1`, `flexBasis`, `flexGrow`, `aspectRatio` before reaching for `width`/`height`.
- Fixed dimensions are correct only when the design *intent* is fixed (avatar 32, icon 24, tab-bar height) — not when "390 happens to look right on my simulator."

## Don't

- ❌ `Dimensions.get('window').width` at module scope — captured once, never updates. See `features/splitBill/components/ParticipantCardDeck.tsx:55` for the existing offender; new code shouldn't add another.
- ❌ Hardcoded reference widths (`width: 390`, `width: 375`). If you find yourself typing one, you wanted `flex: 1` or `windowWidth * ratio`.
- ❌ `borderWidth: 0.5` — use `StyleSheet.hairlineWidth`.
- ❌ Scaling everything by `PixelRatio.get()` indiscriminately. Density scaling is for typography and 1px-borders; layout sizes already scale via flex.
