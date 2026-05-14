# Icons — the rules

Every glyph in the app renders through `<Icon name="prefix:name" />` from `assets/icons` (the wrapper around `@monicon/native`). Two namespaces:

- **Iconify** (`mdi:`, `fluent:`, `lucide:`, `material-symbols:`, …) — fetched from the Iconify API and bundled into `.monicon/icons.js`.
- **`internal:`** — brand and product-specific glyphs authored in `assets/icons/internal/*.svg` and bundled by the same script.

## Adding a glyph

1. **Prefer an existing icon.** Search the `icons` array in `assets/icons/index.tsx` first. Then search [iconify.design](https://iconify.design). Only author a custom SVG when no Iconify glyph fits the brand.
2. **For an Iconify glyph** — add the name (e.g. `'lucide:square-pen'`) to the `icons` array in `assets/icons/index.tsx`, then run `node scripts/regenerate-icons.js`.
3. **For a brand/`internal:` glyph** — drop a `<svg viewBox="0 0 W H">…</svg>` file into `assets/icons/internal/<name>.svg` (paths must use `fill="currentColor"` so the runtime `color` prop flows through), then run `node scripts/regenerate-icons.js`. Reference it as `<Icon name="internal:<name>" />`. The script auto-discovers files in that directory; no parallel allowlist to maintain. See `assets/icons/internal/README.md` for authoring details.

## Don't

- ❌ Hand-rolling a `react-native-svg` component for a one-off icon. Extend the `internal:` namespace instead — the glyph then participates in theming, sizing, and the Monicon registry like every other icon.
- ❌ Importing `@monicon/native` directly. Always use `<Icon />` from `assets/icons` — it threads theme color and sizing.
- ❌ Adding `internal:*` entries to the `icons` array in `assets/icons/index.tsx`. Disk presence in `assets/icons/internal/` is the source of truth; the array is for Iconify names only.

## When a custom SVG component is genuinely the right answer

Some glyphs can't fit the registry's flat-string body format and stay as `react-native-svg` components:

- **Multi-color or gradient icons** (e.g. the currency icons in `assets/icons/index.tsx` — `CurrencyIcon`, `BitcoinMaskIcon`, `LightningUnit`). Their `LinearGradient` and multi-`<Path>` composition can't be encoded as a single colorable shape.

If you're tempted to add a second entry to that list, ask whether the gradient is actually load-bearing — most "special" glyphs are just a single shape that fits the registry fine.

## Animated status indicators

For any "loading → success / error / reverted" indicator (spinners that resolve into a checkmark, cross, or revert arrow), use `LoadingIndicator` from `shared/blocks/status` — see [`status-indicators.md`](./status-indicators.md). Do not author a new `react-native-svg` spinner with stroke-dasharray; there is exactly one canonical animated status surface.

## Selection checkmarks

For "is this option selected?" UI (split-bill participant picker, mint-add list, onboarding option lists), use `SelectableCheck` from `shared/ui/primitives/SelectableCheck`. Don't introduce a new custom checkmark glyph — the variant primitive already covers the circle (in-app accent) and square (native-feeling) styles.
