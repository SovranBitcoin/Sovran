import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Path as SkiaPath,
  SweepGradient,
  vec,
} from '@shopify/react-native-skia';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Path, Text, TextPath } from 'react-native-svg';

import { IS_ANDROID_E2E } from '@/shared/lib/e2e/isAndroidE2E';
import { generateTierRingTheme } from '@/shared/lib/avatarGradient';
import { PROFILE_TIER_LABEL, type ProfileTier } from '@/shared/lib/profile/profileTier';

// Geometry at the profile avatar's reference size (90); everything scales
// with `size` so the ring keeps its proportions at any avatar size.
const REFERENCE_SIZE = 90;
const GAP = 3; // background gap between the picture and the ring (story-ring look)
const STROKE = 5;
const GLOW_STROKE = 11;
const GLOW_BLUR = 8;
const LABEL_FONT = 9;
const LABEL_BAND = 14; // reserved outside the ring for the coin-rim lettering
/** One full turn of the film; slow enough to read as light moving, not spinning. */
const TURN_MS = 16_000;

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
 * The tier ring around a profile avatar, built from three references:
 * Primal's legend avatars (a thin two-tone metal band plus a coloured glow),
 * the Skia "glow border" pattern (a blurred sweep gradient under a sharp
 * one), and the CSS soap-bubble recipe (an iridescent film that drifts
 * around the circumference, a specular kiss at the upper left, a thin
 * refractive rim).
 *
 * Layers, bottom to top: glow → film ring (slowly turning) → bevel (light
 * arc upper-left, shade arc lower-right) → specular kisses → inner rim →
 * the tier name curved along the bottom rim like the lettering on a coin.
 * The lighting layers do NOT turn with the film, so the ring reads as a lit
 * object with colour moving through it. Layout is reserved even without a
 * tier, so the avatar never moves when the tier resolves.
 */
export function ProfileTierRing({ tier, seed, size, background, children }: ProfileTierRingProps) {
  const uid = useId();
  const reducedMotion = useReducedMotion();
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

  // The film turns; a perpetual tick is skipped under reduced motion and on
  // the Android e2e lane (uiautomator never reaches idle with one running).
  const turn = useSharedValue(0);
  const animate = !!theme && !reducedMotion && !IS_ANDROID_E2E;
  useEffect(() => {
    if (!animate) {
      turn.value = 0;
      return;
    }
    turn.value = withRepeat(
      withTiming(Math.PI * 2, { duration: TURN_MS, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(turn);
  }, [animate, turn]);
  const filmTransform = useDerivedValue(() => [{ rotate: turn.value }]);

  // Bottom half, left → right (sweep 0): text along it reads upright.
  const labelPath = `M ${center - labelRadius} ${center} A ${labelRadius} ${labelRadius} 0 0 0 ${center + labelRadius} ${center}`;
  const light = arc(center, center, ringRadius + 1.1 * scale, 195, 300);
  const shade = arc(center, center, ringRadius - 1.1 * scale, 15, 120);
  const kiss = polar(center, center, ringRadius, 225);
  const kiss2 = polar(center, center, ringRadius, 40);

  return (
    <View style={{ width: outer, height: outer }} testID="profile-tier-ring">
      {theme && tier ? (
        <>
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Group transform={filmTransform} origin={vec(center, center)}>
              {/* glow: the same film, wide and blurred, under everything */}
              <Circle
                cx={center}
                cy={center}
                r={ringRadius}
                style="stroke"
                strokeWidth={GLOW_STROKE * scale}
                opacity={0.55}>
                <SweepGradient
                  c={vec(center, center)}
                  colors={[...theme.sweep]}
                  transform={[{ rotate: (theme.startAngle * Math.PI) / 180 }]}
                  origin={vec(center, center)}
                />
                <BlurMask blur={GLOW_BLUR * scale} style="normal" />
              </Circle>
              {/* the film */}
              <Circle
                cx={center}
                cy={center}
                r={ringRadius}
                style="stroke"
                strokeWidth={STROKE * scale}>
                <SweepGradient
                  c={vec(center, center)}
                  colors={[...theme.sweep]}
                  transform={[{ rotate: (theme.startAngle * Math.PI) / 180 }]}
                  origin={vec(center, center)}
                />
              </Circle>
            </Group>
            {/* bevel: lit from the upper left, shaded lower right */}
            <SkiaPath
              path={light}
              style="stroke"
              strokeWidth={1.6 * scale}
              strokeCap="round"
              color="rgba(255,255,255,0.78)">
              <BlurMask blur={0.9 * scale} style="normal" />
            </SkiaPath>
            <SkiaPath
              path={shade}
              style="stroke"
              strokeWidth={1.6 * scale}
              strokeCap="round"
              color="rgba(0,0,0,0.32)">
              <BlurMask blur={1.1 * scale} style="normal" />
            </SkiaPath>
            {/* specular kisses */}
            <Circle cx={kiss.x} cy={kiss.y} r={2 * scale} color="rgba(255,255,255,0.95)">
              <BlurMask blur={1.3 * scale} style="normal" />
            </Circle>
            <Circle cx={kiss2.x} cy={kiss2.y} r={1.1 * scale} color="rgba(255,255,255,0.5)">
              <BlurMask blur={1 * scale} style="normal" />
            </Circle>
            {/* thin refractive rim on the inside edge */}
            <Circle
              cx={center}
              cy={center}
              r={ringRadius - (STROKE / 2 - 0.5) * scale}
              style="stroke"
              strokeWidth={0.8 * scale}
              color="rgba(255,255,255,0.28)"
            />
          </Canvas>
          <Svg
            style={StyleSheet.absoluteFill}
            width={outer}
            height={outer}
            viewBox={`0 0 ${outer} ${outer}`}
            pointerEvents="none"
            accessibilityLabel={`${PROFILE_TIER_LABEL[tier]} tier`}>
            <Defs>
              <Path id={`${uid}-label-path`} d={labelPath} />
            </Defs>
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
        </>
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
