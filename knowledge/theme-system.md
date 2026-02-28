# Theme System

Sovran uses a single-source-of-truth theme system built on **HeroUI Native** semantic tokens, powered at runtime by **Uniwind** (Tailwind CSS v4 for React Native). This document explains every layer, how they connect, and how to work with themes.

---

## Architecture Overview

```
themes.ts                       40+ palettes (typed 0-950 shade records)
    │
    ▼
helper/themeEngine.ts           Maps each palette → HeroUI semantic CSS vars
    │                           Also registers static color scales + wallpaper vars
    ▼
providers/ThemeProvider.tsx      React context. Calls Uniwind.updateCSSVariables()
    │                           when the selected theme changes.
    ▼
heroui-native/styles            Imported in global.css. Reads the semantic vars
    │                           (--background, --surface, --accent, …) and auto-
    │                           generates Tailwind tokens (--color-background, etc.)
    ▼
Components                      Use Tailwind classes: bg-background, text-foreground,
                                bg-surface-secondary, text-muted, text-danger, …
                                Or useThemeColor('danger') for runtime hex.
```

---

## Key Files

| File | Role |
|------|------|
| `themes.ts` | Defines every theme as a `ThemePalette` (shade 0-950 → hex). Exports typed `THEMES`, `THEME_NAMES`, `ThemeName`. |
| `helper/themeEngine.ts` | The **single theme engine**. `getThemeVariables(name)` returns all CSS variables: semantic tokens, static color scales, and wallpaper vars. Pre-computes all themes at import time via `themeVariables`. Also contains `STATIC_COLOR_VALUES` — the single source of truth for all static hex values. |
| `providers/ThemeProvider.tsx` | Thin React context. Reads theme from `settingsStore`, calls `Uniwind.updateCSSVariables()`. Exposes `currentTheme`, `setTheme()`, `availableThemes`. |
| `global.css` | Imports `tailwindcss`, `uniwind`, and `heroui-native/styles`. Maps static color scales via `var()` references so Tailwind can generate utility classes. |
| `tailwind.config.js` | Extends Tailwind with wallpaper-only colors (`dominant`, `gradient`). All other colors come from HeroUI's auto-generated tokens or `global.css @theme`. |
| `hooks/useThemeColor.ts` | **The single hook for all runtime color access.** Resolves any color token — semantic or static scale — from Uniwind's CSS variable store. Supports single and array (batch) forms. |
| `config/backgroundImageThemes.ts` | Auto-generated (via `npm run build:themes`). Maps wallpaper theme names to image assets, dominant colors, and gradient colors. |
| `stores/settingsStore.ts` | Zustand store persisted to AsyncStorage. Holds the `theme` string (global, not profile-scoped). |
| `metro.config.js` | Applies `withUniwindConfig` wrapping with `cssEntryFile: './global.css'`. |

---

## How Theme Selection Works

1. **User picks a theme** in `app/settings-pages/theme.tsx`.
2. `useTheme().setTheme('navy')` is called.
3. `ThemeProvider` validates the name exists in `THEMES`, updates local state, and persists via `settingsStore.setTheme()`.
4. A `useEffect` fires, looks up pre-computed vars from `themeVariables['navy']`, and calls:
   ```ts
   Uniwind.updateCSSVariables('light', vars);
   Uniwind.updateCSSVariables('dark', vars);
   ```
5. Uniwind writes these CSS variables into its runtime store. HeroUI Native's imported styles (`heroui-native/styles` in `global.css`) reference `var(--background)`, `var(--surface)`, etc. and generate corresponding `--color-*` Tailwind tokens.
6. All components using `bg-background`, `text-foreground`, `bg-surface-secondary`, etc. reactively pick up the new values.

Both the `'light'` and `'dark'` adaptive roots are updated simultaneously so variables resolve regardless of the system color scheme.

---

## The Theme Engine (`helper/themeEngine.ts`)

This is the **only place** where palette shades are mapped to semantic meaning and where static color hex values are declared. Everything flows from here into Uniwind's runtime store.

### Palette → Semantic mapping

The function `buildSemanticVars(palette)` converts a 0-950 palette into HeroUI variables:

| Palette Shade | Semantic Variable | Typical Use |
|---------------|------------------|-------------|
| `950` | `--background` | App background (darkest for dark themes) |
| `900` | `--surface` | Card / section background |
| `800` | `--surface-secondary`, `--overlay`, `--default`, `--field-background` | Elevated surfaces, modals, input fields |
| `700` | `--surface-tertiary`, `--separator` | Tertiary surfaces, dividers |
| `500` | `--accent`, `--focus` | Interactive accent, focus rings |
| `400` | `--muted`, `--field-placeholder`, `--link` | Placeholder text, muted text, links |
| `100` | `--default-foreground`, `--surface-tertiary-foreground` | Text on default/tertiary surfaces |
| `50` | `--surface-foreground`, `--overlay-foreground`, `--segment-foreground` | Text on surfaces/overlays |
| `0` | `--foreground`, `--field-foreground` | Primary text |

### Static color scales (`STATIC_COLOR_VALUES`)

The engine also declares all static color hex values in `STATIC_COLOR_VALUES`. These are registered with Uniwind under both `--{name}` and `--color-{name}` keys so they resolve for both `@theme var()` references (Tailwind classes) and `useCSSVariable` calls (`useThemeColor` hook).

### Adaptive light/dark behavior

The engine auto-detects whether the palette's shade-950 is dark or light using `hexLuminance()`. This controls:
- Whether `--success-foreground` / `--warning-foreground` / `--danger-foreground` use a light or dark text color.
- Whether `--accent-foreground` is light or dark (based on the shade-300 brand color).
- Whether surface shadows are transparent (dark mode) or subtle drop shadows (light mode).

### Status colors

Status colors are **global constants** set by the engine, not derived from the palette:

| Variable | Value | Used For |
|----------|-------|----------|
| `--success` | `#0CED3E` | Success states |
| `--warning` | `#F0C800` | Warning states |
| `--danger` | `#ED0C46` | Error / destructive states |

Their `-foreground` counterparts adapt to the palette's brightness.

### Wallpaper variables

For the 6 background-image themes (`cosmicpurple`, `deepocean`, `mountainpeaks`, `mountainsky`, `mysticblue`, `royalpurple`), the engine also generates:

- `--dominant-100` through `--dominant-500`: 5 visually distinct colors extracted from the image.
- `--gradient-100` through `--gradient-300`: Light / mid / dark gradient stops.

Non-wallpaper themes receive neutral gray fallbacks for these variables.

---

## Using Colors in Components

### 1. Preferred: Tailwind classes

Use semantic class names whenever possible:

```tsx
<View className="bg-surface-secondary rounded-lg">
  <Text className="text-foreground">Primary text</Text>
  <Text className="text-muted">Secondary / muted text</Text>
  <Text className="text-danger">Error message</Text>
  <Text className="text-success">Success message</Text>
</View>
```

Opacity is supported inline:

```tsx
<View className="bg-surface-secondary/75">
  <Text className="text-foreground/90">Slightly transparent</Text>
</View>
```

### 2. Runtime hex values: `useThemeColor`

For Icon color props, `opacity()` calls, SVG fills, Reanimated shared values, `LinearGradient` color arrays, or any API that requires a color string, use `useThemeColor` from `hooks/useThemeColor`.

```tsx
import { useThemeColor } from 'hooks/useThemeColor';
```

**Prefer semantic token names over raw scale names.** Use `'danger'` instead of `'red-300'`, `'success'` instead of `'green-300'`, etc. The raw scales (`green-400`, `shade-200`, `red-500`) are available when you need a specific shade that doesn't have a semantic alias.

**Prefer the array form when reading 2+ colors** — it uses a single hook call and a single Uniwind subscription:

```tsx
// Single color — fine for one value
const foreground = useThemeColor('foreground');

// Array form — preferred for 2+ colors
const [danger, success, foreground] = useThemeColor(['danger', 'success', 'foreground'] as const);

// Brand gradient
const brandGradient = useThemeColor(['shade-200', 'shade-300', 'shade-400'] as const);

// Mix semantic + scale tokens freely
const [danger, green400, yellow300] = useThemeColor(['danger', 'green-400', 'yellow-300'] as const);
```

The `as const` assertion is needed for proper tuple type inference on the returned array.

### Semantic vs raw scale tokens

| Prefer (semantic) | Avoid (raw scale) | When raw is OK |
|---|---|---|
| `'danger'` | `'red-300'` / `'shade-300'` | Need a specific shade like `'red-400'` for dark-danger backgrounds |
| `'success'` | `'green-300'` | Need `'green-400'` or `'green-500'` for darker success variants |
| `'warning'` | — | `'yellow-300'` for star ratings (distinct from HeroUI `warning` token) |
| `'foreground'` | — | — |
| `'surface-secondary'` | — | — |

Raw scale tokens are not wrong — they're useful when you need a specific lightness/darkness that the semantic token doesn't provide. But always prefer the semantic name when one exists for your use case.

### Available tokens

**Semantic (dynamic per theme):** `background`, `foreground`, `surface`, `surface-foreground`, `surface-secondary`, `surface-tertiary`, `overlay`, `overlay-foreground`, `muted`, `default`, `default-foreground`, `accent`, `accent-foreground`, `danger`, `danger-foreground`, `success`, `success-foreground`, `warning`, `warning-foreground`, `separator`, `focus`, `link`, and all HeroUI auto-generated variants (`accent-hover`, `danger-soft`, `success-soft`, etc.)

**Static scales (constant across themes):** `shade-100`..`shade-500`, `red-100`..`red-500`, `green-100`..`green-500`, `yellow-100`..`yellow-500`, `blue-100`..`blue-500`, `purple-100`..`purple-500`

### 3. Theme name or switching

```tsx
import { useTheme } from 'providers/ThemeProvider';

const { currentTheme, setTheme, availableThemes } = useTheme();
setTheme('navy');
```

`useTheme` does **not** provide color values. It only manages the theme name.

---

## CSS & Tailwind Setup (`global.css`)

```css
@import 'tailwindcss';
@import 'uniwind';
@import 'heroui-native/styles';

@source './node_modules/heroui-native/lib';
```

### What each import does

1. **`tailwindcss`** — Base Tailwind v4 (utility classes, layers).
2. **`uniwind`** — React Native CSS interop. Makes Tailwind classes work on native `View`/`Text`.
3. **`heroui-native/styles`** — Reads the semantic CSS variables (`--background`, `--surface`, `--accent`, etc.) and generates the `--color-*` Tailwind tokens that utilities like `bg-background` and `text-foreground` resolve to. Also generates hover states, soft variants, and calculated colors.

### How static colors work

Static color hex values are declared once in `themeEngine.ts` (`STATIC_COLOR_VALUES`). The engine registers them with Uniwind under both `--shade-300` and `--color-shade-300` forms. `global.css @theme` maps `--color-shade-300: var(--shade-300)` so Tailwind can generate utility classes like `text-shade-300` and `bg-shade-300`.

This dual registration is necessary because:
- `className` (`bg-shade-300`) needs the `@theme` token → resolves `var(--shade-300)` at runtime
- `useThemeColor('shade-300')` resolves `--color-shade-300` directly from Uniwind's variable store

### Shadcn compatibility aliases

For any shadcn-style component code, backward-compat aliases exist:

```css
--color-card:         var(--surface);
--color-destructive:  var(--danger);
--color-input:        var(--field-background, var(--default));
```

---

## How to Add a New Theme

1. Add a new entry to `themes.ts`:

```ts
'my-theme': {
  950: '#...',  // background (darkest for dark themes)
  900: '#...',  // surface
  800: '#...',  // surface-secondary
  700: '#...',  // surface-tertiary / separator
  600: '#...',
  500: '#...',  // accent / focus
  400: '#...',  // muted / placeholder
  300: '#...',
  200: '#...',
  100: '#...',  // default-foreground
  50:  '#...',  // surface-foreground
  0:   '#...',  // foreground (lightest for dark themes)
},
```

2. That's it. The theme engine auto-computes semantic vars and it appears in the settings UI.

For dark themes, shade 950 should be the darkest color and 0 the lightest. For light themes, invert: 950 is lightest (the background) and 0 is darkest (the foreground text). The engine detects this automatically via `hexLuminance`.

---

## How Wallpaper Themes Differ

Wallpaper themes (`cosmicpurple`, `deepocean`, `mountainpeaks`, `mountainsky`, `mysticblue`, `royalpurple`) work the same as color themes for semantic tokens, **plus**:

1. They have a **background image** asset (managed by `BackgroundProvider` and `BackgroundView`).
2. They provide extra **dominant** and **gradient** CSS variables extracted from the image at build time.
3. The `config/backgroundImageThemes.ts` file is auto-generated by `npm run build:themes` and should not be edited by hand.

To add a new wallpaper theme:
1. Place the background image in `assets/images/backgrounds/`.
2. Run `npm run build:themes` — this extracts colors and generates the config, plus adds a palette entry to `themes.ts`.
3. The theme appears in the "Wallpapers" section of the theme settings page.

---

## Provider Hierarchy

In `app/_layout.tsx`, the provider order matters:

```
ThemeProvider          ← sets CSS vars via Uniwind
  HeroUINativeProvider ← HeroUI components read the vars
    HeroTransitionProvider
      ...rest of app
```

`ThemeProvider` must wrap `HeroUINativeProvider` so that CSS variables are in place before HeroUI components render.

---

## Persistence

- **Store**: `settingsStore.ts` (Zustand + AsyncStorage persist middleware)
- **Key**: `'settings-store'` → `theme` field
- **Default**: `'dark'`
- **Scope**: Global (not profile-scoped — theme choice persists across account switches)

On app launch, `ThemeProvider` reads the persisted theme from the store and applies it immediately in its mount effect.

---

## Summary of What Does NOT Exist Anymore

The following were removed during the theme refactor. Do not re-introduce them:

- `getPrimaryColor()`, `getShadeColor()`, `getRedColor()`, `getGreenColor()`, `getBlueColor()`, `getPurpleColor()`, `getYellowColor()` — helper functions on the theme context
- `helper/colorTheme.ts` — the old `--app-*` CSS variable generator
- `constants/theme.ts` — legacy Expo template `Colors` object
- `constants/colors.ts` — hardcoded hex constants file
- `hooks/useColor.ts` — intermediate hook (consolidated into `useThemeColor`)
- `hooks/use-theme-color.ts` — legacy hook wrapping the old `Colors` object
- `useThemeColor` imported from `heroui-native` — use `hooks/useThemeColor` instead (it's a superset that supports both semantic tokens and static scales)
- `--app-primary-*`, `--app-shade-*`, `--app-red-*`, etc. CSS variables
- `bg-primary-800`, `text-primary-0`, etc. Tailwind classes (replaced by semantic names)
- Hardcoded hex color strings like `'#ED0C46'`, `'#0CED3E'` in components

If you need a color value in a style prop, use `useThemeColor` from `hooks/useThemeColor`. If you need it in a className, use the Tailwind class (`text-danger`, `bg-shade-300`, etc.). Both resolve from the same CSS variables registered by `themeEngine.ts`.
