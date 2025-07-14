# Development Guidelines

## Bottom Sheets

For bottom sheets that trigger on user interaction, refer to our comprehensive documentation and examples:

**Reference Files:**

- Example implementation: `Sovran/components/layout/sheets/example`
- Usage documentation: `Sovran/components/layout/sheets/example/usage.md`

## Theme Management

### Getting the Current Theme

Use the following pattern to access the current theme in your components:

```ts
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

```ts
const walletRes = await getWallet({ unit, mintUrl, profile: null });
if (walletRes.isErr()) return err(walletRes.error);
const wallet = walletRes.value;
```

- You can also convert functions from other libraries using:

```ts
const spentRes = await toResult(wallet.checkProofsStates(proofs));
```

# Text

- use `size` and other props provided by Text to change size,font,weight rather than inline styles.

# Reducers

## Selectors

```ts
export const setLanguage = (lang: string) => ({
  type: SET_LANGUAGE,
  payload: lang,
} as const); <- important to add `as const` for type safety
```

## Actions

Ensure you add the type of new selectors to the action type so that action prop types can be inferred.

```ts
export type SettingsAction =
  | ReturnType<typeof setLanguage>
  | ReturnType<typeof setTheme>
  | ReturnType<typeof setDisplayBitcoin>
  | ReturnType<typeof setExperimental>
  | ReturnType<typeof setPasscode>
  | ReturnType<typeof setBackgroundImage>
  | ReturnType<typeof termsAccepted>;
```

## Reducers

Using `typedUpdate` and `typedSet` is recommended because it gives us type safety on the return so it would be invalid here for example to put `termsAccepted: 'a'`, it would catch that.

The path argument for `typedUpdate` and `typedSet` expect the following:

`profiles[${profileId}].counters.${mintUrl}.${keysetId}` <- for array indicies you should use the syntax `[${profileId}]`, but for accessing object keys you need to use `.${mintUrl}` for example. Doing `[${mintUrl}]` would not be valid. This is mainly only an issue for dynamic data, for static data you can use as below. If you want to use array param for the path like `['profiles', profileId, 'counters', 'mintUrl', 'keysetId'] as const`, ensure you add the `as const` otherwise you don't get full type checking.

```ts
case TERMS_ACCEPTED: {
  return typedUpdate('settings.termsAccepted', () => ({
    termsAccepted: true,
    date: action.payload.date,
  }), state);
}
```
