# Text System

Sovran uses a custom `Text` component (`components/ui/Text.tsx`) as the single entry point for all text rendering. It wraps React Native's `Text` with font management, weight resolution, and built-in skeleton loading.

**Always import from the project, never from `react-native`:**

```tsx
import { Text } from 'components/ui/Text';
```

---

## Fonts

Two font families are loaded (`hooks/useFonts.ts`):

| Font | Weights | Purpose |
|------|---------|---------|
| **Oxygen** | Light, Regular, Bold | Default for all UI text |
| **Overpass** | Thin → Heavy + Mono | Balance / amount / monetary displays |

Oxygen is the default. Pass `overpass` to opt into Overpass for a specific element.

### Weight resolution

Boolean props map to the closest available weight:

| Prop | Oxygen | Overpass |
|------|--------|----------|
| `thin`, `extralight`, `light` | OxygenLight | OverpassThin/Extralight/Light |
| *(default)* | OxygenRegular | OverpassRegular |
| `medium`, `semibold` | OxygenBold | OverpassSemibold |
| `bold` | OxygenBold | OverpassBold |
| `extrabold` | OxygenBold | OverpassExtrabold |
| `heavy`, `black` | OxygenBold | OverpassHeavy |

You can also pass `weight="heavy"` as a string.

Oxygen has no italic variants. The `italic` prop applies `fontStyle: 'italic'` (system-simulated).

---

## Basic usage

```tsx
<Text size={16}>Regular body text</Text>
<Text bold size={14}>Bold label</Text>
<Text heavy size={28}>Large heading</Text>
<Text light size={12} italic>Small caption</Text>
```

### Monetary / amount text

```tsx
<Text overpass heavy size={42}>{formattedBalance}</Text>
<Text overpass bold size={14}>{fiatAmount}</Text>
```

`AmountFormatter` already passes `overpass` internally — you only need it for direct Text usage.

### Color

```tsx
<Text color={dangerColor}>Error text</Text>
<Text style={{ color: '#ff0000' }}>Inline color</Text>
```

The `color` prop is applied last (overrides theme foreground and style).

---

## Skeleton loading

The `Text` component has built-in skeleton support. A HeroUI shimmer overlay is absolutely positioned over the text (rendered at opacity 0), so the **real text metrics determine layout** — no content-shift.

### Auto-skeleton (nullish children)

When `children` is `null` or `undefined`, a skeleton shows automatically:

```tsx
// profile?.name is undefined while fetching → skeleton appears
<Text bold size={22}>{profile?.name}</Text>

// Once the data arrives → text renders normally
```

No `loading` prop needed for this case.

### Explicit loading

Use `loading` when the data exists but is stale, or when children is truthy during loading (e.g. a fallback value like `"0"`):

```tsx
<Text loading={isRefetching} bold size={20}>{stat.value}</Text>
```

### Opt-out

Pass `loading={false}` to suppress auto-skeleton even when children is nullish:

```tsx
<Text loading={false}>{maybeNull}</Text>
```

### Decision table

| `loading` prop | `children` | Result |
|----------------|------------|--------|
| `true` | any | Skeleton |
| `false` | any | Text (even if null → renders nothing) |
| *omitted* | `null` / `undefined` | Skeleton |
| *omitted* | truthy | Text |

---

## Placeholder (skeleton width)

When the skeleton shows, it needs invisible text to determine its width. By default it uses the actual children (or a non-breaking space if null). Pass `placeholder` to control the skeleton size:

```tsx
<Text placeholder="Display Name" bold size={22}>
  {profile?.name}
</Text>

<Text placeholder="username@relay.example" size={14}>
  {profile?.nip05}
</Text>
```

The placeholder is **only rendered when the skeleton is active** — it never affects the visible text. Priority: `placeholder → children → '\u00A0'`.

Good placeholders match the approximate width of the expected content:

| Content type | Suggested placeholder |
|---|---|
| Display name | `"Display Name"` |
| NIP-05 / email | `"username@relay.example"` |
| Stat label | `"FOLLOWING"` or `"SUCCESS RATE"` |
| Numeric value | `"1,234"` or `"100%"` |
| Short description | `"Network score"` |
| Contact subtitle | `"Last message preview text"` |
| Score | `"0.0"` |
| Review count | `"0 reviews"` |
| Mint name | `"Mint Name"` |
| Balance | `"1,000 sats"` |

---

## Exports

| Export | Use case |
|--------|----------|
| `Text` | Standard text with skeleton support. Use everywhere. |
| `UntranslatedText` | Raw text without skeleton/loading logic. Used inside `AmountFormatter`, `Avatar` fallback, and overlays where the loading state is managed externally. |
| `StyledText` | Gradient text. Props: `primary`, `secondary`, `negative`, `custom`. |
| `CustomTextProps` | TypeScript interface for all text props. |

---

## Rules

1. **Always use project `Text`** — never import `Text` from `react-native` in screens or components.
2. **Don't pass `overpass` on non-monetary text** — Overpass is reserved for balances, amounts, prices, fees, and similar numeric displays.
3. **Prefer auto-skeleton** — let `children` being null/undefined trigger the skeleton rather than managing a `loading` prop when possible.
4. **Always add `placeholder`** when the skeleton would otherwise be too narrow (e.g. the children resolves to `"0"` or an empty string during loading).
5. **Don't wrap Text in separate Skeleton components** — use the built-in `loading` / auto-skeleton instead.
