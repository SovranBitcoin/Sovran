import { useEffect, useMemo } from 'react';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Path,
  RadialGradient,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  BOLT_CANVAS_CENTER,
  BOLT_CANVAS_SIZE,
  generateStrikeVariants,
} from '@/features/nearPay/lib/boltGeometry';
import type { StrikeStatus } from '@/features/nearPay/lib/nutDropStrikeState';
import opacity from 'hex-color-opacity';
import { variantToSkPath } from '@/features/nearPay/lib/boltSkiaPath';

import {
  BLUETOOTH_ACCENT,
  INVARIANT_WHITE,
  LIGHTNING_GOLD,
  LIGHTNING_GOLD_GLOW,
  LIGHTNING_GOLD_RIM,
  LIGHTNING_INNER_GLOW,
  LIGHTNING_RIM,
} from '@/shared/lib/brandColors';

/**
 * Electric "incoming Nut Drop" effect around a NearPay avatar.
 *
 * Design rules that keep it from looking tacky:
 * - Bolts are rim arcs under an INVERTED circle clip — no pixel ever covers
 *   the avatar's face; only a 1.5px rim light touches it.
 * - One additive ("plus" blend) group: overlapping glows brighten like
 *   light instead of muddying like paint.
 * - Restrained palette: pure-white cores, blue-white corona, and the
 *   screen's existing BLE accent for the halo — no new hues.
 * - Brief desynchronized flickers (<15% duty cycle) rather than strobing;
 *   between flickers only the rim ring breathes.
 * - Success is one clean expanding ring; failure is a quiet fade.
 *
 * All animation rides Reanimated shared values passed directly as Skia
 * props — prop updates run on the UI thread with zero React re-renders and
 * zero per-frame JS work. Mounted inside `peerAvatarFrame`, so it inherits
 * the radar's full pan/zoom/edge-lens transform chain.
 */

const AVATAR_RADIUS = 24;
/** Inverted clip protecting the avatar face (slightly inside the rim). */
const FACE_CLIP_RADIUS = 23;
const RIM_RING_RADIUS = AVATAR_RADIUS + 0.5;
const HALO_RADIUS = 34;

// ---------------------------------------------------------------------------
// Tuning knobs — edit + Metro reload to experiment.

/**
 * 1 = the originally shipped look. Raise to intensify: brighter peaks,
 * thicker strokes/glows, faster crackle cadence. Useful range ~1–2.5;
 * opacity targets clamp at 1 so overdriving is safe.
 */
const LIGHTNING_INTENSITY = 1.5;

// ---------------------------------------------------------------------------

export const LIGHTNING_PALETTES = {
  'electric-blue': {
    core: INVARIANT_WHITE,
    innerGlow: LIGHTNING_INNER_GLOW,
    outerGlow: BLUETOOTH_ACCENT,
    rim: LIGHTNING_RIM,
  },
  'storm-gold': {
    core: INVARIANT_WHITE,
    innerGlow: LIGHTNING_GOLD_GLOW,
    outerGlow: LIGHTNING_GOLD,
    rim: LIGHTNING_GOLD_RIM,
  },
} as const;

export type LightningPalette = keyof typeof LIGHTNING_PALETTES;

/** Opacity target scaled by intensity, clamped — additive blend stays sane. */
const op = (v: number) => Math.min(1, v * LIGHTNING_INTENSITY);
/** Strokes/blur sigmas grow sub-linearly so high intensity reads bright, not chunky. */
const WIDTH_SCALE = 1 + (LIGHTNING_INTENSITY - 1) * 0.5;
/** Higher intensity crackles more often; floored so it never strobes. */
const DELAY_SCALE = Math.max(0.4, 1 / LIGHTNING_INTENSITY);

/** Desynchronized ambient flicker offsets — co-prime-ish so bolts never sync.
 *  Scaled by DELAY_SCALE (ratios preserved, so desync survives intensity). */
const AMBIENT_DELAYS_MS = [560, 760, 940, 1180].map((d) => Math.round(d * DELAY_SCALE));
/** Crackle dies down to a faint rim breath after this long without resolve. */
const STUCK_DECAY_MS = 6000;

interface LightningStrikeProps {
  status: StrikeStatus;
  entrance: 'strike' | 'ambient';
  /** Stable seed (peer ID) — same peer always gets the same bolt shapes. */
  seed: string;
  /**
   * Rendered avatar frame size. The effect was designed against a 48px
   * frame; other sizes scale geometry, strokes, and blurs uniformly via a
   * root canvas transform — no per-size retuning.
   */
  frameSize?: number;
  /** 'electric-blue' = pending/radar identity; 'storm-gold' = money landed. */
  palette?: LightningPalette;
}

function ambientFlicker(peak: number) {
  return withSequence(
    withTiming(peak, { duration: 30, easing: Easing.out(Easing.quad) }),
    withTiming(0.2, { duration: 50 }),
    withTiming(peak * 0.82, { duration: 40 }),
    withTiming(0, { duration: 120, easing: Easing.in(Easing.quad) })
  );
}

export function LightningStrike({
  status,
  entrance,
  seed,
  frameSize = AVATAR_FRAME_SIZE,
  palette = 'electric-blue',
}: LightningStrikeProps) {
  const { core, innerGlow, outerGlow, rim } = LIGHTNING_PALETTES[palette];
  const frameScale = frameSize / AVATAR_FRAME_SIZE;
  const canvasStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      width: BOLT_CANVAS_SIZE * frameScale,
      height: BOLT_CANVAS_SIZE * frameScale,
      left: -CANVAS_OFFSET * frameScale,
      top: -CANVAS_OFFSET * frameScale,
    }),
    [frameScale]
  );
  const frameTransform = useMemo(() => [{ scale: frameScale }], [frameScale]);
  const haloGradientColors = useMemo(
    () => [opacity(outerGlow, op(0.45)), opacity(outerGlow, 0)],
    [outerGlow]
  );
  const variants = useMemo(() => generateStrikeVariants(seed), [seed]);
  const paths = useMemo(() => variants.map(variantToSkPath), [variants]);
  const faceClip = useMemo(() => {
    const clip = Skia.Path.Make();
    clip.addCircle(BOLT_CANVAS_CENTER, BOLT_CANVAS_CENTER, FACE_CLIP_RADIUS);
    return clip;
  }, []);

  const rootOpacity = useSharedValue(1);
  const haloOpacity = useSharedValue(0);
  const rimOpacity = useSharedValue(0);
  const pulseScale = useSharedValue(1);
  const bolt0 = useSharedValue(0);
  const bolt1 = useSharedValue(0);
  const bolt2 = useSharedValue(0);
  const bolt3 = useSharedValue(0);
  const ringRadius = useSharedValue(AVATAR_RADIUS);
  const ringWidth = useSharedValue(2);
  const ringOpacity = useSharedValue(0);
  const boltOpacities = useMemo(() => [bolt0, bolt1, bolt2, bolt3], [bolt0, bolt1, bolt2, bolt3]);
  /** 1 → 0 over the stuck-decay window; scales ambient flicker peaks. */
  const crackleEnergy = useSharedValue(1);

  const allValues = useMemo(
    () => [
      rootOpacity,
      haloOpacity,
      rimOpacity,
      pulseScale,
      bolt0,
      bolt1,
      bolt2,
      bolt3,
      ringRadius,
      ringWidth,
      ringOpacity,
      crackleEnergy,
    ],
    [
      rootOpacity,
      haloOpacity,
      rimOpacity,
      pulseScale,
      bolt0,
      bolt1,
      bolt2,
      bolt3,
      ringRadius,
      ringWidth,
      ringOpacity,
      crackleEnergy,
    ]
  );

  useEffect(() => {
    for (const value of allValues) cancelAnimation(value);

    if (status === 'active') {
      rootOpacity.set(1);
      const strike = entrance === 'strike';

      if (strike) {
        haloOpacity.set(
          withSequence(
            withTiming(op(0.9), { duration: 80, easing: Easing.out(Easing.cubic) }),
            withTiming(op(0.35), { duration: 250, easing: Easing.out(Easing.quad) })
          )
        );
        pulseScale.set(1.06);
        pulseScale.set(withSpring(1, { damping: 14, stiffness: 220 }));
        rimOpacity.set(
          withSequence(
            withTiming(op(0.9), { duration: 60 }),
            withTiming(op(0.35), { duration: 240 }),
            withRepeat(
              withSequence(
                withTiming(op(0.45), { duration: 750, easing: Easing.inOut(Easing.quad) }),
                withTiming(op(0.25), { duration: 750, easing: Easing.inOut(Easing.quad) })
              ),
              -1,
              false
            )
          )
        );
      } else {
        haloOpacity.set(withTiming(op(0.3), { duration: 300 }));
        pulseScale.set(1);
        rimOpacity.set(
          withSequence(
            withTiming(op(0.35), { duration: 300 }),
            withRepeat(
              withSequence(
                withTiming(op(0.45), { duration: 750, easing: Easing.inOut(Easing.quad) }),
                withTiming(op(0.25), { duration: 750, easing: Easing.inOut(Easing.quad) })
              ),
              -1,
              false
            )
          )
        );
      }

      boltOpacities.forEach((boltOpacity, index) => {
        const peak = op(index === 0 ? 0.95 : 0.85 - index * 0.05);
        const ambient = withRepeat(
          withSequence(withTiming(0, { duration: AMBIENT_DELAYS_MS[index] }), ambientFlicker(peak)),
          -1,
          false
        );
        if (strike && index < 2) {
          // Two strike flashes 60ms apart, then settle into the ambient loop.
          boltOpacity.set(
            withSequence(
              withTiming(0, { duration: index * 60 }),
              withTiming(index === 0 ? 1 : op(0.85), { duration: 40 }),
              withTiming(index === 0 ? 1 : op(0.85), { duration: 70 }),
              withTiming(0, { duration: 90, easing: Easing.in(Easing.quad) }),
              ambient
            )
          );
        } else {
          boltOpacity.set(ambient);
        }
      });

      // Long-redemption decay: after STUCK_DECAY_MS the crackle energy drops
      // so a backoff-stuck redeem reads as "still working", not a rave.
      crackleEnergy.set(1);
      crackleEnergy.set(
        withDelay(
          STUCK_DECAY_MS,
          withTiming(0.25, { duration: 1200, easing: Easing.out(Easing.quad) })
        )
      );
      return;
    }

    if (status === 'success' || status === 'waiting') {
      crackleEnergy.set(1);
      // Two bright resolve flashes, then everything hands over to the ring.
      bolt0.set(
        withSequence(
          withTiming(1, { duration: 50 }),
          withTiming(0.15, { duration: 60 }),
          withTiming(1, { duration: 50 }),
          withTiming(0, { duration: 140, easing: Easing.in(Easing.quad) })
        )
      );
      bolt1.set(
        withSequence(
          withTiming(0, { duration: 80 }),
          withTiming(0.9, { duration: 50 }),
          withTiming(0, { duration: 150 })
        )
      );
      bolt2.set(withTiming(0, { duration: 80 }));
      bolt3.set(withTiming(0, { duration: 80 }));
      ringRadius.set(AVATAR_RADIUS);
      ringWidth.set(2);
      ringOpacity.set(
        withSequence(
          withTiming(0, { duration: 160 }),
          withTiming(op(0.8), { duration: 40 }),
          withTiming(0, { duration: 450, easing: Easing.out(Easing.cubic) })
        )
      );
      ringRadius.set(
        withSequence(
          withTiming(AVATAR_RADIUS, { duration: 200 }),
          withTiming(HALO_RADIUS, { duration: 450, easing: Easing.out(Easing.cubic) })
        )
      );
      ringWidth.set(
        withSequence(
          withTiming(2, { duration: 200 }),
          withTiming(0.5, { duration: 450, easing: Easing.out(Easing.cubic) })
        )
      );
      haloOpacity.set(withTiming(0, { duration: 500, easing: Easing.out(Easing.quad) }));
      rimOpacity.set(withTiming(0, { duration: 500, easing: Easing.out(Easing.quad) }));
      return;
    }

    // 'fading' — quiet exit, no red, no theatrics.
    rootOpacity.set(withTiming(0, { duration: 250, easing: Easing.linear }));
  }, [
    allValues,
    bolt0,
    bolt1,
    bolt2,
    bolt3,
    boltOpacities,
    crackleEnergy,
    entrance,
    haloOpacity,
    pulseScale,
    rimOpacity,
    ringOpacity,
    ringRadius,
    ringWidth,
    rootOpacity,
    status,
  ]);

  useEffect(() => {
    return () => {
      for (const value of allValues) cancelAnimation(value);
    };
  }, [allValues]);

  const groupTransform = useDerivedValue(() => [{ scale: pulseScale.value }]);
  const scaledBolt0 = useDerivedValue(() => bolt0.value * crackleEnergy.value);
  const scaledBolt1 = useDerivedValue(() => bolt1.value * crackleEnergy.value);
  const scaledBolt2 = useDerivedValue(() => bolt2.value * crackleEnergy.value);
  const scaledBolt3 = useDerivedValue(() => bolt3.value * crackleEnergy.value);
  const scaledBolts = [scaledBolt0, scaledBolt1, scaledBolt2, scaledBolt3];

  return (
    <Canvas style={canvasStyle} pointerEvents="none">
      <Group transform={frameTransform}>
        <Group
          opacity={rootOpacity}
          transform={groupTransform}
          origin={vec(BOLT_CANVAS_CENTER, BOLT_CANVAS_CENTER)}>
          <Group blendMode="plus">
            <Circle
              cx={BOLT_CANVAS_CENTER}
              cy={BOLT_CANVAS_CENTER}
              r={HALO_RADIUS}
              opacity={haloOpacity}>
              <RadialGradient
                c={vec(BOLT_CANVAS_CENTER, BOLT_CANVAS_CENTER)}
                r={HALO_RADIUS}
                colors={haloGradientColors}
              />
            </Circle>
            <Circle
              cx={BOLT_CANVAS_CENTER}
              cy={BOLT_CANVAS_CENTER}
              r={RIM_RING_RADIUS}
              style="stroke"
              strokeWidth={1.5 * WIDTH_SCALE}
              color={rim}
              opacity={rimOpacity}>
              <BlurMask blur={2 * WIDTH_SCALE} style="solid" />
            </Circle>
            <Group clip={faceClip} invertClip>
              {paths.map((path, index) => (
                <Group key={index} opacity={scaledBolts[index]}>
                  <Path
                    path={path}
                    style="stroke"
                    strokeWidth={5.5 * WIDTH_SCALE}
                    strokeJoin="round"
                    strokeCap="round"
                    color={outerGlow}
                    opacity={op(0.55)}>
                    <BlurMask blur={6 * WIDTH_SCALE} style="normal" />
                  </Path>
                  <Path
                    path={path}
                    style="stroke"
                    strokeWidth={2.5 * WIDTH_SCALE}
                    strokeJoin="round"
                    strokeCap="round"
                    color={innerGlow}>
                    <BlurMask blur={2.5 * WIDTH_SCALE} style="normal" />
                  </Path>
                  <Path
                    path={path}
                    style="stroke"
                    strokeWidth={1.25 * WIDTH_SCALE}
                    strokeJoin="round"
                    strokeCap="round"
                    color={core}
                  />
                </Group>
              ))}
            </Group>
            <Circle
              cx={BOLT_CANVAS_CENTER}
              cy={BOLT_CANVAS_CENTER}
              r={ringRadius}
              style="stroke"
              strokeWidth={ringWidth}
              color={innerGlow}
              opacity={ringOpacity}
            />
          </Group>
        </Group>
      </Group>
    </Canvas>
  );
}

const AVATAR_FRAME_SIZE = 48;
const CANVAS_OFFSET = (BOLT_CANVAS_SIZE - AVATAR_FRAME_SIZE) / 2;
