import { useEffect, useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Path,
  RadialGradient,
  Stop,
  Text,
  TextPath,
} from 'react-native-svg';

import { IS_ANDROID_E2E } from '@/shared/lib/e2e/isAndroidE2E';
import { generateTierRingTheme } from '@/shared/lib/avatarGradient';
import { PROFILE_TIER_LABEL, type ProfileTier } from '@/shared/lib/profile/profileTier';

// Geometry at the profile avatar's reference size (90); everything scales
// with `size` so the ring keeps its proportions at any avatar size.
const REFERENCE_SIZE = 90;
const GAP = 3; // background gap between the picture and the ring (story-ring look)
const STROKE = 6.4; // just wide enough to carry the inscription
const GLOW_STROKE = 11;
const GLOW_BLUR = 8;
const LABEL_FONT = 5.2;
const OUTER_MARGIN = 3; // layout reserved outside the band
/** Where the lettering is centred, in degrees (0 = right, 90 = bottom). */
const LABEL_ANGLE = 45;
const LABEL_SPAN = 110;
/** The glow reaches past the layout box; the canvas bleeds so no side clips it. */
const BLEED = GLOW_STROKE / 2 + GLOW_BLUR * 2.5;
/** One seamless loop of the film: a slow sheen, never something you watch. */
const LOOP_MS = 60_000;
/** Entrance: the film rushes through a stretch of its loop while the ring fades and scales in. */
const INTRO_MS = 900;
const INTRO_LOOP = 0.04;
/** Blobs are a sheen, not patches. */
const BLOB_OPACITY = 0.35;

/** How far the ring layout extends beyond the avatar on each side. */
export function profileTierRingInset(size: number): number {
  const scale = size / REFERENCE_SIZE;
  return (GAP + STROKE + OUTER_MARGIN) * scale;
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
 * The tier ring around a profile avatar: a coloured radial glow, two-tone metal
 * band, drifting iridescent colour film, fixed upper-left bevel + specular
 * kisses, thin inner rim, and the tier name engraved on the lower-right rim.
 *
 * Performance: zero `<FeGaussianBlur>` filters and zero `useAnimatedProps` on
 * SVG nodes (both force synchronous CoreImage / CoreGraphics re-rasterization
 * every frame on iOS). Instead, soft `<RadialGradient>`s draw the glow and
 * speculars statically once, and the iridescent colour film rotates on its own
 * GPU-composited `<Animated.View>` (`transform: [{ rotate }]`) underneath the
 * fixed lighting and inscription layer.
 */
export function ProfileTierRing({ tier, seed, size, background, children }: ProfileTierRingProps) {
  const uid = useId();
  const reducedMotion = useReducedMotion();
  const scale = size / REFERENCE_SIZE;
  const inset = profileTierRingInset(size);
  const outer = size + inset * 2;
  const bleed = BLEED * scale;
  const canvas = outer + bleed * 2;
  const center = canvas / 2;
  const ringRadius = size / 2 + (GAP + STROKE / 2) * scale;
  const bandWidth = STROKE * scale;
  const fontSize = LABEL_FONT * scale;
  const labelRadius = ringRadius;
  const labelArcLength = (labelRadius * LABEL_SPAN * Math.PI) / 180;
  const theme = useMemo(() => (tier ? generateTierRingTheme(tier, seed) : null), [tier, seed]);
  const band = `${circlePath(center, ringRadius + bandWidth / 2)} ${circlePath(center, ringRadius - bandWidth / 2)}`;
  const id = (name: string) => `${uid}-${name}`;

  const clock = useSharedValue(0);
  const appear = useSharedValue(0);
  const animate = !!tier && !reducedMotion && !IS_ANDROID_E2E;
  useEffect(() => {
    if (!tier) {
      appear.value = 0;
      clock.value = 0;
      return;
    }
    if (!animate) {
      appear.value = 1;
      clock.value = 0;
      return;
    }
    appear.value = 0;
    appear.value = withTiming(1, { duration: INTRO_MS * 0.7, easing: Easing.out(Easing.cubic) });
    clock.value = -INTRO_LOOP;
    clock.value = withSequence(
      withTiming(0, { duration: INTRO_MS, easing: Easing.out(Easing.cubic) }),
      withRepeat(withTiming(1, { duration: LOOP_MS, easing: Easing.linear }), -1, false)
    );
    return () => {
      cancelAnimation(clock);
      cancelAnimation(appear);
    };
  }, [animate, appear, clock, seed, tier]);

  const entrance = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ scale: 0.9 + 0.1 * appear.value }],
  }));

  const filmSpin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${clock.value * 360}deg` }],
  }));

  const labelFrom = polar(center, center, labelRadius, LABEL_ANGLE + LABEL_SPAN / 2);
  const labelTo = polar(center, center, labelRadius, LABEL_ANGLE - LABEL_SPAN / 2);
  const labelPath = `M ${labelFrom.x} ${labelFrom.y} A ${labelRadius} ${labelRadius} 0 0 0 ${labelTo.x} ${labelTo.y}`;
  const light = arc(center, center, ringRadius + 1.1 * scale, 195, 300);
  const shade = arc(center, center, ringRadius - 1.1 * scale, 15, 120);
  const kiss = polar(center, center, ringRadius, 225);
  const kiss2 = polar(center, center, ringRadius, 135);

  const glowPeak = ringRadius / center;
  const glowSpread = ((GLOW_STROKE * 0.5 + GLOW_BLUR * 1.6) * scale) / center;
  const glowInner = Math.max(0, glowPeak - glowSpread);
  const glowOuter = Math.min(1, glowPeak + glowSpread);

  const canvasBox = {
    position: 'absolute' as const,
    left: -bleed,
    top: -bleed,
    width: canvas,
    height: canvas,
  };

  return (
    <View style={{ width: outer, height: outer }} testID="profile-tier-ring">
      {theme && tier ? (
        <Animated.View style={[StyleSheet.absoluteFill, entrance]} pointerEvents="none">
          {/* Layer 1: static outer radial glow + base metal band */}
          <Svg
            style={canvasBox}
            width={canvas}
            height={canvas}
            viewBox={`0 0 ${canvas} ${canvas}`}
            pointerEvents="none"
            accessibilityLabel={`${PROFILE_TIER_LABEL[tier]} tier`}>
            <Defs>
              <RadialGradient id={id('glow-ring')} cx="50%" cy="50%" r="50%">
                <Stop offset={glowInner} stopColor={theme.glow} stopOpacity={0} />
                <Stop offset={glowPeak} stopColor={theme.glow} stopOpacity={0.5} />
                <Stop offset={glowOuter} stopColor={theme.glow} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={center} cy={center} r={center} fill={`url(#${id('glow-ring')})`} />
            <Circle
              cx={center}
              cy={center}
              r={ringRadius}
              fill="none"
              strokeWidth={bandWidth}
              stroke={theme.base}
            />
          </Svg>

          {/* Layer 2: GPU-rotated iridescent colour film (0% CPU, no SVG re-rasterization) */}
          <Animated.View style={[canvasBox, filmSpin]} pointerEvents="none">
            <Svg
              width={canvas}
              height={canvas}
              viewBox={`0 0 ${canvas} ${canvas}`}
              pointerEvents="none">
              <Defs>
                <ClipPath id={id('band')}>
                  <Path d={band} clipRule="evenodd" />
                </ClipPath>
                {theme.blobs.map((blob, index) => (
                  <RadialGradient key={index} id={id(`blob-${index}`)} cx="50%" cy="50%" r="50%">
                    <Stop offset={0} stopColor={blob.color} />
                    <Stop offset={0.35} stopColor={blob.color} />
                    <Stop offset={1} stopColor={blob.color} stopOpacity={0} />
                  </RadialGradient>
                ))}
              </Defs>
              <G opacity={0.35}>
                {theme.blobs.map((blob, index) => {
                  const cx = center + ringRadius * Math.cos(blob.angle);
                  const cy = center + ringRadius * Math.sin(blob.angle);
                  return (
                    <Circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={blob.radius * bandWidth * 1.45}
                      fill={`url(#${id(`blob-${index}`)})`}
                      opacity={BLOB_OPACITY}
                    />
                  );
                })}
              </G>
              <G clipPath={`url(#${id('band')})`}>
                {theme.blobs.map((blob, index) => {
                  const cx = center + ringRadius * Math.cos(blob.angle);
                  const cy = center + ringRadius * Math.sin(blob.angle);
                  return (
                    <Circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={blob.radius * bandWidth}
                      fill={`url(#${id(`blob-${index}`)})`}
                      opacity={BLOB_OPACITY}
                    />
                  );
                })}
              </G>
            </Svg>
          </Animated.View>

          {/* Layer 3: fixed lighting (bevel, specular kisses, inner rim) + engraved inscription */}
          <Svg
            style={canvasBox}
            width={canvas}
            height={canvas}
            viewBox={`0 0 ${canvas} ${canvas}`}
            pointerEvents="none">
            <Defs>
              <Path id={id('label-path')} d={labelPath} />
              <RadialGradient id={id('kiss-1')} cx="50%" cy="50%" r="50%">
                <Stop offset={0} stopColor="rgba(255,255,255,0.95)" />
                <Stop offset={0.45} stopColor="rgba(255,255,255,0.6)" />
                <Stop offset={1} stopColor="rgba(255,255,255,0)" />
              </RadialGradient>
              <RadialGradient id={id('kiss-2')} cx="50%" cy="50%" r="50%">
                <Stop offset={0} stopColor="rgba(255,255,255,0.55)" />
                <Stop offset={1} stopColor="rgba(255,255,255,0)" />
              </RadialGradient>
            </Defs>
            <Path
              d={light}
              fill="none"
              strokeWidth={1.6 * scale}
              strokeLinecap="round"
              stroke="rgba(255,255,255,0.68)"
            />
            <Path
              d={shade}
              fill="none"
              strokeWidth={1.6 * scale}
              strokeLinecap="round"
              stroke="rgba(0,0,0,0.28)"
            />
            <Circle cx={kiss.x} cy={kiss.y} r={3.6 * scale} fill={`url(#${id('kiss-1')})`} />
            <Circle cx={kiss2.x} cy={kiss2.y} r={2.2 * scale} fill={`url(#${id('kiss-2')})`} />
            <Circle
              cx={center}
              cy={center}
              r={ringRadius - (STROKE / 2 - 0.5) * scale}
              fill="none"
              strokeWidth={0.8 * scale}
              stroke="rgba(255,255,255,0.28)"
            />
            <Text
              fill={theme.inkDark}
              fontSize={fontSize}
              fontWeight="800"
              letterSpacing={1.3 * scale}
              textAnchor="middle"
              alignmentBaseline="central"
              dx={-0.45 * scale}
              dy={-0.7 * scale}>
              <TextPath href={`#${id('label-path')}`} startOffset={labelArcLength / 2}>
                {PROFILE_TIER_LABEL[tier]}
              </TextPath>
            </Text>
            <Text
              fill={theme.inkLight}
              fontSize={fontSize}
              fontWeight="800"
              letterSpacing={1.3 * scale}
              textAnchor="middle"
              alignmentBaseline="central">
              <TextPath href={`#${id('label-path')}`} startOffset={labelArcLength / 2}>
                {PROFILE_TIER_LABEL[tier]}
              </TextPath>
            </Text>
          </Svg>
        </Animated.View>
      ) : null}
      <View
        className="self-start"
        style={{
          margin: inset - GAP * scale,
          padding: GAP * scale,
          borderRadius: size / 2 + GAP * scale,
          backgroundColor: background,
        }}>
        {children}
      </View>
    </View>
  );
}

/** A full circle as two half arcs, for compound (even-odd) paths. */
function circlePath(c: number, r: number): string {
  return `M ${c - r} ${c} A ${r} ${r} 0 1 0 ${c + r} ${c} A ${r} ${r} 0 1 0 ${c - r} ${c} Z`;
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
