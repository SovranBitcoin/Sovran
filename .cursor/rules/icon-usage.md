# Icon Usage Rules for Sovran

## Project Overview

This project uses **Monicon** for icon management with individual icon imports via Metro configuration. All icons are pre-configured in `metro.config.js` and accessed through a custom `<Icon>` component.

## Icon System Architecture

### 1. Metro Configuration

Icons are configured in `metro.config.js` using the `@monicon/metro` plugin:

```javascript
const { withMonicon } = require('@monicon/metro');

const configWithMonicon = withMonicon(config, {
  icons: [
    'fa6-solid:chevron-left',
    'material-symbols:close-rounded',
    'fluent:add-24-filled',
    'lucide:arrow-right',
    // ... more icons
  ],
});
```

### 2. Icon Component

The project uses a custom `<Icon>` component located at `assets/icons/index.tsx`:

```typescript
import Icon from 'assets/icons';

<Icon
  name="material-symbols:close-rounded"
  size={24}
  color={getPrimaryColor('0')}
/>
```

## Icon Usage Guidelines

### 1. Always Use the Custom Icon Component

```typescript
// ✅ CORRECT - Use the custom Icon component
import Icon from 'assets/icons';

<Icon name="material-symbols:close-rounded" size={24} color="white" />

// ❌ WRONG - Don't import icon libraries directly
import { CloseIcon } from 'lucide-react-native';
import { MaterialIcons } from '@expo/vector-icons';
```

### 4. Theme Integration

Icons automatically use theme colors when no color is specified:

```typescript
import { useTheme } from 'providers/ThemeProvider';

const { getPrimaryColor } = useTheme();

// Uses theme primary color (default)
<Icon name="material-symbols:close-rounded" size={24} />

// Uses specific theme color
<Icon
  name="material-symbols:close-rounded"
  size={24}
  color={getPrimaryColor('0')}
/>

// Uses semantic colors
<Icon
  name="material-symbols:check-rounded"
  size={24}
  color={getRedColor('500')}
/>
```

#### User Interface Icons

### 6. Spinning Icons

For loading states or animated icons:

```typescript
<Icon
  name="ant-design:loading-outlined"
  size={24}
  spin={{
    outputRange: ['0deg', '360deg'],
    duration: 1000,
    easing: 'linear'
  }}
/>
```

### 7. Icon Sizing Guidelines

```typescript
// Small icons (16px) - inline text, small buttons
<Icon name="lets-icons:copy" size={16} />

// Medium icons (20-24px) - buttons, navigation
<Icon name="material-symbols:close-rounded" size={24} />

// Large icons (32px+) - headers, prominent actions
<Icon name="ph:user-bold" size={32} />
```

## Available Icon Libraries

The project supports these icon libraries (configured in metro.config.js):

- **Material Symbols**: `material-symbols:icon-name`
- **Fluent UI**: `fluent:icon-name-filled`
- **Lucide**: `lucide:icon-name`
- **Font Awesome 6**: `fa6-solid:icon-name`
- **Majesticons**: `majesticons:icon-name`
- **Phosphor**: `ph:icon-name`
- **Heroicons**: `hugeicons:icon-name`
- **Tabler**: `tabler:icon-name`
- **And many more...**

## Adding New Icons

To add new icons:

1. **Add to metro.config.js**: Add the icon name to the `icons` array
2. **Restart Metro**: Run `npx expo start --clear` to rebuild
3. **Use in components**: Import and use with the `<Icon>` component

```javascript
// In metro.config.js
icons: [
  // ... existing icons
  'new-library:new-icon-name',  // Add new icon here
],
```

## Best Practices

### 1. Consistent Sizing

- Use consistent sizes for similar UI elements
- Prefer 16px, 20px, 24px, 32px for most use cases
- Use larger sizes (48px+) sparingly for emphasis

### 2. Theme Integration

- Always use theme colors when possible
- Use semantic colors for status indicators
- Avoid hardcoded colors unless necessary

### 3. Accessibility

- Provide meaningful alt text or labels for screen readers
- Ensure sufficient color contrast
- Use appropriate sizes for touch targets

### 4. Performance

- Icons are pre-bundled via Metro configuration
- No runtime icon library imports needed
- Individual icons are tree-shaken automatically

## Common Mistakes to Avoid

1. **Don't import icon libraries directly**:

   ```typescript
   // ❌ WRONG
   import { CloseIcon } from 'lucide-react-native';
   import { MaterialIcons } from '@expo/vector-icons';

   // ✅ CORRECT
   import Icon from 'assets/icons';
   <Icon name="material-symbols:close-rounded" />
   ```

2. **Don't use hardcoded colors**:

   ```typescript
   // ❌ WRONG
   <Icon name="material-symbols:close-rounded" color="#ffffff" />

   // ✅ CORRECT
   <Icon name="material-symbols:close-rounded" color={getPrimaryColor('0')} />
   ```

3. **Don't forget to add icons to metro.config.js**:

   ```typescript
   // ❌ WRONG - Icon won't work
   <Icon name="some-library:icon-name" />

   // ✅ CORRECT - Add to metro.config.js first
   ```

4. **Don't use inconsistent naming**:

   ```typescript
   // ❌ WRONG - Inconsistent library usage
   <Icon name="material-symbols:close" />
   <Icon name="lucide:x" />

   // ✅ CORRECT - Consistent library choice
   <Icon name="material-symbols:close-rounded" />
   <Icon name="material-symbols:check-rounded" />
   ```

## Icon Component Examples

### Basic Usage

```typescript
import Icon from 'assets/icons';

// Simple icon
<Icon name="material-symbols:close-rounded" />

// With size and color
<Icon
  name="fluent:add-24-filled"
  size={32}
  color={getPrimaryColor('0')}
/>
```

### In Buttons

```typescript
<TouchableOpacity>
  <Icon name="lets-icons:copy" size={16} color={getPrimaryColor('400')} />
</TouchableOpacity>
```

### With Animation

```typescript
<Icon
  name="ant-design:loading-outlined"
  size={24}
  spin={{
    outputRange: ['0deg', '360deg'],
    duration: 1000,
    easing: 'linear'
  }}
/>
```

This icon system provides a consistent, performant, and theme-aware approach to using icons throughout the Sovran application.
