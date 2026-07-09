/**
 * Pure ring/seam/dash geometry for `LoadingIndicator`.
 *
 * No React, no Reanimated — every number the indicator's two ring
 * implementations share (the single idle/loading dash ring and the
 * per-segment confirmation ring) lives here so their seam and stroke
 * policies cannot drift apart again. The numeric outputs were device-tuned
 * (4c6d6ce4/cf7ea0e2/35f25f27/67552693/a2d2aa97) and are pinned by
 * `app/__tests__/ringGeometry.test.ts` — treat them as sacred.
 */

// Geometry tuned so the disc fills ~76% of the size box (matches the
// legacy PaymentStatusIcon's 75% disc-to-box ratio). The original demo
// used r=22 (44% of size) which made the icons render visibly smaller
// than the static `mdi:check-circle` Icon at the same size.
export const RING_R = 38;
export const CIRC = 2 * Math.PI * RING_R;
export const RING_STROKE = 3.5;
// Segment arc thickness scales inversely with the segment count: a handful
// of onchain-confirmation segments render thick and chunky, while a dense
// 24-segment ring stays legible. See `segmentStroke()`.
export const SEGMENT_STROKE_MIN = 4.5;
export const SEGMENT_STROKE_MAX = 8.5;
// Pending arcs render thinner than completed ones so a filling segment reads
// as growing to full weight. Px-targeted rings skip the thinning: they must
// match neighbouring chrome (rail track) at full weight.
export const SEGMENT_PENDING_SCALE = 0.72;

// Idle ring reads as a handful of discrete arc segments (echoing the
// segmented confirmation ring) rather than a fine dotted hairline. Six
// evenly spaced dashes around the circumference — `dash + gap` divides
// CIRC exactly, so the seams land symmetrically and don't drift.
export const IDLE_SEGMENT_COUNT = 6;
export const IDLE_SEGMENT_GAP = 13;
export const IDLE_SEGMENT_DASH = CIRC / IDLE_SEGMENT_COUNT - IDLE_SEGMENT_GAP;

/** Static SVG dash geometry for one ring stroke: `strokeDasharray` tuple plus
 *  the `strokeDashoffset` that centers each dash within its step. */
export interface RingDashPattern {
  /** Visible dash length in viewBox units. */
  dash: number;
  /** Seam gap in viewBox units (dasharray gap for the idle ring; step gap
   *  between neighbouring arcs for a segment ring). */
  gap: number;
  strokeDasharray: [number, number];
  strokeDashoffset: number;
}

/** Convert a target on-screen stroke width in px into viewBox units for the
 *  given indicator size, or `null` when no valid px target is set (keeping
 *  the viewBox-relative defaults). */
export function strokeUnitsForPx(
  strokeWidthPx: number | null | undefined,
  size: number
): number | null {
  return strokeWidthPx != null && strokeWidthPx > 0 && size > 0
    ? (strokeWidthPx * 100) / size
    : null;
}

/** Default segment stroke in viewBox units for a given segment count. */
export function segmentStroke(segmentCount: number): number {
  return Math.max(SEGMENT_STROKE_MIN, Math.min(SEGMENT_STROKE_MAX, 54 / segmentCount));
}

/** Segment stroke in viewBox units, honouring a `strokeWidthPx` override.
 *  The override is clamped so round line caps (which extend each dash by
 *  stroke/2 per end) cannot swallow the seams on dense rings. */
export function effectiveSegmentStroke(segmentCount: number, overrideUnits: number | null): number {
  const base = segmentStroke(segmentCount);
  if (overrideUnits == null) return base;
  const step = CIRC / segmentCount;
  return Math.min(overrideUnits, Math.max(base, step * 0.5 - 2));
}

/** THE seam-gap policy — the one place the dasharray gap between arcs is
 *  decided, shared by idle dashes and segment rings alike. Round caps extend
 *  each dash by stroke/2 per end, so the gap the eye sees is `gap - stroke`.
 *  Px-targeted strokes scale that visible gap with the stroke (0.75×,
 *  matching the sparse-ring look) so every ring style shows the same seam
 *  weight; the default keeps the legacy proportional policy. */
export function segmentGapUnits(step: number, stroke: number, pxTargeted: boolean): number {
  if (!pxTargeted) return Math.min(step * 0.5, Math.max(stroke + 4, step * 0.22));
  const visibleGap = Math.max(4, stroke * 0.75);
  return stroke + Math.max(0, Math.min(visibleGap, step - stroke - 1));
}

/** Idle-ring dash gap: px-targeted rings recompute the gap from the stroke
 *  via the shared seam policy (or the six dashes merge into a solid circle
 *  under round caps); the default keeps the tuned constant. */
export function idleGapUnits(ringStrokeUnits: number, pxTargeted: boolean): number {
  return pxTargeted
    ? segmentGapUnits(CIRC / IDLE_SEGMENT_COUNT, ringStrokeUnits, true)
    : IDLE_SEGMENT_GAP;
}

/** Dash pattern for the single idle/loading ring. The offset centers each
 *  idle dash within its step so the six seams straddle 12 o'clock and the
 *  step boundaries (pair with `rotate(-90 50 50)`); loading spins via a
 *  wrapper and done is a full circle, so the offset is inert outside idle. */
export function idleDashPattern(ringStrokeUnits: number, pxTargeted: boolean): RingDashPattern {
  const gap = idleGapUnits(ringStrokeUnits, pxTargeted);
  const dash = CIRC / IDLE_SEGMENT_COUNT - gap;
  return { dash, gap, strokeDasharray: [dash, gap], strokeDashoffset: -gap / 2 };
}

/** Dash pattern for one arc of a segmented ring. The gap widens with the
 *  stroke so round line caps don't close the seams between thick segments
 *  and blur the ring into one continuous arc; a single-segment ring draws
 *  the full circle. The offset centers each dash within its step so the
 *  seams straddle the step boundaries (12 o'clock and every step after it)
 *  — starting the dash AT the boundary would push the whole gap to the
 *  trailing side and the ring would read as rotated by half a gap. */
export function segmentDash(
  index: number,
  segmentCount: number,
  strokeUnits: number,
  pxTargeted: boolean
): RingDashPattern {
  const step = CIRC / segmentCount;
  const gap = segmentCount === 1 ? 0 : segmentGapUnits(step, strokeUnits, pxTargeted);
  const dash = Math.max(1, step - gap);
  return {
    dash,
    gap,
    strokeDasharray: [dash, CIRC - dash],
    strokeDashoffset: -(index * step + gap / 2),
  };
}

/** Rest-weight multiplier for a pending (not yet completed) segment arc.
 *  Px-targeted rings keep full weight — the muted chrome colour alone marks
 *  "not yet" — while the default thins pending arcs so a filling segment
 *  reads as growing to full thickness. */
export function pendingStrokeScale(pxTargeted: boolean): number {
  return pxTargeted ? 1 : SEGMENT_PENDING_SCALE;
}

/** Radius of the result disc: it must still cover the thickest arc it
 *  replaces, including an override-thickened segment ring. Pass `null` for
 *  the non-segmented indicator. */
export function resultDiscRadius(segmentStrokeUnits: number | null): number {
  return segmentStrokeUnits == null
    ? RING_R
    : RING_R + Math.max(SEGMENT_STROKE_MAX, segmentStrokeUnits) / 2;
}
