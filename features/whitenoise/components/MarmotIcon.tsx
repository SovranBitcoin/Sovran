import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

const VIEW_W = 58;
const VIEW_H = 44;

/**
 * Brand glyph for Marmot Protocol / White Noise. Defaults to theme `foreground`
 * so it visually matches sibling iconify glyphs (which also default to
 * `foreground`) when shown alongside them in menus, banners, and headers.
 *
 * `size` is the rendered width so the glyph lines up with sibling square
 * iconify glyphs (which use `size` as both width and height); height scales
 * down to preserve the 58:44 viewBox.
 */
export function MarmotIcon({ size = 20, color }: { size?: number; color?: string }) {
  const foreground = useThemeColor('foreground');
  const fill = color ?? foreground;
  const height = (size * VIEW_H) / VIEW_W;
  return (
    <Svg width={size} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0 44V0H14.7304V13.4775L21.2348 0H35.9652V13.4775L42.4696 0H57.2V44H42.4696V30.5225L35.9652 44H21.2348V30.5225L14.7304 44H0ZM12.4348 2.29565H2.29565V39.2432L12.4348 18.2342V2.29565ZM44.7652 41.7043H54.9044V4.75676L44.7652 25.7658V41.7043ZM34.5241 41.7043L53.5431 2.29565H43.9107L24.8917 41.7043H34.5241ZM32.3083 2.29565H22.6759L3.65691 41.7043H13.2893L32.3083 2.29565ZM33.6696 4.75676L23.5304 25.7658V39.2432L33.6696 18.2342V4.75676Z"
        fill={fill}
      />
    </Svg>
  );
}
