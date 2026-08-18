import { luminance } from '@/shared/lib/color';

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
 * BT.601 luma via the shared `luminance` helper — the same function
 * `themeEngine` uses to pick foreground contrast pairs.
 */
export function useColorScheme(): 'light' | 'dark' {
  const background = useThemeColor('background');

  // Anything that isn't a full hex triple stays dark, as before — the app-wide
  // `userInterfaceStyle` is locked dark, so dark is the safe guess.
  if (background.replace('#', '').length < 6) return 'dark';

  return luminance(background) >= 0.5 ? 'light' : 'dark';
}
