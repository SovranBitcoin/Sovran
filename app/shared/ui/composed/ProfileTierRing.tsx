import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop, Text, TextPath } from 'react-native-svg';

import { generateTierRingTheme } from '@/shared/lib/avatarGradient';
import { PROFILE_TIER_LABEL, type ProfileTier } from '@/shared/lib/profile/profileTier';

// Geometry at the profile avatar's reference size (90); everything scales
// with `size` so the ring keeps its proportions at any avatar size.
const REFERENCE_SIZE = 90;
const GAP = 3; // background gap between the picture and the ring (story-ring look)
const STROKE = 4;
const HALO_STROKE = STROKE * 2.6;
const LABEL_FONT = 9;
const LABEL_BAND = 14; // reserved outside the ring for the coin-rim lettering

/** How far the ring layout extends beyond the avatar on each side. */
export function profileTierRingInset(size: number): number {
  const scale = size / REFERENCE_SIZE;
  return (GAP + STROKE + LABEL_BAND) * scale;
}

interface ProfileTierRingProps {
  tier: ProfileTier | null;
  /** Pubkey (varies the ring within its tier). */
  seed: string;
  /** Avatar size; the ring is drawn outside it. */
  size: number;
  /** Screen background — fills the gap so the ring reads as floating. */
  background: string;
  children: React.ReactNode;
}

/**
 * The tier ring around a profile avatar: a gradient story-style ring outside
 * the picture with a background gap, a soft halo, a bubble gloss on the
 * upper-left, and the tier name curved along the bottom rim like the lettering
 * on a coin. Layout is reserved even without a tier, so the avatar never moves
 * when the tier resolves — only the ring fades in.
 */
export function ProfileTierRing({ tier, seed, size, background, children }: ProfileTierRingProps) {
  const uid = useId();
  const scale = size / REFERENCE_SIZE;
  const inset = profileTierRingInset(size);
  const outer = size + inset * 2;
  const center = outer / 2;
  const ringRadius = size / 2 + (GAP + STROKE / 2) * scale;
  const fontSize = LABEL_FONT * scale;
  // Baseline on the path with glyph tops pointing at the centre: the path sits
  // one glyph height outside the ring so the letters clear the stroke.
  const labelRadius = ringRadius + (STROKE / 2 + 1.5) * scale + fontSize * 0.72;
  const theme = tier ? generateTierRingTheme(tier, seed) : null;

  // Bottom half, left → right (sweep 0): text along it reads upright.
  const labelPath = `M ${center - labelRadius} ${center} A ${labelRadius} ${labelRadius} 0 0 0 ${center + labelRadius} ${center}`;
  // Upper-left gloss arc, ~200° → 300°.
  const gloss = arc(center, center, ringRadius, 200, 300);

  return (
    <View style={{ width: outer, height: outer }} testID="profile-tier-ring">
      {theme && tier ? (
        <Svg
          style={StyleSheet.absoluteFill}
          width={outer}
          height={outer}
          viewBox={`0 0 ${outer} ${outer}`}
          pointerEvents="none"
          accessibilityLabel={`${PROFILE_TIER_LABEL[tier]} tier`}>
          <Defs>
            <LinearGradient
              id={`${uid}-ring`}
              gradientUnits="userSpaceOnUse"
              x1={theme.start.x * outer}
              y1={theme.start.y * outer}
              x2={theme.end.x * outer}
              y2={theme.end.y * outer}>
              <Stop offset="0" stopColor={theme.colors[0]} />
              <Stop offset="0.5" stopColor={theme.colors[1]} />
              <Stop offset="1" stopColor={theme.colors[2]} />
            </LinearGradient>
            <Path id={`${uid}-label-path`} d={labelPath} />
          </Defs>
          <Circle
            cx={center}
            cy={center}
            r={ringRadius}
            stroke={theme.halo}
            strokeWidth={HALO_STROKE * scale}
            fill="none"
          />
          <Circle
            cx={center}
            cy={center}
            r={ringRadius}
            stroke={`url(#${uid}-ring)`}
            strokeWidth={STROKE * scale}
            fill="none"
          />
          <Path
            d={gloss}
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={STROKE * 0.45 * scale}
            strokeLinecap="round"
            fill="none"
          />
          <Text
            fill={theme.label}
            fontSize={fontSize}
            fontWeight="700"
            letterSpacing={2 * scale}
            textAnchor="middle">
            <TextPath href={`#${uid}-label-path`} startOffset="50%">
              {PROFILE_TIER_LABEL[tier]}
            </TextPath>
          </Text>
        </Svg>
      ) : null}
      <View
        style={[
          styles.frame,
          {
            margin: inset - GAP * scale,
            padding: GAP * scale,
            borderRadius: size / 2 + GAP * scale,
            backgroundColor: background,
          },
        ]}>
        {children}
      </View>
    </View>
  );
}

function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const from = polar(cx, cy, r, fromDeg);
  const to = polar(cx, cy, r, toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${r} ${r} 0 ${large} 1 ${to.x} ${to.y}`;
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'flex-start',
  },
});
