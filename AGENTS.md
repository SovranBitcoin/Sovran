# Development Guidelines

## Bottom Sheets

For bottom sheets that trigger on user interaction, refer to our comprehensive documentation and examples:

**Reference Files:**

- Example implementation: `Sovran/components/layout/sheets/example`
- Usage documentation: `Sovran/components/layout/sheets/example/usage.md`

## Theme Management

### Getting the Current Theme

Use the following pattern to access the current theme in your components:

```typescript
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { StyleSheet } from 'react-native';

// Inside your component
const theme = useSelector(memoizedGetTheme);
const styles = createStyles(theme);

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      color: greys(theme)[0],
      backgroundColor: greys(theme)[950], // See helper/colors for available color options
    },
  });
```

### Styling Approach

**Design:** Check `design.tsx` as it has some useful components.

**Primary:** Use Tailwind CSS for styling whenever possible.

**Colors:** When you need theme-aware colors, use inline styles:

- Simple: `style={{backgroundColor: greys(theme)[950]}}`
- Complex: Create a `createStyles` function as shown in the example above

**Note:** Check `helper/colors` for the complete list of available theme colors.

**Types:** For StyleSheet props use `style?: StyleProp<ViewStyle>`

```
style={[
  {
    color: 'red',
    ...style
  },
]}

->

style={[
  {
    color: 'red'
  },
  style,
]}
```