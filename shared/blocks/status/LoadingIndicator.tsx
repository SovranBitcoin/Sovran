/**
 * Canonical animated status indicator.
 *
 * Three phases (`idle` / `loading` / `done`) and three result variants
 * (`success` / `error` / `reverted`). The done state cuts a check, cross,
 * or counter-clockwise revert arrow out of a filled disc via SVG mask.
 *
 * Replaces the old PaymentStatusIcon, AnimatedCheckpointDot, and the
 * SettingsRecoveryScreen shield. For non-animated checks use
 * `<Icon name="fluent:checkmark-16-filled" />`; for selection use
 * `SelectableCheck`.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  type EasingFunction,
  type EasingFunctionFactory,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Mask, Path, Rect } from 'react-native-svg';

import { useThemeColor } from '@/shared/hooks/useThemeColor';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export type Phase = 'idle' | 'loading' | 'done';
export type Result = 'success' | 'error' | 'reverted';

export interface ConfirmationProgress {
  currentConfirmations: number | null;
  requiredConfirmations: number;
}

export interface SegmentedProgress {
  completedSegments: number | null;
  segmentCount: number;
}

export interface LoadingIndicatorProps {
  phase?: Phase;
  result?: Result;
  size?: number;
  /** Ring/idle stroke. Defaults to theme `foreground`. */
  color?: string;
  /** Done/success disc + glyph color. Defaults to theme `success`. */
  successColor?: string;
  /** Done/error disc + glyph color. Defaults to theme `danger`. */
  errorColor?: string;
  /** Done/reverted disc + glyph color. Defaults to theme `warning`. */
  revertedColor?: string;
  /** Defer the phase/result transition by this many ms. Used by timeline
   *  and chain UIs to cascade indicators left→right (dot completes → line
   *  fills → next dot activates). Default 0 (transition immediately). */
  transitionDelayMs?: number;
  /** Force the entrance animation to play even when mounted at
   *  `phase='done'`. Default false: a fresh mount in a terminal phase
   *  renders the end state immediately (matches the legacy recovery-row
   *  behavior, where re-rendering an already-resolved row should not
   *  replay the draw-from-scratch animation). Set true for static
   *  success/error decorations that should animate on entry. */
  playOnMount?: boolean;
  /** Generic segmented progress. Each visible segment represents one step;
   *  completed segments animate to success, and a fully completed ring
   *  resolves through the success animation. */
  segmentedProgress?: SegmentedProgress;
  /** Dynamic segmented progress for onchain confirmation counts. Kept as a
   *  domain-named convenience over `segmentedProgress`. */
  confirmationProgress?: ConfirmationProgress;
}

// Geometry tuned so the disc fills ~76% of the size box (matches the
// legacy PaymentStatusIcon's 75% disc-to-box ratio). The original demo
// used r=22 (44% of size) which made the icons render visibly smaller
// than the static `mdi:check-circle` Icon at the same size.
const RING_R = 38;
const CIRC = 2 * Math.PI * RING_R;
const RING_STROKE = 3.5;
const SEGMENT_STROKE = 4.5;
const SEGMENT_RESULT_DISC_R = RING_R + SEGMENT_STROKE / 2;
const ICON_STROKE = 6.5;
const DEFAULT_SEGMENT_COUNT = 6;
const MAX_SEGMENT_COUNT = 24;
const SEGMENT_ANIM_MS = 340;
const SEGMENT_STAGGER_MS = 55;
const SEGMENT_PULSE_MS = 180;

const DASH: Record<Phase, [number, number]> = {
  idle: [5, 9],
  loading: [70, CIRC - 70],
  done: [CIRC, 0],
};

const RING_OPAC: Record<Phase, number> = { idle: 0.5, loading: 1, done: 1 };
const SPEED: Record<Phase, number> = { idle: 0, loading: 4, done: 4 };

// Icon paths scaled ~1.7× around (50,50) so they fill the larger disc.
// `len` is the stroke-dasharray length used for the draw-in animation —
// approximated; it just needs to be ≥ the actual path length so the
// stroke draws to completion.
const ICON = {
  check: { d: 'M 26 50 L 43 67 L 74 35', len: 73 },
  xA: { d: 'M 35 35 L 65 65', len: 47 },
  xB: { d: 'M 65 35 L 35 65', len: 47 },
  revert: {
    d: 'M 50 31 A 19 19 0 1 0 69 50 L 69 41 L 76 48 M 69 41 L 62 48',
    len: 121,
    transform: 'rotate(-135 50 50)',
  },
} as const;

const E_RING = Easing.bezier(0.65, 0, 0.35, 1);
const E_FILL_OPAC = Easing.bezier(0.4, 0, 0.2, 1);
const E_FILL_SCALE = Easing.bezier(0.34, 1.4, 0.64, 1);
const E_ICON = Easing.bezier(0.65, 0, 0.35, 1);
const E_DEF = Easing.inOut(Easing.ease);

const D_RING = 750;
const D_OPAC = 450;
const D_FILL_IN = 420;
const D_FILL_SCALE = 500;
const D_FILL_OUT = 280;
const D_ICON_IN = 420;
const D_ICON_OUT = 250;
const T_FILL = 350;
const T_ICON = 550;

export interface NormalizedSegmentedProgress {
  segmentCount: number;
  completedSegments: number;
}

interface NormalizedConfirmationProgress extends NormalizedSegmentedProgress {
  currentConfirmations: number;
  requiredConfirmations: number;
}

export function normalizeSegmentedProgress(
  progress: SegmentedProgress | null | undefined
): NormalizedSegmentedProgress | null {
  if (!progress) return null;

  const total = Number.isSafeInteger(progress.segmentCount)
    ? progress.segmentCount
    : DEFAULT_SEGMENT_COUNT;
  const segmentTotal = total > 0 ? total : DEFAULT_SEGMENT_COUNT;
  const rawCompleted =
    progress.completedSegments == null ? 0 : Math.floor(progress.completedSegments);
  const sourceCompletedSegments = Number.isFinite(rawCompleted)
    ? Math.max(0, Math.min(rawCompleted, segmentTotal))
    : 0;
  const segmentCount = Math.min(segmentTotal, MAX_SEGMENT_COUNT);
  const completedSegments =
    segmentTotal <= MAX_SEGMENT_COUNT
      ? sourceCompletedSegments
      : Math.round((sourceCompletedSegments / segmentTotal) * segmentCount);

  return {
    segmentCount,
    completedSegments: Math.max(0, Math.min(completedSegments, segmentCount)),
  };
}

export function normalizeConfirmationProgress(
  progress: ConfirmationProgress | null | undefined
): NormalizedConfirmationProgress | null {
  if (!progress) return null;

  const required = Number.isSafeInteger(progress.requiredConfirmations)
    ? progress.requiredConfirmations
    : DEFAULT_SEGMENT_COUNT;
  const requiredConfirmations = required > 0 ? required : DEFAULT_SEGMENT_COUNT;
  const rawCurrent =
    progress.currentConfirmations == null ? 0 : Math.floor(progress.currentConfirmations);
  const currentConfirmations = Number.isFinite(rawCurrent)
    ? Math.max(0, Math.min(rawCurrent, requiredConfirmations))
    : 0;
  const normalized = normalizeSegmentedProgress({
    completedSegments: currentConfirmations,
    segmentCount: requiredConfirmations,
  });

  if (!normalized) return null;

  return {
    currentConfirmations,
    requiredConfirmations,
    segmentCount: normalized.segmentCount,
    completedSegments: normalized.completedSegments,
  };
}

interface ConfirmationSegmentProps {
  index: number;
  segmentCount: number;
  completed: boolean;
  pendingColor: string;
  successColor: string;
  delayMs: number;
}

function ConfirmationSegment({
  index,
  segmentCount,
  completed,
  pendingColor,
  successColor,
  delayMs,
}: ConfirmationSegmentProps): React.ReactElement {
  const progress = useSharedValue(completed ? 1 : 0);
  const pulse = useSharedValue(0);
  const hasMountedRef = React.useRef(false);
  const step = CIRC / segmentCount;
  const gap = segmentCount === 1 ? 0 : Math.min(10, Math.max(4.5, step * 0.22));
  const dash = Math.max(1, step - gap);

  useEffect(() => {
    const isFirstCompletedRender = !hasMountedRef.current && completed;
    const segmentDelay = delayMs + (isFirstCompletedRender ? index * SEGMENT_STAGGER_MS : 0);
    hasMountedRef.current = true;

    progress.set(
      withDelay(
        segmentDelay,
        withTiming(completed ? 1 : 0, {
          duration: SEGMENT_ANIM_MS,
          easing: Easing.out(Easing.cubic),
        })
      )
    );

    if (completed) {
      pulse.set(
        withDelay(
          segmentDelay,
          withSequence(
            withTiming(1, { duration: SEGMENT_PULSE_MS, easing: Easing.out(Easing.cubic) }),
            withTiming(0, { duration: SEGMENT_PULSE_MS, easing: Easing.inOut(Easing.ease) })
          )
        )
      );
    } else {
      pulse.set(
        withTiming(0, {
          duration: SEGMENT_PULSE_MS,
          easing: Easing.inOut(Easing.ease),
        })
      );
    }
  }, [completed, delayMs, index, progress, pulse]);

  const animatedProps = useAnimatedProps(() => ({
    opacity: 0.45 + progress.get() * 0.55,
    stroke: interpolateColor(progress.get(), [0, 1], [pendingColor, successColor]),
    strokeWidth: SEGMENT_STROKE + pulse.get() * 1.2,
  }));

  return (
    <AnimatedCircle
      testID={`loading-indicator-confirmation-segment-${index}`}
      cx={50}
      cy={50}
      r={RING_R}
      fill="none"
      strokeLinecap="round"
      strokeDasharray={[dash, CIRC - dash]}
      strokeDashoffset={-index * step}
      transform="rotate(-90 50 50)"
      animatedProps={animatedProps}
    />
  );
}

export function LoadingIndicator({
  phase = 'idle',
  result = 'success',
  size = 160,
  color,
  successColor,
  errorColor,
  revertedColor,
  transitionDelayMs = 0,
  playOnMount = false,
  segmentedProgress,
  confirmationProgress,
}: LoadingIndicatorProps): React.ReactElement {
  const [themeFg, themeSuccess, themeDanger, themeWarning] = useThemeColor([
    'foreground',
    'success',
    'danger',
    'warning',
  ] as const);
  const ringColor = color ?? themeFg;
  const okColor = successColor ?? themeSuccess;
  const errColor = errorColor ?? themeDanger;
  const revColor = revertedColor ?? themeWarning;
  const segmentCompleted = segmentedProgress?.completedSegments ?? null;
  const segmentCount = segmentedProgress?.segmentCount ?? null;
  const confirmationCurrent = confirmationProgress?.currentConfirmations ?? null;
  const confirmationRequired = confirmationProgress?.requiredConfirmations ?? null;
  const normalizedSegmentedProgress = React.useMemo(() => {
    if (segmentCount != null) {
      return normalizeSegmentedProgress({
        completedSegments: segmentCompleted,
        segmentCount,
      });
    }

    return confirmationRequired == null
      ? null
      : normalizeConfirmationProgress({
          currentConfirmations: confirmationCurrent,
          requiredConfirmations: confirmationRequired,
        });
  }, [confirmationCurrent, confirmationRequired, segmentCompleted, segmentCount]);
  const segmentedComplete =
    normalizedSegmentedProgress != null &&
    normalizedSegmentedProgress.completedSegments >= normalizedSegmentedProgress.segmentCount;
  const isSegmentedMode = normalizedSegmentedProgress != null;
  const renderSegmentedSegments = normalizedSegmentedProgress != null;
  const effectivePhase = segmentedComplete ? 'done' : phase;
  const effectiveResult = segmentedComplete ? 'success' : result;
  const shouldShowResult = segmentedComplete || (!isSegmentedMode && effectivePhase === 'done');
  const resultDelayMs = segmentedComplete ? SEGMENT_ANIM_MS : 0;
  const resultColor =
    effectiveResult === 'error' ? errColor : effectiveResult === 'reverted' ? revColor : okColor;

  // Mount in terminal state when phase='done': skip the ring/fill/icon
  // choreography and render the resolved frame immediately. Matches
  // PaymentStatusIcon's behavior — the recovery screen depends on this
  // when re-rendering rows with an already-resolved status. Static
  // success/error decorations that want the draw-in on mount opt out
  // via `playOnMount`.
  const startedDone = React.useRef(
    effectivePhase === 'done' && !playOnMount && !segmentedComplete
  ).current;
  const startedResult = React.useRef(effectiveResult).current;
  const startedSuccess = startedDone && startedResult === 'success';
  const startedError = startedDone && startedResult === 'error';
  const startedReverted = startedDone && startedResult === 'reverted';

  const dashA = useSharedValue(startedDone ? DASH.done[0] : DASH.idle[0]);
  const dashB = useSharedValue(startedDone ? DASH.done[1] : DASH.idle[1]);
  const ringOpac = useSharedValue(startedDone ? RING_OPAC.done : RING_OPAC.idle);
  const colorProgress = useSharedValue(startedDone ? 1 : 0);

  const rotation = useSharedValue(0);
  const speed = useSharedValue(0);
  const targetSpeed = useSharedValue(0);

  const fillOpac = useSharedValue(startedDone ? 1 : 0);
  const fillScale = useSharedValue(startedDone ? 1 : 0.78);

  const checkOff = useSharedValue(startedSuccess ? 0 : ICON.check.len);
  const xOff = useSharedValue(startedError ? 0 : ICON.xA.len);
  const revertOff = useSharedValue(startedReverted ? 0 : ICON.revert.len);

  // Lerp speed toward target each frame; bail out cheaply when idle so
  // a screen with many indicators (e.g. a long history list) doesn't
  // burn CPU on a no-op every frame.
  useFrameCallback(() => {
    'worklet';
    const currentSpeed = speed.get();
    const nextTargetSpeed = targetSpeed.get();
    if (currentSpeed === 0 && nextTargetSpeed === 0) return;

    const nextSpeed = currentSpeed + (nextTargetSpeed - currentSpeed) * 0.06;
    const settledSpeed = Math.abs(nextSpeed) < 0.001 ? 0 : nextSpeed;
    speed.set(settledSpeed);
    rotation.set((rotation.get() + settledSpeed) % 360);
  });

  useEffect(() => {
    const d = transitionDelayMs;
    const t = (
      target: number,
      config: { duration: number; easing: EasingFunction | EasingFunctionFactory }
    ) => (d > 0 ? withDelay(d, withTiming(target, config)) : withTiming(target, config));

    const [a, b] = DASH[effectivePhase];
    dashA.set(t(a, { duration: D_RING, easing: E_RING }));
    dashB.set(t(b, { duration: D_RING, easing: E_RING }));
    ringOpac.set(t(RING_OPAC[effectivePhase], { duration: D_OPAC, easing: E_DEF }));

    const nextSpeed = isSegmentedMode ? 0 : SPEED[effectivePhase];

    let speedTimer: ReturnType<typeof setTimeout> | null = null;
    if (d > 0) {
      speedTimer = setTimeout(() => {
        targetSpeed.set(nextSpeed);
      }, d);
    } else {
      targetSpeed.set(nextSpeed);
    }

    if (shouldShowResult) {
      colorProgress.set(
        withDelay(
          d + resultDelayMs + T_FILL,
          withTiming(1, { duration: D_FILL_IN, easing: E_FILL_OPAC })
        )
      );
      fillOpac.set(
        withDelay(
          d + resultDelayMs + T_FILL,
          withTiming(1, { duration: D_FILL_IN, easing: E_FILL_OPAC })
        )
      );
      fillScale.set(
        withDelay(
          d + resultDelayMs + T_FILL,
          withTiming(1, { duration: D_FILL_SCALE, easing: E_FILL_SCALE })
        )
      );

      const drawIn = () =>
        withDelay(
          d + resultDelayMs + T_ICON,
          withTiming(0, { duration: D_ICON_IN, easing: E_ICON })
        );
      const undraw = (len: number) => t(len, { duration: D_ICON_OUT, easing: E_DEF });

      checkOff.set(effectiveResult === 'success' ? drawIn() : undraw(ICON.check.len));
      xOff.set(effectiveResult === 'error' ? drawIn() : undraw(ICON.xA.len));
      revertOff.set(effectiveResult === 'reverted' ? drawIn() : undraw(ICON.revert.len));
    } else {
      colorProgress.set(t(0, { duration: D_FILL_OUT, easing: E_DEF }));
      fillOpac.set(t(0, { duration: D_FILL_OUT, easing: E_DEF }));
      fillScale.set(t(0.78, { duration: D_FILL_OUT, easing: E_DEF }));
      checkOff.set(t(ICON.check.len, { duration: D_ICON_OUT, easing: E_DEF }));
      xOff.set(t(ICON.xA.len, { duration: D_ICON_OUT, easing: E_DEF }));
      revertOff.set(t(ICON.revert.len, { duration: D_ICON_OUT, easing: E_DEF }));
    }

    return () => {
      if (speedTimer != null) clearTimeout(speedTimer);
    };
  }, [
    effectivePhase,
    effectiveResult,
    transitionDelayMs,
    dashA,
    dashB,
    ringOpac,
    targetSpeed,
    isSegmentedMode,
    shouldShowResult,
    resultDelayMs,
    normalizedSegmentedProgress,
    colorProgress,
    fillOpac,
    fillScale,
    checkOff,
    xOff,
    revertOff,
  ]);

  const ringStrokeAP = useAnimatedProps(() => ({
    strokeDasharray: [dashA.get(), dashB.get()],
    opacity: ringOpac.get(),
    stroke: interpolateColor(colorProgress.get(), [0, 1], [ringColor, resultColor]),
  }));

  // Rotation and scale are applied via Animated.View transform styles
  // rather than as animated SVG props — react-native-svg doesn't reliably
  // drive `<G rotation={…} />` or `<G scale={…} />` from Reanimated shared
  // values on the UI thread.
  const ringWrapStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.get()}deg` }],
  }));

  const fillWrapStyle = useAnimatedStyle(() => ({
    opacity: fillOpac.get(),
    transform: [{ scale: fillScale.get() }],
  }));

  const fillCircleAP = useAnimatedProps(() => ({
    fill: interpolateColor(colorProgress.get(), [0, 1], [ringColor, resultColor]),
  }));

  const checkAP = useAnimatedProps(() => ({ strokeDashoffset: checkOff.get() }));
  const xAP = useAnimatedProps(() => ({ strokeDashoffset: xOff.get() }));
  const revertAP = useAnimatedProps(() => ({ strokeDashoffset: revertOff.get() }));
  const resultDiscRadius = isSegmentedMode ? SEGMENT_RESULT_DISC_R : RING_R;

  return (
    <View style={{ width: size, height: size }}>
      {/* Disc + glyphs (mask cut-out). Scales/fades via outer Animated.View. */}
      <Animated.View style={[StyleSheet.absoluteFill, fillWrapStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <Mask id="iconMask">
              <Rect width={100} height={100} fill="white" />
              <AnimatedPath
                d={ICON.check.d}
                stroke="black"
                strokeWidth={ICON_STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                strokeDasharray={ICON.check.len}
                animatedProps={checkAP}
              />
              <AnimatedPath
                d={ICON.xA.d}
                stroke="black"
                strokeWidth={ICON_STROKE}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={ICON.xA.len}
                animatedProps={xAP}
              />
              <AnimatedPath
                d={ICON.xB.d}
                stroke="black"
                strokeWidth={ICON_STROKE}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={ICON.xB.len}
                animatedProps={xAP}
              />
              <AnimatedPath
                d={ICON.revert.d}
                stroke="black"
                strokeWidth={ICON_STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                strokeDasharray={ICON.revert.len}
                transform={ICON.revert.transform}
                animatedProps={revertAP}
              />
            </Mask>
          </Defs>
          <AnimatedCircle
            cx={50}
            cy={50}
            r={resultDiscRadius}
            mask="url(#iconMask)"
            animatedProps={fillCircleAP}
          />
        </Svg>
      </Animated.View>

      {/* Ring outline. Rotates via outer Animated.View. */}
      <Animated.View style={[StyleSheet.absoluteFill, ringWrapStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          {renderSegmentedSegments ? (
            normalizedSegmentedProgress ? (
              Array.from({ length: normalizedSegmentedProgress.segmentCount }, (_, index) => (
                <ConfirmationSegment
                  key={index}
                  index={index}
                  segmentCount={normalizedSegmentedProgress.segmentCount}
                  completed={index < normalizedSegmentedProgress.completedSegments}
                  pendingColor={ringColor}
                  successColor={okColor}
                  delayMs={transitionDelayMs}
                />
              ))
            ) : null
          ) : (
            <AnimatedCircle
              cx={50}
              cy={50}
              r={RING_R}
              fill="none"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              animatedProps={ringStrokeAP}
            />
          )}
        </Svg>
      </Animated.View>
    </View>
  );
}

export default LoadingIndicator;
