import { useEffect, useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  FeGaussianBlur,
  Filter,
  G,
  Path,
  RadialGradient,
  Stop,
  Text,
  TextPath,
} from 'react-native-svg';

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
/** One seamless loop of the film: a slow sheen, never something you watch. */
const LOOP_MS = 60_000;
/** Entrance: the film rushes through a stretch of its loop while the ring fades and scales in. */
const INTRO_MS = 900;
const INTRO_LOOP = 0.04;
const TAU = Math.PI * 2;
/** Blobs are a sheen, not patches. */
const BLOB_OPACITY = 0.3;
const BREATH = 0.12;

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
 * the "glow border" pattern (a blurred copy of the band under a sharp
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
  // Inscribed ON the band: the path IS the band's centre line and the text is
  // set on its central baseline, so the letters sit centred in the metal
  // without guessing at font metrics.
  const labelRadius = ringRadius;
  const labelArcLength = (labelRadius * LABEL_SPAN * Math.PI) / 180;
  const theme = useMemo(() => (tier ? generateTierRingTheme(tier, seed) : null), [tier, seed]);
  // The blobs are clipped to the band: an annulus, two circles filled even-odd.
  const band = `${circlePath(center, ringRadius + bandWidth / 2)} ${circlePath(center, ringRadius - bandWidth / 2)}`;
  const id = (name: string) => `${uid}-${name}`;

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
              <Path id={id('label-path')} d={labelPath} />
              <ClipPath id={id('band')}>
                <Path d={band} clipRule="evenodd" />
              </ClipPath>
              <BlurFilter id={id('blur-glow')} size={canvas} blur={GLOW_BLUR * scale} />
              <BlurFilter id={id('blur-light')} size={canvas} blur={0.9 * scale} />
              <BlurFilter id={id('blur-shade')} size={canvas} blur={1.1 * scale} />
              <BlurFilter id={id('blur-kiss')} size={canvas} blur={1.3 * scale} />
              <BlurFilter id={id('blur-kiss2')} size={canvas} blur={1 * scale} />
              {theme.blobs.map((blob, index) => (
                // objectBoundingBox (the default) centres each gradient on its
                // own moving circle, so the colour travels with the blob.
                <RadialGradient key={index} id={id(`blob-${index}`)} cx="50%" cy="50%" r="50%">
                  <Stop offset={0} stopColor={blob.color} />
                  <Stop offset={0.3} stopColor={blob.color} />
                  <Stop offset={1} stopColor={blob.color} stopOpacity={0} />
                </RadialGradient>
              ))}
            </Defs>
            {/* glow: the band and its blobs, wide and blurred, under everything */}
            <G opacity={0.55}>
              <Circle
                cx={center}
                cy={center}
                r={ringRadius}
                fill="none"
                strokeWidth={GLOW_STROKE * scale}
                stroke={theme.glow}
                filter={`url(#${id('blur-glow')})`}
              />
              {theme.blobs.map((blob, index) => (
                <FilmBlob
                  key={index}
                  blob={blob}
                  fill={`url(#${id(`blob-${index}`)})`}
                  clock={clock}
                  center={center}
                  ringRadius={ringRadius}
                  bandWidth={bandWidth}
                  filter={`url(#${id('blur-glow')})`}
                />
              ))}
            </G>
            {/* the band, and the blobs drifting through it */}
            <Circle
              cx={center}
              cy={center}
              r={ringRadius}
              fill="none"
              strokeWidth={bandWidth}
              stroke={theme.base}
            />
            <G clipPath={`url(#${id('band')})`}>
              {theme.blobs.map((blob, index) => (
                <FilmBlob
                  key={index}
                  blob={blob}
                  fill={`url(#${id(`blob-${index}`)})`}
                  clock={clock}
                  center={center}
                  ringRadius={ringRadius}
                  bandWidth={bandWidth}
                />
              ))}
            </G>
            {/* bevel: lit from the upper left, shaded lower right */}
            <Path
              d={light}
              fill="none"
              strokeWidth={1.6 * scale}
              strokeLinecap="round"
              stroke="rgba(255,255,255,0.78)"
              filter={`url(#${id('blur-light')})`}
            />
            <Path
              d={shade}
              fill="none"
              strokeWidth={1.6 * scale}
              strokeLinecap="round"
              stroke="rgba(0,0,0,0.32)"
              filter={`url(#${id('blur-shade')})`}
            />
            {/* specular kisses */}
            <Circle
              cx={kiss.x}
              cy={kiss.y}
              r={2 * scale}
              fill="rgba(255,255,255,0.95)"
              filter={`url(#${id('blur-kiss')})`}
            />
            <Circle
              cx={kiss2.x}
              cy={kiss2.y}
              r={1.1 * scale}
              fill="rgba(255,255,255,0.5)"
              filter={`url(#${id('blur-kiss2')})`}
            />
            {/* thin refractive rim on the inside edge */}
            <Circle
              cx={center}
              cy={center}
              r={ringRadius - (STROKE / 2 - 0.5) * scale}
              fill="none"
              strokeWidth={0.8 * scale}
              stroke="rgba(255,255,255,0.28)"
            />
            {/* engraved: a dark copy offset toward the light (up-left, i.e. toward
                the centre on this arc), a light face on top — the cut edge shows
                as the dark sliver along the letters' upper-left */}
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

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** A Gaussian blur over the whole canvas (so a wide glow is never cropped). */
function BlurFilter({ id, size, blur }: { id: string; size: number; blur: number }) {
  return (
    <Filter id={id} filterUnits="userSpaceOnUse" x={0} y={0} width={size} height={size}>
      <FeGaussianBlur stdDeviation={blur} />
    </Filter>
  );
}

/**
 * One blob of colour drifting around the band: its centre rides the ring's
 * centre line at `angle + turns·clock + wobble·sin(…)`, and its radius
 * breathes. Every term is a whole number of cycles per loop, so the loop
 * wraps without a jump. Position and radius are computed on the UI thread.
 */
function FilmBlob({
  blob,
  fill,
  clock,
  center,
  ringRadius,
  bandWidth,
  filter,
}: {
  blob: TierRingBlob;
  fill: string;
  clock: SharedValue<number>;
  center: number;
  ringRadius: number;
  bandWidth: number;
  filter?: string;
}) {
  const animatedProps = useAnimatedProps(() => {
    const t = clock.value;
    const angle =
      blob.angle + blob.turns * TAU * t + blob.wobble * Math.sin(TAU * blob.wobbleCycles * t);
    return {
      cx: center + ringRadius * Math.cos(angle),
      cy: center + ringRadius * Math.sin(angle),
      r:
        blob.radius * bandWidth * (1 + BREATH * Math.sin(TAU * blob.breathCycles * t + blob.phase)),
    };
  });
  // Translucent with a long, gentle falloff: the colour diffuses into the
  // band rather than sitting on it as a spot.
  return (
    <AnimatedCircle
      animatedProps={animatedProps}
      fill={fill}
      opacity={BLOB_OPACITY}
      filter={filter}
    />
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
