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

**Note:** Check `helper/colors` for the complete list of available theme colors.

# Tailwind

We are migrating away from `createStyles` but it has some differences from a full Tailwind conversion.

- Our colors for `greys` goes from `50,100,200,300,400,500,600,700,800,900,950` and shades `goes` from `100-500`
- Do not use Tailwind styles on `<Text />` components directly. Just use inline styles.
- Use inline styles for everything except for color related styles so change `<View style={{color: greys(theme)[900], marginBottom: 8 }}>` -> `<View className="mb-1" style={{color: greys(theme)[900] }}>`

# Error handling

- Instead of using async/await we now use `neverthrow`
- Example of typical pattern for neverthrow function calls:

```
  const walletRes = await getWallet({ unit, mintUrl, profile: null });
  if (walletRes.isErr()) return err(walletRes.error);
  const wallet = walletRes.value;
```

- You can also convert functions from other libraries using:

```
  const spentRes = await toResult(wallet.checkProofsStates(proofs));
```

# Text

- use `size` and other props provided by Text to change size,font,weight rather than inline styles.
