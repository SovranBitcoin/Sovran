import { useEffect, useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  FillType,
  Group,
  Path as SkiaPath,
  RadialGradient,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, Path, Text, TextPath } from 'react-native-svg';

import { IS_ANDROID_E2E } from '@/shared/lib/e2e/isAndroidE2E';
import { generateTierRingTheme, type TierRingBlob } from '@/shared/lib/avatarGradient';
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
/**
 * The glow's blurred stroke reaches well past the layout box; the canvas is
 * drawn larger than the box (a bleed) so no side ever clips it.
 */
const BLEED = GLOW_STROKE / 2 + GLOW_BLUR * 2.5;
/** One seamless loop of the film; slow enough to read as light moving, not spinning. */
const LOOP_MS = 24_000;
/** Entrance: the film rushes through a stretch of its loop while the ring fades and scales in. */
const INTRO_MS = 900;
const INTRO_LOOP = 0.12;
const TAU = Math.PI * 2;

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
 * The tier ring around a profile avatar, built from three references:
 * Primal's legend avatars (a thin two-tone metal band plus a coloured glow),
 * the Skia "glow border" pattern (a blurred copy of the band under a sharp
 * one), and the CSS soap-bubble recipe (a film whose colours move around the
 * circumference, a specular kiss at the upper left, a thin refractive rim).
 *
 * The film is not a rotating gradient: it is a handful of soft colour blobs
 * that drift around the band at their own speeds and directions, wobbling
 * and breathing, clipped to the band — on a seamless loop. Layers, bottom to
 * top: blurred glow (band + blobs) → band → blobs → bevel (light arc
 * upper-left, shade arc lower-right) → specular kisses → inner rim → the
 * tier name engraved into the band at the lower right like a coin's rim
 * inscription. The lighting layers do not move, so the ring reads as a lit
 * object with colour moving through it. Layout is reserved even without a
 * tier, so the avatar never moves when the tier resolves.
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
  // Inscribed ON the band: the baseline sits on the path with glyph tops
  // pointing at the centre, so the path runs half a cap-height outside the
  // band's centre line and the letters sit centred in the metal.
  const labelRadius = ringRadius + fontSize * 0.36;
  const theme = useMemo(() => (tier ? generateTierRingTheme(tier, seed) : null), [tier, seed]);
  // The blobs are clipped to the band.
  const band = useMemo(() => {
    const path = Skia.Path.Make();
    path.addCircle(center, center, ringRadius + bandWidth / 2);
    path.addCircle(center, center, ringRadius - bandWidth / 2);
    path.setFillType(FillType.EvenOdd);
    return path;
  }, [bandWidth, center, ringRadius]);

  // The tier is rarely known on the first frame (counts and score land after
  // the header). When it resolves the ring fades and scales in while the film
  // rushes through a stretch of its loop, then settles into its slow drift.
  // The perpetual tick is skipped under reduced motion and on the Android e2e
  // lane (uiautomator never reaches idle with one running); the entrance is
  // instant under reduced motion. Keyed on the tier and seed, never the theme
  // object — this header re-renders constantly and must not replay the entrance.
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
      // Every blob term is a whole number of cycles per loop, and the loop
      // restarts from 0 on each repeat: seamless.
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

  // Lower-right arc travelled bottom → right (decreasing angle, sweep 0), so
  // the glyph tops point at the centre and the word reads upright-ish where a
  // coin's rim lettering would.
  const labelFrom = polar(center, center, labelRadius, LABEL_ANGLE + LABEL_SPAN / 2);
  const labelTo = polar(center, center, labelRadius, LABEL_ANGLE - LABEL_SPAN / 2);
  const labelPath = `M ${labelFrom.x} ${labelFrom.y} A ${labelRadius} ${labelRadius} 0 0 0 ${labelTo.x} ${labelTo.y}`;
  const light = arc(center, center, ringRadius + 1.1 * scale, 195, 300);
  const shade = arc(center, center, ringRadius - 1.1 * scale, 15, 120);
  const kiss = polar(center, center, ringRadius, 225);
  const kiss2 = polar(center, center, ringRadius, 135);

  return (
    <View style={{ width: outer, height: outer }} testID="profile-tier-ring">
      {theme && tier ? (
        <Animated.View style={[StyleSheet.absoluteFill, entrance]} pointerEvents="none">
          <Canvas
            style={{
              position: 'absolute',
              left: -bleed,
              top: -bleed,
              width: canvas,
              height: canvas,
            }}
            pointerEvents="none">
            {/* glow: the band and its blobs, wide and blurred, under everything */}
            <Group opacity={0.55}>
              <Circle
                cx={center}
                cy={center}
                r={ringRadius}
                style="stroke"
                strokeWidth={GLOW_STROKE * scale}
                color={theme.glow}>
                <BlurMask blur={GLOW_BLUR * scale} style="normal" />
              </Circle>
              {theme.blobs.map((blob, index) => (
                <FilmBlob
                  key={index}
                  blob={blob}
                  clock={clock}
                  center={center}
                  ringRadius={ringRadius}
                  bandWidth={bandWidth}
                  blur={GLOW_BLUR * scale}
                />
              ))}
            </Group>
            {/* the band, and the blobs drifting through it */}
            <Circle
              cx={center}
              cy={center}
              r={ringRadius}
              style="stroke"
              strokeWidth={bandWidth}
              color={theme.base}
            />
            <Group clip={band}>
              {theme.blobs.map((blob, index) => (
                <FilmBlob
                  key={index}
                  blob={blob}
                  clock={clock}
                  center={center}
                  ringRadius={ringRadius}
                  bandWidth={bandWidth}
                />
              ))}
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
            style={{
              position: 'absolute',
              left: -bleed,
              top: -bleed,
              width: canvas,
              height: canvas,
            }}
            width={canvas}
            height={canvas}
            viewBox={`0 0 ${canvas} ${canvas}`}
            pointerEvents="none"
            accessibilityLabel={`${PROFILE_TIER_LABEL[tier]} tier`}>
            <Defs>
              <Path id={`${uid}-label-path`} d={labelPath} />
            </Defs>
            {/* engraved: a light lip a hair below, dark ink on top */}
            <Text
              fill="rgba(255,255,255,0.55)"
              fontSize={fontSize}
              fontWeight="800"
              letterSpacing={1.3 * scale}
              textAnchor="middle"
              dy={0.6 * scale}>
              <TextPath href={`#${uid}-label-path`} startOffset="50%">
                {PROFILE_TIER_LABEL[tier]}
              </TextPath>
            </Text>
            <Text
              fill="rgba(0,0,0,0.55)"
              fontSize={fontSize}
              fontWeight="800"
              letterSpacing={1.3 * scale}
              textAnchor="middle">
              <TextPath href={`#${uid}-label-path`} startOffset="50%">
                {PROFILE_TIER_LABEL[tier]}
              </TextPath>
            </Text>
          </Svg>
        </Animated.View>
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

/**
 * One blob of colour drifting around the band: its centre rides the ring's
 * centre line at `angle + turns·clock + wobble·sin(…)`, and its radius
 * breathes. Every term is a whole number of cycles per loop, so the loop
 * wraps without a jump. Values are derived on the UI thread; Skia reads
 * shared values directly.
 */
function FilmBlob({
  blob,
  clock,
  center,
  ringRadius,
  bandWidth,
  blur,
}: {
  blob: TierRingBlob;
  clock: SharedValue<number>;
  center: number;
  ringRadius: number;
  bandWidth: number;
  blur?: number;
}) {
  const c = useDerivedValue(() => {
    const t = clock.value;
    const angle =
      blob.angle + blob.turns * TAU * t + blob.wobble * Math.sin(TAU * blob.wobbleCycles * t);
    return vec(center + ringRadius * Math.cos(angle), center + ringRadius * Math.sin(angle));
  });
  const r = useDerivedValue(
    () =>
      blob.radius *
      bandWidth *
      (1 + 0.25 * Math.sin(TAU * blob.breathCycles * clock.value + blob.phase))
  );
  return (
    <Circle c={c} r={r}>
      <RadialGradient c={c} r={r} colors={[blob.color, 'transparent']} />
      {blur !== undefined ? <BlurMask blur={blur} style="normal" /> : null}
    </Circle>
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
