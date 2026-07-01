import { useThemeColor } from './useThemeColor';

/**
 * Resolves the current theme's effective color scheme by inspecting the
 * background token's perceived brightness. Used to drive light/dark-mode
 * overrides on surfaces that aren't reached by our palette tokens:
 *
 *   - SwiftUI `Host` elements (via `environment('colorScheme', scheme)`),
 *     which otherwise inherit the app-wide `userInterfaceStyle: 'dark'`
 *     locked in `app.json` and render their `glassEffect` materials dark.
 *   - `expo-blur` `BlurView` tint, which defaults to `'dark'` in our View
 *     primitive.
 *   - `ActionSheetIOS.userInterfaceStyle`, which has no token form.
 *
 * BT.601 luma — matches `hexLuminance` in `shared/lib/themeEngine.ts`.
 */
export function useColorScheme(): 'light' | 'dark' {
  const background = useThemeColor('background');
  const c = background.replace('#', '');
  if (c.length < 6) return 'dark';
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma >= 0.5 ? 'light' : 'dark';
}
