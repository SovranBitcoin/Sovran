// ---------------------------------------------------------------------------
// Timeline theme — THE one metric/timing table for the timeline renderer
// ---------------------------------------------------------------------------
//
// Every px metric and animation timing the timeline draws with lives here so
// the dot chrome, connector rail, and label block cannot drift apart. The
// values are pinned by __tests__/historyEntryTimelineLine.test.tsx (3px rails,
// marginVertical 4, -3 label margins) and the timelineScenarioProps snapshots.

import { Easing, FadeIn, FadeOut } from 'react-native-reanimated';

import type { TimelineStep } from 'wallet';

/** Stroke thickness shared by the connector rail AND the LoadingIndicator's
 *  `strokeWidthPx` so dot rings/segments and the rail read as one weight. */
export const STROKE_PX = 3;
export const RAIL_HEIGHT = 50;
export const RAIL_MARGIN_VERTICAL = 4;
export const DOT_SIZE = 20;
// Top-aligns every label's cap height with the top of its 20px dot. One
// constant for ALL step types: the old future-small special case (-7) made a
// step's label jump 4px the moment it went active and gained its sublabel.
export const CONTENT_MARGIN_TOP = -3;
/** Cascade: each row's dot transition waits one stagger per row index… */
export const DOT_STAGGER_MS = 300;
/** …and its connector rail starts half a stagger after its dot. */
export const LINE_OFFSET_MS = 150;
/** Row / label-block entrance+exit crossfade duration. */
export const FADE_MS = 220;
export const LINE_ANIM_MS = 400;
export const LINE_TIMING = {
  duration: LINE_ANIM_MS,
  easing: Easing.out(Easing.cubic),
};

export type TimelineLineType = 'complete' | 'future' | 'expired-gradient' | 'rolled-back-gradient';

// Mirrors wallet's isSettledStepType (wallet/src/history/timeline/classify.ts):
// the "completed-ish" step types the flow has arrived at or passed. The wallet
// helper is not exported from the package root (types are frozen for P4), so
// the set is duplicated here — keep it in sync with SETTLED_STEP_TYPES.
const SETTLED_STEP_TYPES: ReadonlySet<TimelineStep['stepType']> = new Set([
  'complete',
  'current',
  'waiting',
  'success',
]);

/** Connector rail style between a row and the row below it. Expired /
 *  rolled-back / already-spent rows pull a gradient fill into the outcome
 *  colour; two settled-ish rows share a solid success fill; anything else
 *  leaves the rail unfilled. */
export function connectorType(
  prev: Pick<TimelineStep, 'stepType'>,
  next: Pick<TimelineStep, 'stepType'>
): TimelineLineType {
  if (next.stepType === 'expired') return 'expired-gradient';
  if (next.stepType === 'already-spent') return 'rolled-back-gradient';
  if (next.stepType === 'rolled-back') return 'rolled-back-gradient';
  if (SETTLED_STEP_TYPES.has(prev.stepType) && SETTLED_STEP_TYPES.has(next.stepType)) {
    return 'complete';
  }
  return 'future';
}

/** Left→right cascade delays for a row: the dot completes, then its rail
 *  fills, then the next dot activates. */
export function rowDelays(index: number): { dotDelayMs: number; lineDelayMs: number } {
  const dotDelayMs = index * DOT_STAGGER_MS;
  return { dotDelayMs, lineDelayMs: dotDelayMs + LINE_OFFSET_MS };
}

/** Symmetric row / label-block transitions. Entrance fades only play after
 *  the initial mount (opening the screen paints the timeline statically);
 *  exits always fade — preserving the old renderer's observable behavior,
 *  just centralized. */
export function rowTransitions(hasMounted: boolean): {
  entering: ReturnType<typeof FadeIn.duration> | undefined;
  exiting: ReturnType<typeof FadeOut.duration>;
} {
  return {
    entering: hasMounted ? FadeIn.duration(FADE_MS) : undefined,
    exiting: FadeOut.duration(FADE_MS),
  };
}
