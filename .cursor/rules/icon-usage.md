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
import { useThemeColor } from 'hooks/useThemeColor';

const foreground = useThemeColor('foreground');

<Icon
  name="material-symbols:close-rounded"
  size={24}
  color={foreground}
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
import { useThemeColor } from 'hooks/useThemeColor';

const foreground = useThemeColor('foreground');

// Uses theme foreground color
<Icon name="material-symbols:close-rounded" size={24} color={foreground} />

// Uses static semantic color directly
<Icon name="material-symbols:check-rounded" size={24} color="#9A082E" />
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
- **Circle Flags**: `circle-flags:country-code` (for country flags)
- **And many more...**

## Flag Icons

The project uses **Circle Flags** for displaying country flags. This provides clean, circular flag designs that work seamlessly with the existing icon system.

### Flag Icon Usage

```typescript
// Basic flag usage
<Icon name="circle-flags:us" size={32} />
<Icon name="circle-flags:eu" size={32} />
<Icon name="circle-flags:gb" size={32} />

// With theme colors
<Icon
  name="circle-flags:de"
  size={24}
  color={foreground}
/>
```

### Available Country Codes

Common country codes supported:

- `us` - United States
- `eu` - European Union
- `gb` - United Kingdom
- `de` - Germany
- `fr` - France
- `it` - Italy
- `es` - Spain
- `ca` - Canada
- `au` - Australia
- `jp` - Japan
- `kr` - South Korea
- `cn` - China
- `in` - India
- `br` - Brazil
- `mx` - Mexico
- `ru` - Russia
- `ch` - Switzerland
- `at` - Austria
- `be` - Belgium
- `nl` - Netherlands
- `dk` - Denmark
- `se` - Sweden
- `no` - Norway
- `fi` - Finland
- `pl` - Poland
- `cz` - Czech Republic
- `hu` - Hungary
- `ro` - Romania
- `bg` - Bulgaria
- `hr` - Croatia
- `si` - Slovenia
- `sk` - Slovakia
- `lt` - Lithuania
- `lv` - Latvia
- `ee` - Estonia
- `ie` - Ireland
- `pt` - Portugal
- `gr` - Greece
- `cy` - Cyprus
- `mt` - Malta
- `lu` - Luxembourg
- `is` - Iceland
- `li` - Liechtenstein
- `mc` - Monaco
- `sm` - San Marino
- `va` - Vatican City
- `ad` - Andorra
- `al` - Albania
- `ba` - Bosnia and Herzegovina
- `me` - Montenegro
- `mk` - North Macedonia
- `rs` - Serbia
- `xk` - Kosovo
- `by` - Belarus
- `md` - Moldova
- `ua` - Ukraine
- `ge` - Georgia
- `am` - Armenia
- `az` - Azerbaijan
- `kz` - Kazakhstan
- `kg` - Kyrgyzstan
- `tj` - Tajikistan
- `tm` - Turkmenistan
- `uz` - Uzbekistan
- `mn` - Mongolia
- `af` - Afghanistan
- `pk` - Pakistan
- `bd` - Bangladesh
- `lk` - Sri Lanka
- `mv` - Maldives
- `bt` - Bhutan
- `np` - Nepal
- `mm` - Myanmar
- `th` - Thailand
- `la` - Laos
- `kh` - Cambodia
- `vn` - Vietnam
- `my` - Malaysia
- `sg` - Singapore
- `bn` - Brunei
- `id` - Indonesia
- `ph` - Philippines
- `tl` - East Timor
- `fj` - Fiji
- `pg` - Papua New Guinea
- `sb` - Solomon Islands
- `vu` - Vanuatu
- `nc` - New Caledonia
- `pf` - French Polynesia
- `ws` - Samoa
- `to` - Tonga
- `tv` - Tuvalu
- `ki` - Kiribati
- `nr` - Nauru
- `fm` - Micronesia
- `mh` - Marshall Islands
- `pw` - Palau
- `ck` - Cook Islands
- `nu` - Niue
- `tk` - Tokelau
- `nz` - New Zealand

### Flag Icon Configuration

Circle flags are configured in `metro.config.js` using the `collections` property:

```javascript
const configWithMonicon = withMonicon(config, {
  collections: ['circle-flags'], // Enables all circle-flags
  icons: [
    // ... other individual icons
  ],
});
```

This approach allows access to all circle-flags without needing to list each one individually.

### Flag Icon Examples

```typescript
// Currency selector with flags
{currencyItem.country ? (
  <Icon name={`circle-flags:${currencyItem.country.toLowerCase()}`} size={32} />
) : (
  <CurrencyIcon currency={currency.toLowerCase()} />
)}

// QR code with location flag
{isLocationUnit ? (
  <Icon name={`circle-flags:${unit.split('_')[1].toLowerCase()}`} size={72} />
) : (
  <CurrencyIcon width={72} currency={unit} />
)}

// Direct flag usage
<Icon name="circle-flags:us" size={24} />
<Icon name="circle-flags:eu" size={24} />
<Icon name="circle-flags:gb" size={24} />
```

### Flag Icon Best Practices

1. **Use lowercase country codes**: Always use lowercase 2-letter ISO country codes
2. **Consistent sizing**: Use consistent sizes for similar UI elements (24px, 32px, 48px)
3. **Theme integration**: Flags automatically use theme colors when no color is specified
4. **Fallback handling**: Always provide fallback icons for unsupported countries
5. **Accessibility**: Consider providing country names for screen readers

```typescript
// ✅ CORRECT - Lowercase country code
<Icon name="circle-flags:us" size={32} />

// ❌ WRONG - Uppercase country code
<Icon name="circle-flags:US" size={32} />

// ✅ CORRECT - With fallback
{country ? (
  <Icon name={`circle-flags:${country.toLowerCase()}`} size={32} />
) : (
  <Icon name="clarity:internet-of-things-solid" size={32} />
)}
```

## Adding New Icons

### Individual Icons

To add individual icons:

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

### Icon Collections

To add entire icon collections (like circle-flags):

1. **Add to collections array**: Add the collection name to the `collections` array
2. **Restart Metro**: Run `npx expo start --clear` to rebuild
3. **Use in components**: Access icons using the collection prefix

```javascript
// In metro.config.js
const configWithMonicon = withMonicon(config, {
  collections: ['circle-flags', 'new-collection'], // Add collection here
  icons: [
    // ... individual icons
  ],
});
```

### Adding New Flag Collections

If you need additional flag collections beyond circle-flags:

1. **Install the package**: `npm install new-flag-collection`
2. **Add to collections**: Add to the `collections` array in metro.config.js
3. **Use with prefix**: Access icons using `new-flag-collection:country-code`

```javascript
// Example with multiple flag collections
collections: ['circle-flags', 'flag-icons', 'country-flags'],
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

5. **Don't use incorrect flag country codes**:

   ```typescript
   // ❌ WRONG - Uppercase country code
   <Icon name="circle-flags:US" size={32} />

   // ❌ WRONG - Wrong country code format
   <Icon name="circle-flags:united-states" size={32} />

   // ✅ CORRECT - Lowercase 2-letter ISO code
   <Icon name="circle-flags:us" size={32} />
   ```

6. **Don't forget fallback handling for flags**:

   ```typescript
   // ❌ WRONG - No fallback for unsupported countries
   <Icon name={`circle-flags:${countryCode}`} size={32} />

   // ✅ CORRECT - With fallback
   {countryCode ? (
     <Icon name={`circle-flags:${countryCode.toLowerCase()}`} size={32} />
   ) : (
     <Icon name="clarity:internet-of-things-solid" size={32} />
   )}
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
  color={foreground}
/>
```

### In Buttons

```typescript
<TouchableOpacity>
  <Icon name="lets-icons:copy" size={16} color={muted} />
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

### Flag Icons

```typescript
// Basic flag usage
<Icon name="circle-flags:us" size={32} />
<Icon name="circle-flags:eu" size={32} />
<Icon name="circle-flags:gb" size={32} />

// Dynamic flag with fallback
{countryCode ? (
  <Icon name={`circle-flags:${countryCode.toLowerCase()}`} size={24} />
) : (
  <Icon name="clarity:internet-of-things-solid" size={24} />
)}

// Flag in currency selector
{currencyItem.country ? (
  <Icon name={`circle-flags:${currencyItem.country.toLowerCase()}`} size={32} />
) : (
  <CurrencyIcon currency={currency.toLowerCase()} />
)}
```

This icon system provides a consistent, performant, and theme-aware approach to using icons throughout the Sovran application.
