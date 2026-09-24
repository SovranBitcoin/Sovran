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

// Robot head from `mdi:robot` (24×24): the dome with its antenna, plus two
// eye subpaths the even-odd fill punches out. Inlined rather than imported
// from the generated monicon bundle, which only carries glyphs referenced by
// `<Icon>` — the same reasoning as `ClaySilhouetteAvatar`'s person path.
const ROBOT_PATH =
  'M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A2.5 2.5 0 0 0 5 15.5A2.5 2.5 0 0 0 7.5 18a2.5 2.5 0 0 0 2.5-2.5A2.5 2.5 0 0 0 7.5 13m9 0a2.5 2.5 0 0 0-2.5 2.5a2.5 2.5 0 0 0 2.5 2.5a2.5 2.5 0 0 0 2.5-2.5a2.5 2.5 0 0 0-2.5-2.5';

// The glyph fills the viewBox edge to edge; a hair of inset keeps the antenna
// and the chassis shoulders off the avatar's rounded frame.
const ROBOT_SCALE = 0.86;
const ROBOT_OFFSET = (24 - 24 * ROBOT_SCALE) / 2;

interface ClayRobotAvatarProps {
  seed: string;
  size: number;
}

/**
 * The avatar fallback for a machine, rather than a person.
 *
 * Structurally identical to `ClaySilhouetteAvatar` and sharing its palette
 * generator, so a provider's face sits in the same visual family as every
 * seeded person avatar in the app — same seeded hues, same upper-left light,
 * same matte clay. Only the silhouette differs, because a Routstr node is not
 * a person and drawing it as one was the wrong claim.
 *
 * Everything is drawn in the 24×24 viewBox with `userSpaceOnUse` gradients so
 * every render size shows the identical composition. Corner rounding is the
 * parent frame's job.
 */
export function ClayRobotAvatar({ seed, size }: ClayRobotAvatarProps) {
  const theme = useMemo(() => generateClayAvatarTheme(seed), [seed]);
  // Seed-scoped ids: native scopes defs per `<Svg>`, but web resolves url(#id)
  // document-wide — a same-seed collision resolves to identical stops.
  const uid = `claybot-${seed}`;

  return (
    <Svg testID="clay-robot-avatar" width={size} height={size} viewBox="0 0 24 24">
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
        <RadialGradient id={`${uid}-spec`} gradientUnits="userSpaceOnUse" cx="9.5" cy="10" r="5.5">
          <Stop offset="0" stopColor={theme.highlight} stopOpacity="0.38" />
          <Stop offset="0.55" stopColor={theme.highlight} stopOpacity="0.14" />
          <Stop offset="1" stopColor={theme.highlight} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {/* seeded background, diagonal mid→deep (light source upper-left) */}
      <Rect
        testID="clay-robot-background"
        x="0"
        y="0"
        width="24"
        height="24"
        fill={`url(#${uid}-bg)`}
      />
      <G transform={`translate(${ROBOT_OFFSET}, ${ROBOT_OFFSET}) scale(${ROBOT_SCALE})`}>
        {/* One path, one continuous vertical gradient. `evenodd` is what makes
            the two eye circles read as cut-outs showing the background through,
            rather than as discs painted over the chassis. */}
        <Path
          testID="clay-robot-body"
          d={ROBOT_PATH}
          fill={`url(#${uid}-body)`}
          fillRule="evenodd"
        />
        {/* specular hint across the dome, offset up-left with the light */}
        <Circle testID="clay-robot-specular" cx="11" cy="11" r="5.5" fill={`url(#${uid}-spec)`} />
      </G>
    </Svg>
  );
}
