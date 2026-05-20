# Capability variants — the rules

When a component looks different across iOS / iOS-no-glass / Android / blur / etc., pick **one** of these. Don't mix.

## 1. Capability dispatch — `defineVariants`

Use when ≥2 visual variants differ by **device capability** (liquid glass, blur, etc.).

```ts
// shared/ui/composed/CapsuleButton/index.ios.ts
export const CapsuleButton = defineVariants<CapsuleButtonProps>('CapsuleButton', {
  liquid: CapsuleButtonLiquid,   // caps.liquidGlass    → SwiftUI glass
  blur:   CapsuleButtonBlur,     // caps.frostedSurface → BlurCardFrame
  flat:   CapsuleButtonFlat,     // floor               → surfaceSecondary
});
```

- Layout: `Component/{Name}.{liquid,blur,flat}.tsx` + `index.ios.ts` (all variants) + `index.android.ts` (flat only — keeps `@expo/ui/swift-ui` off the Android bundle).
- `flat` is required (TS-enforced floor). `liquid`/`blur` are optional.
- Variant files MUST NOT include their own `<Log name>` — `defineVariants` adds it.
- For prop-gated dispatch (e.g. `liquid` is a per-call prop), use the **selector overload**: `defineVariants(name, (caps, props) => Component)`. Reserve this for axes that combine a per-call prop with a real device capability — for a pure design axis with no capability dimension, use a plain inline switch (see `SelectableCheck`). `defineVariants` always wraps in `<Log>` and runs `extractVisibleContent` on every render; that's worth paying for capability dispatch but pure overhead in a hot list-row primitive.

## 2. Inline — `useCapabilities()`

Use when a single component branches **once** on a capability (no variant files).

```ts
const { liquidGlass } = useCapabilities();
return liquidGlass ? <Liquid /> : <Flat />;
```

- Re-renders when `mockNoGlass` flips. Throws outside `<CapabilityProvider />`.
- Companion hook: `useLiquidGlassModifiers(...)` — same as `liquidGlassModifiers(...)` but render-aware.

## 3. Sync helpers — `supportsLiquidGlass()` / `supportsBlur()` / `liquidGlassModifiers()`

**Only** outside React render: module scope, worklets, event handlers without component context.

```ts
// navigation/nativeTabs.tsx — module-scope export
export const isExpo55NativeTabsSupported = () => supportsLiquidGlass();
```

These don't re-render on `mockNoGlass` toggle — that's the trade-off for being callable anywhere.

## 4. `.ios.tsx` / `.android.tsx` — genuine platform-specific implementation

Use **only** when the difference isn't a capability — it's a platform primitive that has no cross-platform equivalent. Examples in this repo: `QRButton` (heroui-native `PressableFeedback` vs RN `Pressable`), `GlassSearchBar` (per-platform layout drift). Don't reach for this when `useCapabilities()` could express the difference.

## Don't

- ❌ `Platform.OS === 'ios' && supportsLiquidGlass()` — the `Platform.OS` check is redundant; `caps.liquidGlass` is already false off-iOS.
- ❌ `<Log name>` inside a variant file when `defineVariants` already wraps.
- ❌ A `defineVariants` wrapper for a single-axis component — use inline `useCapabilities()`.
- ❌ Inventing capability axes that don't exist to force a `.ios/.android` pair through `defineVariants`. If it's not a capability, leave it as a platform-suffix file.
