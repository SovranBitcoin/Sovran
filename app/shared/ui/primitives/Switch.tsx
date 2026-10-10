import type { ComponentProps } from 'react';
import { Switch as HeroSwitch } from 'heroui-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';

type SwitchProps = ComponentProps<typeof HeroSwitch>;

/**
 * The app's on/off switch: the library switch with a track that can be read.
 *
 * The library draws the off track in the theme's `default` colour, which the
 * wallpapers set within a couple of percent of the surface it sits on: off was
 * a white thumb on nothing. Here the off track is the style's stroke step,
 * derived from the canvas so it shows on every wallpaper, and on is the
 * success green, the one colour people already read as "on".
 *
 * Import this, not the library's `Switch`.
 */
export function Switch({ animation, ...props }: SwitchProps) {
  const { track } = useStylePaint();
  const on = useThemeColor('success');
  // A caller's own animation settings win; `disable-all` and friends pass through.
  const withTrack =
    animation === undefined
      ? { backgroundColor: { value: [track, on] as [string, string] } }
      : animation;
  return <HeroSwitch {...props} animation={withTrack} />;
}

Switch.Thumb = HeroSwitch.Thumb;
