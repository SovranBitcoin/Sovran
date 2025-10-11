# Sovran Theme, Styling & Layout Rules

## Project Overview

This is a React Native/Expo app using NativeWind + Tailwind CSS with a comprehensive theming system. The app supports 30+ themes with dynamic color switching and background image themes.

## Directory Structure

- `components/ui/` - Basic UI components (Text, View, Button, Card, etc.)
- `components/blocks/` - Complex components (sheets, feeds, transactions, etc.)
- `providers/ThemeProvider.tsx` - Theme context and functions
- `themes.js` - Theme definitions with 0-950 color scales
- `helper/colorTheme.ts` - CSS variable mappings for NativeWind
- `redux/settings/` - Theme state management
- `app/settings-pages/theme.tsx` - Theme selection UI

## Theme Architecture

### 1. Theme Definition System

- **Theme Files**: `themes.js` contains all theme definitions with 0-950 color scales
- **Color Variables**: `helper/colorTheme.ts` maps themes to CSS variables using NativeWind's `vars()`
- **Tailwind Config**: `tailwind.config.js` extends colors with dynamic CSS variables
- **Available Themes**: 30+ themes including named themes (navy, coral, ice, etc.) and background image themes (deepocean, cosmicpurple, etc.)

### 2. Theme Provider System

- **Provider**: `providers/ThemeProvider.tsx` manages theme state and provides theme functions
- **Redux Integration**: Theme state persisted in Redux store (`redux/settings/`)
- **CSS Variables**: Dynamic theming via CSS variables applied at root level

## Color System Patterns

### 1. Primary Color Scale (0-950)

```typescript
// Use getPrimaryColor(shade) for theme-aware colors
const { getPrimaryColor } = useTheme();
backgroundColor: getPrimaryColor('800'); // Dark background
color: getPrimaryColor('0'); // Light text
borderColor: getPrimaryColor('100'); // Subtle border
```

### 2. Specialized Color Functions

```typescript
const { getShadeColor, getRedColor, getGreenColor, getPurpleColor } = useTheme();
// Shade colors (accent/primary brand colors)
backgroundColor: getShadeColor('300'); // Brand accent
// Semantic colors
color: getRedColor('500'); // Error states
color: getGreenColor('300'); // Success states
```

### 3. Tailwind ClassName Patterns

```typescript
// Use Tailwind classes with CSS variables
className = 'bg-primary-800 text-primary-0 border-primary-100';
className = 'text-primary-400'; // Muted text
className = 'bg-primary-700/75'; // Semi-transparent
```

## Component Theming Guidelines

### 1. Always Use Theme Functions

```typescript
// ✅ CORRECT - Theme-aware
const { getPrimaryColor } = useTheme();
<View style={{ backgroundColor: getPrimaryColor('800') }} />

// ❌ WRONG - Hardcoded colors
<View style={{ backgroundColor: '#1a1a1a' }} />
```

### 2. Text Component Theming

```typescript
// Use the custom Text component with theme integration
<Text
  size={16}
  bold
  overpass
  style={{ color: getPrimaryColor('0') }}
>
  Content
</Text>

// For gradient text
<StyledText primary>Gradient Text</StyledText>
<StyledText secondary>Secondary Gradient</StyledText>
<StyledText negative>Error Text</StyledText>
```

### 3. View Component Theming

```typescript
// Use View, VStack, HStack with blur support
<View
  className="rounded-lg border-primary-100"
  style={{ backgroundColor: getPrimaryColor('800') }}
  blur={true}
  blurIntensity={70}
>
  Content
</View>

// Stack components with spacing
<VStack spacing={16} align="center">
  <HStack spacing={8} justify="space-between">
    Content
  </HStack>
</VStack>
```

### 4. Button Component Theming

```typescript
// Use Button with variants
<Button
  variant="primary"     // primary | secondary | dangerous
  text="Click me"
  onPress={handlePress}
  ripple={true}         // Optional ripple effect
  blur={true}           // Optional blur background
/>
```

## Common Theming Patterns

### 1. Background Colors

```typescript
// Main backgrounds
backgroundColor: getPrimaryColor('900'); // Darkest
backgroundColor: getPrimaryColor('800'); // Dark
backgroundColor: getPrimaryColor('700'); // Medium dark

// Card backgrounds
backgroundColor: getPrimaryColor('800');
backgroundColor: getPrimaryColor('700');
```

### 2. Text Colors

```typescript
// Primary text
color: getPrimaryColor('0'); // Lightest (white/light)
color: getPrimaryColor('100'); // Very light
color: getPrimaryColor('200'); // Light

// Secondary text
color: getPrimaryColor('300'); // Muted
color: getPrimaryColor('400'); // More muted
```

### 3. Border Colors

```typescript
// Subtle borders
borderColor: getPrimaryColor('100');
borderColor: getPrimaryColor('200');

// Accent borders
borderColor: getShadeColor('300');
borderColor: getPrimaryColor('500');
```

### 4. Interactive States

```typescript
// Hover/pressed states
backgroundColor: getPrimaryColor('600');
backgroundColor: getPrimaryColor('500');

// Disabled states
opacity: 0.5;
color: getPrimaryColor('400');
```

## Background Image Themes

### 1. Background Image Support

```typescript
// Background image themes use the same color system
// but are applied via Redux state
const { setBackgroundImage } = useSettings();
setBackgroundImage('deepocean'); // deepocean, cosmicpurple, mysticblue, royalpurple
```

### 2. Background Image Integration

```typescript
// Background images are handled in the root layout
// Colors automatically adjust to match the background
<View style={getThemeVariables(currentTheme)} className="flex-1">
  {children}
</View>
```

## Best Practices

### 1. Always Import useTheme

```typescript
import { useTheme } from 'providers/ThemeProvider';
const { getPrimaryColor, getShadeColor } = useTheme();
```

### 2. Use Semantic Color Names

```typescript
// Good - semantic meaning
const errorColor = getRedColor('500');
const successColor = getGreenColor('300');
const brandColor = getShadeColor('300');

// Avoid - generic numbers
const someColor = getPrimaryColor('500');
```

### 3. Combine Style Props and className

```typescript
// Use className for layout, style for theme colors
<View
  className="flex-1 p-4 rounded-lg"
  style={{ backgroundColor: getPrimaryColor('800') }}
>
```

### 4. Handle Theme Changes

```typescript
// Components automatically re-render when theme changes
// No additional work needed for theme switching
```

### 5. Test Multiple Themes

```typescript
// Always test components with different themes
// Use the theme selector in settings to verify
```

## Common Mistakes to Avoid

1. **Don't hardcode colors** - Always use theme functions
2. **Don't use static Tailwind colors** - Use CSS variable classes
3. **Don't forget to import useTheme** - Required for theme functions
4. **Don't mix style and className incorrectly** - Use className for layout, style for colors
5. **Don't assume color meanings** - Check the theme definitions for actual colors

## Directory Structure for Theming

- `themes.js` - Theme definitions
- `helper/colorTheme.ts` - CSS variable mappings
- `providers/ThemeProvider.tsx` - Theme context and functions
- `components/ui/` - Basic themed components
- `components/blocks/` - Complex themed components
- `redux/settings/` - Theme state management
- `app/settings-pages/theme.tsx` - Theme selection UI

This theming system provides a comprehensive, dynamic, and maintainable approach to styling throughout the Sovran application.
