import React, { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
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
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import opacity from 'hex-color-opacity';

import { generateSkyBolts, type BoltVariant } from '@/features/nearPay/lib/boltGeometry';
import type { CelebrationPhase } from '@/features/nearPay/lib/nutDropCelebration';
import type { PeerLayoutSize } from '@/features/nearPay/lib/peerLayout';
import { INVARIANT_WHITE, LIGHTNING_GOLD, LIGHTNING_GOLD_GLOW } from '@/shared/lib/brandColors';
import { alpha } from '@/shared/styles/tokens';

/**
 * Field-sized Skia layer for the Nut Drop receive celebration's impact act:
 * two storm-gold sky bolts snapping from the field edge to the centered
 * avatar's rim, a contained gold bloom, and two expanding resolve rings.
 *
 * Same discipline as the avatar-level LightningStrike, scaled to the field:
 * - one additive ("plus") group so overlapping glows brighten like light;
 * - an inverted circle clip so no bolt pixel ever crosses the portrait;
 * - the bloom is a radial gradient hard-capped at `alpha.soft` — a contained
 *   glow behind the avatar, never a full-field flash (photosensitivity);
 * - storm-gold emission colors are deliberately theme-invariant (see
 *   brandColors.ts) — light reads as light on every wallpaper theme.
 *
 * All animation rides Reanimated shared values passed as Skia props (UI
 * thread, zero per-frame JS). The impact fires once when `phase` reaches
 * 'held' (= the flying avatar arrived); 'returning' quiets any residue.
 */

/** Mirrors LightningStrike's intensity knob, tuned hotter for the one-shot. */
const CELEBRATION_INTENSITY = 1.75;
const op = (value: number) => Math.min(1, value * CELEBRATION_INTENSITY);
/**
 * Screen-length bolts read thin with the avatar-scale strokes: 1.5× the
 * 48px-frame recipe, on top of the sub-linear intensity width growth.
 */
const SKY_WIDTH_SCALE = 1.5 * (1 + (CELEBRATION_INTENSITY - 1) * 0.5);
const SKY_BOLT_COUNT = 2;
/** Resolve rings expand to this fraction of the field's short side. */
const RING_MAX_RADIUS_FACTOR = 0.42;
const RING_STAGGER_MS = 120;

function variantToSkPath(variant: BoltVariant) {
  const path = Skia.Path.Make();
  const [first, ...rest] = variant.main;
  path.moveTo(first.x, first.y);
  for (const point of rest) path.lineTo(point.x, point.y);
  const [forkStart, ...forkRest] = variant.fork;
  path.moveTo(forkStart.x, forkStart.y);
  for (const point of forkRest) path.lineTo(point.x, point.y);
  return path;
}

export function NutDropCelebrationCanvas({
  fieldSize,
  targetX,
  targetY,
  avatarRadius,
  seed,
  phase,
}: {
  fieldSize: PeerLayoutSize;
  /** Center of the parked celebration avatar, in field coordinates. */
  targetX: number;
  targetY: number;
  avatarRadius: number;
  /** Stable seed (peer ID) — same sender always gets the same sky bolts. */
  seed: string;
  phase: CelebrationPhase;
}) {
  const bolts = useMemo(
    () =>
      generateSkyBolts(seed, {
        width: fieldSize.width,
        height: fieldSize.height,
        targetX,
        targetY,
        targetRadius: avatarRadius + 6,
        count: SKY_BOLT_COUNT,
      }),
    [avatarRadius, fieldSize.height, fieldSize.width, seed, targetX, targetY]
  );
  const paths = useMemo(() => bolts.map(variantToSkPath), [bolts]);
  const faceClip = useMemo(() => {
    const clip = Skia.Path.Make();
    clip.addCircle(targetX, targetY, avatarRadius - 1);
    return clip;
  }, [avatarRadius, targetX, targetY]);

  const boltPrimary = useSharedValue(0);
  const boltSecondary = useSharedValue(0);
  const bloomOpacity = useSharedValue(0);
  const ring1Radius = useSharedValue(avatarRadius);
  const ring1Opacity = useSharedValue(0);
  const ring1Width = useSharedValue(3);
  const ring2Radius = useSharedValue(avatarRadius);
  const ring2Opacity = useSharedValue(0);
  const ring2Width = useSharedValue(3);

  const allValues = useMemo(
    () => [
      boltPrimary,
      boltSecondary,
      bloomOpacity,
      ring1Radius,
      ring1Opacity,
      ring1Width,
      ring2Radius,
      ring2Opacity,
      ring2Width,
    ],
    [
      boltPrimary,
      boltSecondary,
      bloomOpacity,
      ring1Radius,
      ring1Opacity,
      ring1Width,
      ring2Radius,
      ring2Opacity,
      ring2Width,
    ]
  );

  useEffect(() => {
    if (phase !== 'held') {
      if (phase === 'returning') {
        // Quiet whatever is mid-flight; sub-100ms micro-timings follow the
        // LightningStrike literal-ms precedent.
        for (const value of allValues) cancelAnimation(value);
        boltPrimary.set(withTiming(0, { duration: 90, easing: Easing.in(Easing.quad) }));
        boltSecondary.set(withTiming(0, { duration: 90, easing: Easing.in(Easing.quad) }));
        bloomOpacity.set(withTiming(0, { duration: 250, easing: Easing.out(Easing.quad) }));
        ring1Opacity.set(withTiming(0, { duration: 150 }));
        ring2Opacity.set(withTiming(0, { duration: 150 }));
      }
      return;
    }

    // IMPACT — the one synchronized frame. The hook fires the success haptic
    // as it flips the phase to 'held'; these sequences start the same frame.
    const ringMaxRadius = Math.min(fieldSize.width, fieldSize.height) * RING_MAX_RADIUS_FACTOR;
    const ringExpand = { duration: 450, easing: Easing.out(Easing.cubic) };

    boltPrimary.set(
      withSequence(
        withTiming(1, { duration: 40 }),
        withTiming(1, { duration: 70 }),
        withTiming(0, { duration: 90, easing: Easing.in(Easing.quad) })
      )
    );
    boltSecondary.set(
      withSequence(
        withTiming(0, { duration: 60 }),
        withTiming(op(0.85), { duration: 40 }),
        withTiming(op(0.85), { duration: 70 }),
        withTiming(0, { duration: 90, easing: Easing.in(Easing.quad) })
      )
    );
    bloomOpacity.set(
      withSequence(
        withTiming(alpha.soft, { duration: 80, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) })
      )
    );

    ring1Radius.set(avatarRadius);
    ring1Width.set(3);
    ring1Opacity.set(
      withSequence(withTiming(op(0.8), { duration: 40 }), withTiming(0, ringExpand))
    );
    ring1Radius.set(withTiming(ringMaxRadius, ringExpand));
    ring1Width.set(withTiming(0.75, ringExpand));

    ring2Radius.set(avatarRadius);
    ring2Width.set(3);
    ring2Opacity.set(
      withDelay(
        RING_STAGGER_MS,
        withSequence(withTiming(op(0.5), { duration: 40 }), withTiming(0, ringExpand))
      )
    );
    ring2Radius.set(withDelay(RING_STAGGER_MS, withTiming(ringMaxRadius, ringExpand)));
    ring2Width.set(withDelay(RING_STAGGER_MS, withTiming(0.75, ringExpand)));
  }, [
    allValues,
    avatarRadius,
    bloomOpacity,
    boltPrimary,
    boltSecondary,
    fieldSize.height,
    fieldSize.width,
    phase,
    ring1Opacity,
    ring1Radius,
    ring1Width,
    ring2Opacity,
    ring2Radius,
    ring2Width,
  ]);

  useEffect(() => {
    return () => {
      for (const value of allValues) cancelAnimation(value);
    };
  }, [allValues]);

  const boltOpacities = [boltPrimary, boltSecondary];
  const bloomRadius = Math.max(fieldSize.width, fieldSize.height) * 0.75;
  const bloomGradientColors = useMemo(
    () => [opacity(LIGHTNING_GOLD, op(0.5)), opacity(LIGHTNING_GOLD, 0)],
    []
  );

  if (fieldSize.width <= 0 || fieldSize.height <= 0) return null;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Group blendMode="plus">
        <Circle cx={targetX} cy={targetY} r={bloomRadius} opacity={bloomOpacity}>
          <RadialGradient c={vec(targetX, targetY)} r={bloomRadius} colors={bloomGradientColors} />
        </Circle>
        <Group clip={faceClip} invertClip>
          {paths.map((path, index) => (
            <Group key={index} opacity={boltOpacities[index]}>
              <Path
                path={path}
                style="stroke"
                strokeWidth={5.5 * SKY_WIDTH_SCALE}
                strokeJoin="round"
                strokeCap="round"
                color={LIGHTNING_GOLD}
                opacity={op(0.55)}>
                <BlurMask blur={6 * SKY_WIDTH_SCALE} style="normal" />
              </Path>
              <Path
                path={path}
                style="stroke"
                strokeWidth={2.5 * SKY_WIDTH_SCALE}
                strokeJoin="round"
                strokeCap="round"
                color={LIGHTNING_GOLD_GLOW}>
                <BlurMask blur={2.5 * SKY_WIDTH_SCALE} style="normal" />
              </Path>
              <Path
                path={path}
                style="stroke"
                strokeWidth={1.25 * SKY_WIDTH_SCALE}
                strokeJoin="round"
                strokeCap="round"
                color={INVARIANT_WHITE}
              />
            </Group>
          ))}
        </Group>
        <Circle
          cx={targetX}
          cy={targetY}
          r={ring1Radius}
          style="stroke"
          strokeWidth={ring1Width}
          color={LIGHTNING_GOLD_GLOW}
          opacity={ring1Opacity}
        />
        <Circle
          cx={targetX}
          cy={targetY}
          r={ring2Radius}
          style="stroke"
          strokeWidth={ring2Width}
          color={LIGHTNING_GOLD_GLOW}
          opacity={ring2Opacity}
        />
      </Group>
    </Canvas>
  );
}
