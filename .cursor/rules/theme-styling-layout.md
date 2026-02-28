# Sovran Theme, Styling & Layout Rules

## Project Overview

React Native/Expo app using Uniwind (Tailwind CSS v4) + HeroUI Native for theming. Supports 40+ themes with dynamic runtime switching and 6 background image (wallpaper) themes.

## Directory Structure

- `components/ui/` - Basic UI components (Text, View, Button, Card, etc.)
- `components/blocks/` - Complex components (sheets, feeds, transactions, etc.)
- `providers/ThemeProvider.tsx` - Thin theme context (name + setter only)
- `themes.ts` - Typed theme palette definitions (0-950 color scales)
- `helper/themeEngine.ts` - Single entry point: maps palettes to HeroUI semantic CSS vars
- `config/backgroundImageThemes.ts` - Wallpaper image themes (auto-generated)
- `global.css` - Static color tokens + wallpaper vars
- `stores/settingsStore.ts` - Theme persistence (Zustand + AsyncStorage)
- `app/settings-pages/theme.tsx` - Theme selection UI

## Theme Architecture (Single Source of Truth)

### How It Works

1. `themes.ts` defines 40+ palettes as 0-950 shade objects.
2. `helper/themeEngine.ts` maps each palette to **HeroUI semantic CSS variables** (`--background`, `--foreground`, `--surface`, `--accent`, etc.).
3. `ThemeProvider` calls `Uniwind.updateCSSVariables()` when the theme changes — this is the ONLY place CSS vars are written.
4. `heroui-native/styles` (imported in `global.css`) automatically generates Tailwind tokens (`--color-background`, `--color-surface`, etc.) from those semantic vars.
5. Components use **Tailwind classes** (`bg-background`, `text-foreground`, `bg-surface-secondary`) or `useThemeColor()` from `heroui-native` for runtime hex values.

### Semantic Color Tokens (HeroUI)

| Token | Purpose | Tailwind class |
|-------|---------|---------------|
| `background` | App background | `bg-background` |
| `foreground` | Primary text | `text-foreground` |
| `surface` | Card/section bg | `bg-surface` |
| `surface-secondary` | Elevated surface | `bg-surface-secondary` |
| `surface-tertiary` | Tertiary surface | `bg-surface-tertiary` |
| `overlay` | Modal/popover bg | `bg-overlay` |
| `default` | Default component bg | `bg-default` |
| `accent` | Interactive accent | `bg-accent`, `text-accent` |
| `muted` | Muted/placeholder | `text-muted` |
| `separator` | Dividers | `border-separator` |
| `danger` | Error/destructive | `text-danger`, `bg-danger` |
| `success` | Success states | `text-success`, `bg-success` |
| `warning` | Warning states | `text-warning`, `bg-warning` |
| `link` | Link text | `text-link` |

Each token has a `-foreground` variant for text on that background (e.g., `text-surface-foreground`).

### Static Colors (Never Change With Theme)

Defined directly in `global.css @theme` — no CSS variable indirection:

- `shade-100..500` — Brand accent reds (`#FF5841` → `#BF004E`)
- `red-100..500` — Error states (`#F8E0E6` → `#9A082E`)
- `green-100..500` — Success states (`#E0F8E0` → `#089A2C`)
- `purple-100..500` — Purple scale (`#E0E0F8` → `#4B0082`)
- `blue-100..500` — Info states (`#DBEAFE` → `#1D4ED8`)
- `yellow-100..500` — Warning states (`#F8F8E0` → `#9A9A00`)

Use as: `text-shade-300`, `bg-red-100`, `text-green-300`, etc.

### Wallpaper-Only Variables

Background image themes provide extra vars (dominant/gradient) extracted from images. These are the only dynamic CSS vars besides HeroUI semantics:

- `dominant-100..500` — 5 visually distinct colors from the image
- `gradient-100..300` — Light/mid/dark gradient colors

Use as: `bg-dominant-300`, `text-gradient-100`, etc.

## Component Theming Guidelines

### 1. Use Tailwind Classes (Preferred)

```typescript
// ✅ CORRECT — Semantic Tailwind classes
<View className="bg-surface-secondary rounded-lg">
  <Text className="text-foreground">Content</Text>
  <Text className="text-muted">Secondary text</Text>
</View>

// ❌ WRONG — Old approach
<View style={{ backgroundColor: getPrimaryColor('800') }}>
```

### 2. When You Need Runtime Hex Values

For Reanimated shared values, SVG fills, Icon color props, LinearGradient, or conditional style logic:

```typescript
import { useThemeColor } from 'hooks/useThemeColor';

function MyComponent() {
  // Single token
  const foreground = useThemeColor('foreground');

  // Array form (preferred for 2+ colors)
  const [danger, success, brandAccent] = useThemeColor(['danger', 'success', 'shade-300'] as const);

  // Brand gradient
  const brandGradient = useThemeColor(['shade-200', 'shade-300', 'shade-400'] as const);

  return (
    <Icon color={opacity(foreground, 0.9)} />
  );
}
```

### 3. Text Component

The `Text` component defaults to `text-foreground`. No need to explicitly set text color for primary content.

```typescript
<Text size={16} bold>This is foreground-colored by default</Text>
<Text className="text-muted" size={14}>Muted secondary text</Text>
<Text className="text-danger" size={14}>Error text</Text>
```

### 4. Button Variants

Use HeroUI semantic variants instead of manual color styling:

```typescript
<Button variant="primary" text="Confirm" onPress={handlePress} />
<Button variant="dangerous" text="Delete" onPress={handleDelete} />
```

### 5. Opacity

Use Tailwind opacity syntax in classNames:

```typescript
className="bg-surface-secondary/75"  // 75% opacity
className="text-foreground/90"        // 90% opacity
```

## How To Add a New Theme

1. Add the palette to `themes.ts` as a `ThemePalette` record (shades 0, 50, 100-950).
2. That's it — `themeEngine.ts` auto-generates HeroUI semantic vars and the theme appears in the settings UI.

For background image themes, run `npm run build:themes` to generate palettes + dominant/gradient colors from the image.

## How Wallpaper Themes Differ

Wallpaper themes have the same 0-950 palette + semantic vars as regular themes, but additionally provide:
- A background image asset (from `config/backgroundImageThemes.ts`)
- `--dominant-*` and `--gradient-*` CSS vars extracted from the image

The `BackgroundProvider` and `BackgroundView` handle rendering the image + blur effects. Semantic colors still come from the palette, not from the image.

## Common Mistakes to Avoid

1. **Don't use `getPrimaryColor` / `getShadeColor`** — These are deleted. Use Tailwind classes or `useColor`.
2. **Don't hardcode hex colors** — Use `className` or `useColor('token-name')` from `hooks/useColor`.
3. **Don't create custom `--app-*` CSS variables** — Use HeroUI semantic tokens.
4. **Don't import `useTheme` for colors** — `useTheme` only provides `currentTheme` / `setTheme` / `availableThemes`. Use `useThemeColor` from `hooks/useThemeColor` for color values.
5. **Don't use `bg-primary-*` / `text-primary-*`** Tailwind classes — Use semantic names (`bg-surface-secondary`, `text-foreground`, etc.).
6. **Don't create color constant files** — `themeEngine.ts` is the single source of truth for hex values. Access via className or `useThemeColor`.
