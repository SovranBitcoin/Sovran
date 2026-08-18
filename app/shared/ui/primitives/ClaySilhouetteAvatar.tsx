import { useMemo } from 'react';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { generateClayAvatarTheme } from '@/shared/lib/avatarGradient';

// Head + torso silhouette from `mingcute:user-3-fill` (24×24). Two subpaths:
// torso (M12 13…) and head (M12 2… — exactly a circle cx=12 cy=7 r=5, which is
// why the specular highlight below needs no ClipPath: a congruent <Circle> is
// clipped to the head "for free"). Inlined rather than imported from the
// generated monicon bundle, which only carries glyphs referenced by <Icon>.
const SILHOUETTE_PATH =
  'M12 13c2.396 0 4.575.694 6.178 1.672c.8.488 1.484 1.064 1.978 1.69c.486.615.844 1.351.844 2.138c0 .845-.411 1.511-1.003 1.986c-.56.45-1.299.748-2.084.956c-1.578.417-3.684.558-5.913.558s-4.335-.14-5.913-.558c-.785-.208-1.524-.506-2.084-.956C3.41 20.01 3 19.345 3 18.5c0-.787.358-1.523.844-2.139c.494-.625 1.177-1.2 1.978-1.69C7.425 13.695 9.605 13 12 13m0-11a5 5 0 1 1 0 10a5 5 0 0 1 0-10';

// The glyph leaves ~3 units of margin under the torso, which reads as the
// figure floating inside the avatar. Shifting the figure down crops the torso
// at the bottom edge (a bust crop) and buys the same amount of air above the
// head. The figure's gradients are defined in figure-local coordinates, so
// they ride along with this translate.
const SILHOUETTE_OFFSET_Y = 4;

interface ClaySilhouetteAvatarProps {
  seed: string;
  size: number;
}

/**
 * The single avatar fallback: a matte-clay head+torso silhouette lit from the
 * upper left, colored by the same seeded palette as the profile banner so a
 * pubkey's fallback avatar and banner visibly share hues.
 *
 * Everything is drawn in the 24×24 viewBox with `userSpaceOnUse` gradients so
 * every render size shows the identical composition. Corner rounding is the
 * parent Avatar frame's job (borderRadius + overflow hidden).
 */
export function ClaySilhouetteAvatar({ seed, size }: ClaySilhouetteAvatarProps) {
  const theme = useMemo(() => generateClayAvatarTheme(seed), [seed]);
  // Seed-scoped ids: native scopes defs per <Svg>, but web resolves url(#id)
  // document-wide — a same-seed collision resolves to identical stops.
  const uid = `clay-${seed}`;

  return (
    <Svg testID="clay-silhouette-avatar" width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient
          id={`${uid}-bg`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="24"
          y2="24">
          <Stop offset="0" stopColor={theme.bgStart} />
          <Stop offset="1" stopColor={theme.bgEnd} />
        </LinearGradient>
        <LinearGradient
          id={`${uid}-body`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="2"
          x2="0"
          y2="22">
          <Stop offset="0" stopColor={theme.bodyTop} />
          <Stop offset="1" stopColor={theme.bodyBottom} />
        </LinearGradient>
        <RadialGradient
          id={`${uid}-spec`}
          gradientUnits="userSpaceOnUse"
          cx="10.2"
          cy="5.2"
          r="4.8">
          <Stop offset="0" stopColor={theme.highlight} stopOpacity="0.38" />
          <Stop offset="0.55" stopColor={theme.highlight} stopOpacity="0.14" />
          <Stop offset="1" stopColor={theme.highlight} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {/* seeded background, diagonal mid→deep (light source upper-left) */}
      <Rect
        testID="clay-avatar-background"
        x="0"
        y="0"
        width="24"
        height="24"
        fill={`url(#${uid}-bg)`}
      />
      <G transform={`translate(0, ${SILHOUETTE_OFFSET_Y})`}>
        {/* clay body: ONE path, ONE continuous vertical gradient. No overlays
            on the torso — a layered shadow reads as a seam splitting it. */}
        <Path testID="clay-avatar-body" d={SILHOUETTE_PATH} fill={`url(#${uid}-body)`} />
        {/* specular hint on the head, congruent with the head subpath */}
        <Circle testID="clay-avatar-specular" cx="12" cy="7" r="5" fill={`url(#${uid}-spec)`} />
      </G>
    </Svg>
  );
}
