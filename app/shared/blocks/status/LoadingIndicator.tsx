/**
 * Canonical animated status indicator.
 *
 * Three phases (`idle` / `loading` / `done`) and four result variants
 * (`success` / `error` / `reverted` / `warning`). The done state cuts a
 * check, cross, counter-clockwise revert arrow, or Wi-Fi glyph out of a
 * filled disc via SVG mask.
 *
 * Replaces the old PaymentStatusIcon, AnimatedCheckpointDot, and the
 * SettingsRecoveryScreen shield. For non-animated checks use
 * `<Icon name="fluent:checkmark-16-filled" />`; for selection use
 * `SelectableCheck`.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
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
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Mask, Path, Rect } from 'react-native-svg';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { IS_ANDROID_E2E } from '@/shared/lib/e2e/isAndroidE2E';
import {
  useVisualLayoutLogger,
  visualLayoutScopePart,
  type VisualLayoutConfig,
} from '@/shared/lib/contentShiftLog';

import {
  CIRC,
  IDLE_SEGMENT_DASH,
  IDLE_SEGMENT_GAP,
  RING_R,
  RING_STROKE,
  effectiveSegmentStroke,
  idleDashPattern,
  pendingStrokeScale,
  resultDiscRadius,
  segmentDash,
  segmentStroke,
  strokeUnitsForPx,
} from './ringGeometry';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export type Phase = 'idle' | 'loading' | 'done';
export type Result = 'success' | 'error' | 'reverted' | 'warning';

export interface ConfirmationProgress {
  currentConfirmations: number | null;
  requiredConfirmations: number;
}

export interface SegmentedProgress {
  completedSegments: number | null;
  segmentCount: number;
}

type LoadingIndicatorVisualProps = {
  visualScope?: string;
  visualKey?: string;
  visualSurface?: string;
  visualComponent?: string;
  visualPhase?: string;
  visualExtra?: VisualLayoutConfig['extra'];
  visualDisabled?: boolean;
};

export interface LoadingIndicatorProps extends LoadingIndicatorVisualProps {
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
  /** Done/warning disc + glyph color. Defaults to theme `warning`. */
  warningColor?: string;
  /** Colour of every non-result ring stroke — the idle dash ring, the
   *  spinning loading arc, and pending segment arcs alike. Defaults to the
   *  ring `color`; the timeline passes its muted rail-track color so ring
   *  chrome and the unfilled connector read as one system. Done resolves to
   *  the result colour from this base. */
  pendingColor?: string;
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
  /** Whether the segmented step is actively progressing. When false, the
   *  next-to-complete segment skips its "in progress" breathe — used when the
   *  ring previews upcoming segments before the step has started (e.g. onchain
   *  confirmations shown before any payment is observed). Default true. */
  segmentedInProgress?: boolean;
  /** Target on-screen stroke thickness in px for the ring outline and segment
   *  arcs. Strokes are otherwise viewBox-relative, so small indicators render
   *  hairline-thin — the 20px timeline dots set this to the connector-rail
   *  width so rings and rail read as one weight. Dense segment rings clamp
   *  below the target to keep the seams between segments visible. */
  strokeWidthPx?: number;
  /** Verbose diagnostics: when provided, the indicator reports every
   *  transition it schedules — phase/result choreography (dash targets, spin
   *  speed, disc fill, glyph draw-in and their delays), segmented-ring fills,
   *  and per-segment breathe pulses. The caller owns the log sink and any
   *  identifying context (e.g. HistoryEntryTimeline prefixes row/entry). */
  onDebugEvent?: (event: string, params: Record<string, unknown>) => void;
}

// Ring/seam/dash geometry (RING_R, stroke clamps, the shared seam-gap
// policy, dash patterns) lives in `./ringGeometry` — both ring
// implementations below consume it exclusively so they cannot drift apart.
const ICON_STROKE = 6.5;
const DEFAULT_SEGMENT_COUNT = 6;
const MAX_SEGMENT_COUNT = 24;
const SEGMENT_ANIM_MS = 340;
const SEGMENT_STAGGER_MS = 55;
const SEGMENT_PULSE_MS = 180;
// The next-to-complete segment breathes a subtle colour/opacity pulse to signal
// "this step is in progress". One half-cycle duration; loops (reversing).
const SEGMENT_ACTIVE_PULSE_MS = 760;

const DASH: Record<Phase, [number, number]> = {
  idle: [IDLE_SEGMENT_DASH, IDLE_SEGMENT_GAP],
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
  wifiA: { d: 'M 24 42 C 38 29 62 29 76 42', len: 70 },
  wifiB: { d: 'M 35 53 C 44 45 56 45 65 53', len: 45 },
  wifiC: { d: 'M 48 64 L 52 64', len: 12 },
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

let loadingIndicatorVisualInstance = 0;

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

interface SegmentCascade {
  /** Completed count before the latest change — the base of the current
   *  batch, i.e. the value the previous committed render showed. */
  batchBase: number;
  /** Cascade slot (0-based) for a segment index: its position within the
   *  newly-completing batch, or 0 for segments outside the batch. */
  cascadeOrderFor: (index: number) => number;
  /** Extra stagger so the last segment of the final batch has started its
   *  fill before the success disc resolves. */
  finalBatchTailMs: number;
}

/**
 * Cascade trick: when several segments complete in the same frame, fill them
 * one at a time. Track the completed count before the latest change so each
 * newly-completing segment can be delayed by its position within the batch —
 * purely a visual stagger, the leg state still flips all at once.
 *
 * Render-adjust previous-value pattern: the batch base is captured in the
 * SAME render the count flips and stays put until the next flip. The old
 * version wrote the previous count to a ref from a useEffect, so the first
 * re-render after the effect flush recomputed the cascade delays and
 * `resultDelayMs` with a caught-up base — shrinking the delays mid-flight
 * and re-firing the phase choreography with the mistimed values.
 */
function useSegmentCascade(completedSegments: number): SegmentCascade {
  const [prevCompleted, setPrevCompleted] = React.useState(completedSegments);
  // The base starts at 0 so a fresh mount with already-completed segments
  // still cascades them in (legacy mount behavior).
  const [batchBase, setBatchBase] = React.useState(0);
  if (completedSegments !== prevCompleted) {
    // Adjusting state during render: React restarts the render immediately,
    // so the committed output always sees a base consistent with the new
    // count — never a stale ref waiting on an effect flush.
    setPrevCompleted(completedSegments);
    setBatchBase(prevCompleted);
  }
  const base = completedSegments !== prevCompleted ? prevCompleted : batchBase;
  return {
    batchBase: base,
    cascadeOrderFor: (index: number) =>
      index >= base && index < completedSegments ? index - base : 0,
    finalBatchTailMs: Math.max(0, completedSegments - base - 1) * SEGMENT_STAGGER_MS,
  };
}

interface ConfirmationSegmentProps {
  index: number;
  segmentCount: number;
  completed: boolean;
  /** The next-to-complete segment — breathes a subtle pulse to read "in progress". */
  active: boolean;
  pendingColor: string;
  successColor: string;
  delayMs: number;
  /** Full-thickness stroke in viewBox units (see `effectiveSegmentStroke`). */
  stroke: number;
  /** True when the stroke targets a fixed px width and must match
   *  neighbouring strokes: pending arcs keep full weight (instead of the
   *  grow-on-fill thinning) and seams scale with the stroke. */
  pxTargeted: boolean;
  onDebugEvent?: (event: string, params: Record<string, unknown>) => void;
}

function ConfirmationSegment({
  index,
  segmentCount,
  completed,
  active,
  pendingColor,
  successColor,
  delayMs,
  stroke,
  pxTargeted,
  onDebugEvent,
}: ConfirmationSegmentProps): React.ReactElement {
  // Latest-callback ref: the parent recreates the closure every render; the
  // ref keeps it out of the animation effects' dependency arrays so logging
  // can never re-trigger a fill or breathe.
  const debugEventRef = React.useRef(onDebugEvent);
  debugEventRef.current = onDebugEvent;
  // Render-time snapshot of geometry for the logs — kept in a ref so logging
  // extra fields never widens the animation effects' dependency arrays.
  const debugMetaRef = React.useRef({ index, segmentCount, stroke, pxTargeted });
  debugMetaRef.current = { index, segmentCount, stroke, pxTargeted };
  const wasBreathingRef = React.useRef(false);
  const progress = useSharedValue(completed ? 1 : 0);
  const pulse = useSharedValue(0);
  // Looping breathe for the active (next) segment; 0 when inactive/completed.
  const activePulse = useSharedValue(0);
  const wasCompletedRef = React.useRef(completed);
  const mountedRef = React.useRef(false);
  // Read the latest delay at flip time without making it an effect dependency:
  // the parent's cascade delay for this segment is stable between batches but
  // changes again on the next batch flip (its cascade slot resets to 0), and
  // only an actual completed→ transition should (re)fire the fill+pulse —
  // otherwise a delay change alone would re-pulse an already-filled segment.
  // Together with wasCompletedRef/mountedRef this keeps the fill effect keyed
  // to real `completed` flips, not to dependency identity.
  const delayRef = React.useRef(delayMs);
  delayRef.current = delayMs;
  // Dash/seam geometry comes from the shared module — see `segmentDash` for
  // the seam policy and the dash-centering rationale.
  const { strokeDasharray, strokeDashoffset } = segmentDash(
    index,
    segmentCount,
    stroke,
    pxTargeted
  );
  const pendingScale = pendingStrokeScale(pxTargeted);

  useEffect(() => {
    const firstMount = !mountedRef.current;
    const transitioned = completed !== wasCompletedRef.current;
    mountedRef.current = true;
    wasCompletedRef.current = completed;
    // Animate only when `completed` actually changes (or on the first mount, to
    // settle into the initial state). The parent staggers the delay so a batch
    // of segments completing in the same frame still fills one at a time.
    if (!transitioned && !firstMount) return;
    const segmentDelay = delayRef.current;

    debugEventRef.current?.('dot.segment_fill', {
      segmentIndex: debugMetaRef.current.index,
      segmentCount: debugMetaRef.current.segmentCount,
      strokeUnits: debugMetaRef.current.stroke,
      pxTargeted: debugMetaRef.current.pxTargeted,
      completed,
      firstMount,
      transitioned,
      delayMs: segmentDelay,
      fillDurationMs: SEGMENT_ANIM_MS,
      completionPulse: completed,
      pulseMs: SEGMENT_PULSE_MS,
    });

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
  }, [completed, progress, pulse]);

  useEffect(() => {
    // Under Android e2e the perpetual breathe keeps the window from idling, so
    // uiautomator can't dump a screen with an in-progress segment. Leave it flat.
    if (active && !completed && !IS_ANDROID_E2E) {
      wasBreathingRef.current = true;
      debugEventRef.current?.('dot.segment_breathe', {
        segmentIndex: debugMetaRef.current.index,
        segmentCount: debugMetaRef.current.segmentCount,
        breathing: true,
        halfCycleMs: SEGMENT_ACTIVE_PULSE_MS,
      });
      activePulse.set(
        withRepeat(
          withTiming(1, { duration: SEGMENT_ACTIVE_PULSE_MS, easing: Easing.inOut(Easing.ease) }),
          -1,
          true
        )
      );
    } else {
      if (wasBreathingRef.current) {
        wasBreathingRef.current = false;
        debugEventRef.current?.('dot.segment_breathe', {
          segmentIndex: debugMetaRef.current.index,
          segmentCount: debugMetaRef.current.segmentCount,
          breathing: false,
          reason: completed ? 'completed' : 'no-longer-active',
          settleMs: SEGMENT_PULSE_MS,
        });
      }
      activePulse.set(
        withTiming(0, { duration: SEGMENT_PULSE_MS, easing: Easing.inOut(Easing.ease) })
      );
    }
  }, [active, completed, activePulse]);

  const animatedProps = useAnimatedProps(() => {
    const p = progress.get();
    // The breathe only applies to a not-yet-filled segment; it fades out as the
    // segment fills (`1 - p`) so a completing segment hands off cleanly.
    const breathe = (1 - p) * activePulse.get();
    return {
      // Px-targeted rings match surrounding chrome (rail track) at full
      // opacity — the pending→success colour alone marks the fill; the
      // default fades pending arcs instead.
      opacity: pxTargeted ? 1 : 0.45 + p * 0.55 + breathe * 0.32,
      // Push the pending colour partway toward success while breathing — a subtle
      // tint, not a full fill (which is reserved for actual completion).
      stroke: interpolateColor(p + breathe * 0.5, [0, 1], [pendingColor, successColor]),
      // Grow from a thinner pending arc to the full thickness as it fills, with
      // a brief pulse-thicken at completion and a gentle swell while active.
      strokeWidth:
        stroke * (pendingScale + p * (1 - pendingScale)) + pulse.get() * 1.6 + breathe * 0.7,
    };
  });

  return (
    <AnimatedCircle
      testID={`loading-indicator-confirmation-segment-${index}`}
      cx={50}
      cy={50}
      r={RING_R}
      fill="none"
      strokeLinecap="round"
      strokeDasharray={strokeDasharray}
      strokeDashoffset={strokeDashoffset}
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
  warningColor,
  transitionDelayMs = 0,
  playOnMount = false,
  segmentedProgress,
  confirmationProgress,
  segmentedInProgress = true,
  strokeWidthPx,
  pendingColor,
  onDebugEvent,
  visualScope = 'loading.status_indicator',
  visualKey,
  visualSurface = 'shared',
  visualComponent = 'LoadingIndicator',
  visualPhase,
  visualExtra,
  visualDisabled,
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
  const warnColor = warningColor ?? themeWarning;
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
  // Segment fill stagger + result-disc hold — see `useSegmentCascade`. The
  // batch base is computed in the same render the completed count flips, so
  // the delays it feeds ConfirmationSegment and `resultDelayMs` can never
  // read a stale previous value.
  const segCompleted = normalizedSegmentedProgress?.completedSegments ?? 0;
  const {
    batchBase: prevSegCompleted,
    cascadeOrderFor,
    finalBatchTailMs,
  } = useSegmentCascade(segCompleted);

  // ── Verbose diagnostics ────────────────────────────────────────────────
  // Latest-callback + render-snapshot refs: logging must never widen an
  // animation effect's dependency array (that would re-fire choreography on
  // unrelated re-renders), so effects read these refs instead of props.
  const debugEventRef = React.useRef(onDebugEvent);
  debugEventRef.current = onDebugEvent;
  const debugSnapshotRef = React.useRef<Record<string, unknown>>({});

  // ── Unfilled-stroke chrome ─────────────────────────────────────────────
  // Single owner for how non-result strokes render — the idle dash ring, the
  // loading arc, and the pending segment arcs alike. `strokeWidthPx` switches
  // the whole indicator into chrome-matching mode (weight, seams, full
  // opacity) and `pendingColor` supplies the chrome colour; keep every such
  // decision here so the two ring implementations cannot drift apart again.
  const strokeUnits = strokeUnitsForPx(strokeWidthPx, size);
  const pxTargeted = strokeUnits != null;
  const unfilledColor = pendingColor ?? ringColor;
  const ringStrokeUnits = strokeUnits ?? RING_STROKE;
  // Idle dash/gap/offset from the shared seam policy — same geometry source
  // as the segment rings, so the two ring styles cannot drift apart.
  const {
    dash: idleDash,
    gap: idleGap,
    strokeDashoffset: idleDashOffset,
  } = idleDashPattern(ringStrokeUnits, pxTargeted);
  // Chrome-matching renders unfilled strokes at full opacity — the muted
  // chrome colour carries the "not yet" signal, exactly like the unfilled
  // track of a neighbouring connector rail.
  const idleRingOpacity = pxTargeted ? 1 : RING_OPAC.idle;
  const segmentStrokeUnits =
    normalizedSegmentedProgress != null
      ? effectiveSegmentStroke(normalizedSegmentedProgress.segmentCount, strokeUnits)
      : null;
  // ───────────────────────────────────────────────────────────────────────

  const segmentedComplete =
    normalizedSegmentedProgress != null &&
    normalizedSegmentedProgress.completedSegments >= normalizedSegmentedProgress.segmentCount;
  const isSegmentedMode = normalizedSegmentedProgress != null;
  const renderSegmentedSegments = normalizedSegmentedProgress != null;
  const effectivePhase = segmentedComplete ? 'done' : phase;
  const effectiveResult = segmentedComplete ? 'success' : result;
  const shouldShowResult = segmentedComplete || (!isSegmentedMode && effectivePhase === 'done');
  // Hold the success disc until the last segment of the final batch has cascaded
  // in, so completing the whole ring in one frame still reads as a stagger
  // rather than an instant flip to the disc.
  const finalBatchTail = segmentedComplete ? finalBatchTailMs : 0;
  const resultDelayMs = segmentedComplete ? SEGMENT_ANIM_MS + finalBatchTail : 0;
  const resultColor =
    effectiveResult === 'error'
      ? errColor
      : effectiveResult === 'reverted'
        ? revColor
        : effectiveResult === 'warning'
          ? warnColor
          : okColor;

  debugSnapshotRef.current = {
    size,
    strokeWidthPx: strokeWidthPx ?? null,
    pxTargeted,
    ringColor,
    unfilledColor,
    resultColor,
    idleRingOpacity,
    segmentStrokeUnits,
    playOnMount,
    rawPhaseProp: phase,
    rawResultProp: result,
  };

  const visualInstanceKeyRef = React.useRef<string | null>(null);
  if (visualInstanceKeyRef.current === null) {
    loadingIndicatorVisualInstance += 1;
    visualInstanceKeyRef.current = `loading-indicator:${loadingIndicatorVisualInstance}`;
  }
  const visualLayout = useVisualLayoutLogger({
    enabled: visualDisabled !== true,
    scope: visualScope,
    surface: visualSurface,
    component: visualComponent,
    itemKey: visualKey ? visualLayoutScopePart(visualKey) : visualInstanceKeyRef.current,
    itemType: 'status-indicator',
    phase: visualPhase ?? effectivePhase,
    extra: () => ({
      size,
      phase: effectivePhase,
      result: effectiveResult,
      transitionDelayMs,
      playOnMount,
      segmented: isSegmentedMode,
      completedSegments: normalizedSegmentedProgress?.completedSegments ?? null,
      segmentCount: normalizedSegmentedProgress?.segmentCount ?? null,
      ...(typeof visualExtra === 'function' ? visualExtra() : (visualExtra ?? {})),
    }),
  });
  const handleVisualLayout = React.useCallback(
    (event: LayoutChangeEvent) => {
      visualLayout.onLayout(event);
    },
    [visualLayout]
  );

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
  const startedWarning = startedDone && startedResult === 'warning';

  React.useEffect(() => {
    debugEventRef.current?.('dot.mount', {
      // startedDone = mounted already-terminal: the draw-in choreography is
      // skipped and the resolved frame paints immediately.
      mountedTerminal: startedDone,
      mountedResult: startedResult,
      ...debugSnapshotRef.current,
    });
    return () => {
      debugEventRef.current?.('dot.unmount', {});
    };
  }, [startedDone, startedResult]);

  // Settle-to-static: once a live transition's done choreography has fully
  // played, swap the animated SVG for a static terminal frame. A Fabric
  // commit racing the UI-thread animatedProps can clobber them mid-flight
  // (observed live: a "Sent" dot stuck as a spinning grey arc under a settled
  // "Settled off-chain" row while every scheduled target was correct) — a
  // static frame cannot stay wrong. Mounted-already-terminal dots keep the
  // existing initialized-values render (no scheduled animation to clobber).
  const [settledStatic, setSettledStatic] = React.useState(false);

  // One entry per segmented-ring change: which segments newly fill, the
  // cascade stagger, and which segment breathes "in progress".
  const lastLoggedSegmentsRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!normalizedSegmentedProgress) return;
    const signature = `${normalizedSegmentedProgress.completedSegments}/${normalizedSegmentedProgress.segmentCount}|${segmentedInProgress}|${segmentedComplete}`;
    if (lastLoggedSegmentsRef.current === signature) return;
    const firstLog = lastLoggedSegmentsRef.current === null;
    lastLoggedSegmentsRef.current = signature;
    debugEventRef.current?.('dot.segments', {
      firstLog,
      completedSegments: normalizedSegmentedProgress.completedSegments,
      segmentCount: normalizedSegmentedProgress.segmentCount,
      prevCompletedSegments: prevSegCompleted,
      newlyCompleting: Math.max(
        0,
        normalizedSegmentedProgress.completedSegments - prevSegCompleted
      ),
      cascadeStaggerMs: SEGMENT_STAGGER_MS,
      fillDurationMs: SEGMENT_ANIM_MS,
      segmentedInProgress,
      breathingSegmentIndex:
        segmentedInProgress &&
        normalizedSegmentedProgress.completedSegments < normalizedSegmentedProgress.segmentCount
          ? normalizedSegmentedProgress.completedSegments
          : null,
      ringComplete: segmentedComplete,
      resultDelayMs,
      transitionDelayMs,
    });
  }, [
    normalizedSegmentedProgress,
    prevSegCompleted,
    segmentedInProgress,
    segmentedComplete,
    resultDelayMs,
    transitionDelayMs,
  ]);

  const dashA = useSharedValue(startedDone ? DASH.done[0] : idleDash);
  const dashB = useSharedValue(startedDone ? DASH.done[1] : idleGap);
  const ringOpac = useSharedValue(startedDone ? RING_OPAC.done : idleRingOpacity);
  const colorProgress = useSharedValue(startedDone ? 1 : 0);

  const rotation = useSharedValue(0);
  const speed = useSharedValue(0);
  const targetSpeed = useSharedValue(0);

  const fillOpac = useSharedValue(startedDone ? 1 : 0);
  const fillScale = useSharedValue(startedDone ? 1 : 0.78);

  const checkOff = useSharedValue(startedSuccess ? 0 : ICON.check.len);
  const xOff = useSharedValue(startedError ? 0 : ICON.xA.len);
  const revertOff = useSharedValue(startedReverted ? 0 : ICON.revert.len);
  const wifiOff = useSharedValue(startedWarning ? 0 : ICON.wifiA.len);

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
    if (!shouldShowResult || startedDone) {
      setSettledStatic(false);
      return;
    }
    // The full done choreography: ring close (750ms overlaps), disc, then the
    // glyph finishes at d + resultDelay + T_ICON + D_ICON_IN. Small margin,
    // then freeze the frame statically.
    const settleAtMs = transitionDelayMs + resultDelayMs + T_ICON + D_ICON_IN + 200;
    const timer = setTimeout(() => {
      debugEventRef.current?.('dot.settled_static', { settleAtMs });
      // Park the spin loop — the static frame doesn't rotate, and settled
      // dots shouldn't keep the frame callback busy.
      targetSpeed.set(0);
      speed.set(0);
      setSettledStatic(true);
    }, settleAtMs);
    return () => clearTimeout(timer);
  }, [shouldShowResult, startedDone, transitionDelayMs, resultDelayMs, targetSpeed, speed]);

  useEffect(() => {
    const d = transitionDelayMs;
    const t = (
      target: number,
      config: { duration: number; easing: EasingFunction | EasingFunctionFactory }
    ) => (d > 0 ? withDelay(d, withTiming(target, config)) : withTiming(target, config));

    const [a, b] = effectivePhase === 'idle' ? [idleDash, idleGap] : DASH[effectivePhase];
    dashA.set(t(a, { duration: D_RING, easing: E_RING }));
    dashB.set(t(b, { duration: D_RING, easing: E_RING }));
    ringOpac.set(
      t(effectivePhase === 'idle' ? idleRingOpacity : RING_OPAC[effectivePhase], {
        duration: D_OPAC,
        easing: E_DEF,
      })
    );
    // Under Android e2e the perpetual loading spin never lets the window reach
    // idle, so uiautomator can't dump any screen showing an in-progress
    // indicator (e.g. a pending send's timeline dot). Freeze the arc — the
    // phase/result semantics stay intact for assertions; only the rotation stops.
    const nextSpeed = isSegmentedMode || IS_ANDROID_E2E ? 0 : SPEED[effectivePhase];

    // Segmented rings are anchored: segment 0 starts at 12 o'clock and fills
    // clockwise (the segment dash geometry pairs with rotate(-90)). A leftover
    // spin angle from a preceding loading phase (e.g. "Broadcasting…" →
    // mempool ring) would rotate the WHOLE ring — and the breathing segment
    // with it — to wherever the spinner happened to stop. Kill the spin loop
    // and settle the wrapper to the nearest upright turn.
    if (isSegmentedMode) {
      // Immediately, not behind transitionDelayMs — otherwise the frame
      // callback sees the stale nonzero targetSpeed and spins back up,
      // fighting the settle animation below.
      speed.set(0);
      targetSpeed.set(0);
      const leftover = rotation.get() % 360;
      if (leftover !== 0) {
        rotation.set(withTiming(leftover > 180 ? 360 : 0, { duration: D_OPAC, easing: E_DEF }));
      }
    }

    debugEventRef.current?.('dot.transition', {
      effectivePhase,
      effectiveResult,
      transitionDelayMs: d,
      segmentedMode: isSegmentedMode,
      // What this run schedules on the UI thread:
      ringDashTarget: [a, b],
      ringDashDurationMs: D_RING,
      ringOpacityTarget: effectivePhase === 'idle' ? idleRingOpacity : RING_OPAC[effectivePhase],
      spinTargetSpeed: nextSpeed,
      showsResult: shouldShowResult,
      resultDelayMs,
      // Disc + glyph choreography (only meaningful when showsResult):
      discAnim: shouldShowResult
        ? {
            startsAtMs: d + resultDelayMs + T_FILL,
            fadeInMs: D_FILL_IN,
            scaleInMs: D_FILL_SCALE,
          }
        : { fadeOutMs: D_FILL_OUT },
      glyphDrawnIn: shouldShowResult ? effectiveResult : null,
      glyphStartsAtMs: shouldShowResult ? d + resultDelayMs + T_ICON : null,
      glyphDrawMs: shouldShowResult ? D_ICON_IN : D_ICON_OUT,
      ...debugSnapshotRef.current,
    });

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
      wifiOff.set(effectiveResult === 'warning' ? drawIn() : undraw(ICON.wifiA.len));
    } else {
      colorProgress.set(t(0, { duration: D_FILL_OUT, easing: E_DEF }));
      fillOpac.set(t(0, { duration: D_FILL_OUT, easing: E_DEF }));
      fillScale.set(t(0.78, { duration: D_FILL_OUT, easing: E_DEF }));
      checkOff.set(t(ICON.check.len, { duration: D_ICON_OUT, easing: E_DEF }));
      xOff.set(t(ICON.xA.len, { duration: D_ICON_OUT, easing: E_DEF }));
      revertOff.set(t(ICON.revert.len, { duration: D_ICON_OUT, easing: E_DEF }));
      wifiOff.set(t(ICON.wifiA.len, { duration: D_ICON_OUT, easing: E_DEF }));
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
    speed,
    rotation,
    targetSpeed,
    isSegmentedMode,
    shouldShowResult,
    resultDelayMs,
    normalizedSegmentedProgress,
    idleDash,
    idleGap,
    idleRingOpacity,
    colorProgress,
    fillOpac,
    fillScale,
    checkOff,
    xOff,
    revertOff,
    wifiOff,
  ]);

  const ringStrokeAP = useAnimatedProps(() => ({
    strokeDasharray: [dashA.get(), dashB.get()],
    opacity: ringOpac.get(),
    // Every non-result phase wears the unfilled chrome colour (idle dashes
    // AND the spinning loading arc); done blends chrome → result, so a chrome
    // dot never flashes the foreground while resolving.
    stroke: interpolateColor(colorProgress.get(), [0, 1], [unfilledColor, resultColor]),
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
    // The disc colourises from the same chrome the ring wears, so resolving
    // never flashes the foreground in between.
    fill: interpolateColor(colorProgress.get(), [0, 1], [unfilledColor, resultColor]),
  }));

  const checkAP = useAnimatedProps(() => ({ strokeDashoffset: checkOff.get() }));
  const xAP = useAnimatedProps(() => ({ strokeDashoffset: xOff.get() }));
  const revertAP = useAnimatedProps(() => ({ strokeDashoffset: revertOff.get() }));
  const wifiAP = useAnimatedProps(() => ({ strokeDashoffset: wifiOff.get() }));
  // The success disc must still cover the thickest arc it replaces, including
  // an override-thickened segment ring. `segmentStrokeUnits` is null exactly
  // when the indicator is not segmented, so the plain ring keeps RING_R.
  const discRadius = resultDiscRadius(segmentStrokeUnits);

  // Static terminal frame (see the settle effect above): the exact end state
  // of the done choreography — result-colored ring halo (non-segmented; the
  // disc covers segment arcs), filled disc, fully-drawn glyph cut out via
  // mask — with zero animated nodes left to go stale.
  if (settledStatic && shouldShowResult) {
    return (
      <View
        ref={visualLayout.ref}
        collapsable={false}
        style={{ width: size, height: size }}
        onLayout={handleVisualLayout}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <Mask id="iconMaskStatic">
              <Rect width={100} height={100} fill="white" />
              {effectiveResult === 'success' && (
                <Path
                  d={ICON.check.d}
                  stroke="black"
                  strokeWidth={ICON_STROKE}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              )}
              {effectiveResult === 'error' && (
                <>
                  <Path
                    d={ICON.xA.d}
                    stroke="black"
                    strokeWidth={ICON_STROKE}
                    strokeLinecap="round"
                    fill="none"
                  />
                  <Path
                    d={ICON.xB.d}
                    stroke="black"
                    strokeWidth={ICON_STROKE}
                    strokeLinecap="round"
                    fill="none"
                  />
                </>
              )}
              {effectiveResult === 'reverted' && (
                <Path
                  d={ICON.revert.d}
                  stroke="black"
                  strokeWidth={ICON_STROKE}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  transform={ICON.revert.transform}
                />
              )}
              {effectiveResult === 'warning' && (
                <>
                  <Path
                    d={ICON.wifiA.d}
                    stroke="black"
                    strokeWidth={ICON_STROKE}
                    strokeLinecap="round"
                    fill="none"
                  />
                  <Path
                    d={ICON.wifiB.d}
                    stroke="black"
                    strokeWidth={ICON_STROKE}
                    strokeLinecap="round"
                    fill="none"
                  />
                  <Path
                    d={ICON.wifiC.d}
                    stroke="black"
                    strokeWidth={ICON_STROKE}
                    strokeLinecap="round"
                    fill="none"
                  />
                </>
              )}
            </Mask>
          </Defs>
          {!isSegmentedMode && (
            <Circle
              cx={50}
              cy={50}
              r={RING_R}
              fill="none"
              stroke={resultColor}
              strokeWidth={ringStrokeUnits}
            />
          )}
          <Circle cx={50} cy={50} r={discRadius} fill={resultColor} mask="url(#iconMaskStatic)" />
        </Svg>
      </View>
    );
  }

  return (
    <View
      ref={visualLayout.ref}
      collapsable={false}
      style={{ width: size, height: size }}
      onLayout={handleVisualLayout}>
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
              <AnimatedPath
                d={ICON.wifiA.d}
                stroke="black"
                strokeWidth={ICON_STROKE}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={ICON.wifiA.len}
                animatedProps={wifiAP}
              />
              <AnimatedPath
                d={ICON.wifiB.d}
                stroke="black"
                strokeWidth={ICON_STROKE}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={ICON.wifiA.len}
                animatedProps={wifiAP}
              />
              <AnimatedPath
                d={ICON.wifiC.d}
                stroke="black"
                strokeWidth={ICON_STROKE}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={ICON.wifiA.len}
                animatedProps={wifiAP}
              />
            </Mask>
          </Defs>
          <AnimatedCircle
            cx={50}
            cy={50}
            r={discRadius}
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
              Array.from({ length: normalizedSegmentedProgress.segmentCount }, (_, index) => {
                // Stagger only the segments newly completing in this batch; ones
                // already filled (or still pending) keep the base delay.
                const cascadeOrder = cascadeOrderFor(index);
                return (
                  <ConfirmationSegment
                    key={index}
                    index={index}
                    segmentCount={normalizedSegmentedProgress.segmentCount}
                    completed={index < normalizedSegmentedProgress.completedSegments}
                    // The first not-yet-filled segment breathes to show the step
                    // in progress; nothing breathes once the ring is complete or
                    // while the ring is only previewing a step that hasn't started.
                    active={
                      segmentedInProgress && index === normalizedSegmentedProgress.completedSegments
                    }
                    pendingColor={unfilledColor}
                    successColor={okColor}
                    delayMs={transitionDelayMs + cascadeOrder * SEGMENT_STAGGER_MS}
                    stroke={
                      segmentStrokeUnits ?? segmentStroke(normalizedSegmentedProgress.segmentCount)
                    }
                    pxTargeted={pxTargeted}
                    onDebugEvent={onDebugEvent}
                  />
                );
              })
            ) : null
          ) : (
            <AnimatedCircle
              cx={50}
              cy={50}
              r={RING_R}
              fill="none"
              strokeWidth={ringStrokeUnits}
              strokeLinecap="round"
              // Same seam frame as the segment ring: start at 12 o'clock and
              // center each idle dash within its step, so the six seams land
              // symmetrically instead of trailing from the SVG path start at
              // 3 o'clock. Loading spins via the wrapper and done is a full
              // circle, so the offset is inert outside idle.
              strokeDashoffset={idleDashOffset}
              transform="rotate(-90 50 50)"
              animatedProps={ringStrokeAP}
            />
          )}
        </Svg>
      </Animated.View>
    </View>
  );
}

export default LoadingIndicator;
