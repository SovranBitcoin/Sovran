/**
 * @jest-environment node
 *
 * Parity pins for `app/shared/blocks/status/ringGeometry.ts`.
 *
 * The expected numbers below were extracted VERBATIM from the formulas that
 * lived inline in LoadingIndicator.tsx before the geometry extraction
 * (`segmentStroke` / `effectiveSegmentStroke` / `segmentGapUnits` / the
 * per-segment dash+offset math in ConfirmationSegment / the idle-ring gap at
 * ~L510 / `strokeUnits = strokeWidthPx*100/size`). They are device-tuned
 * outputs (commits 4c6d6ce4/cf7ea0e2/35f25f27/67552693/a2d2aa97) — if this
 * test fails, the fix is in ringGeometry.ts, never here.
 *
 * Configs pinned:
 * - the transaction-timeline dot (HistoryEntryTimeline: size 20,
 *   strokeWidthPx 3 → 15 viewBox units, px-targeted), segment counts 1..24;
 * - the default consumers (StatusToast / DeleteStatusToast / design-system
 *   screens: no strokeWidthPx), segment counts 1..24;
 * - both idle-ring variants (px-targeted timeline dot and the viewBox
 *   default used by SettingsRecoveryScreen, TransferStepChain, MintAddScreen…).
 */

import {
  CIRC,
  IDLE_SEGMENT_COUNT,
  IDLE_SEGMENT_DASH,
  IDLE_SEGMENT_GAP,
  RING_R,
  RING_STROKE,
  SEGMENT_PENDING_SCALE,
  SEGMENT_STROKE_MAX,
  SEGMENT_STROKE_MIN,
  effectiveSegmentStroke,
  idleDashPattern,
  idleGapUnits,
  pendingStrokeScale,
  resultDiscRadius,
  segmentDash,
  segmentGapUnits,
  segmentStroke,
  strokeUnitsForPx,
} from '@/shared/blocks/status/ringGeometry';

/** [segmentCount, stroke, gap, dash, dasharrayRest, offsetIndex0, offsetIndexLast] */
type PinRow = [number, number, number, number, number, number, number];

// Timeline ring: size 20 / strokeWidthPx 3 → strokeUnits 15, pxTargeted.
const PX_SEGMENTS: PinRow[] = [
  [1, 15, 0, 238.76104167282426, 0, 0, 0],
  [2, 15, 26.25, 93.13052083641213, 145.63052083641213, -13.125, -132.50552083641213],
  [3, 15, 26.25, 53.33701389094142, 185.42402778188284, -13.125, -172.29902778188284],
  [4, 15, 26.25, 33.440260418206066, 205.3207812546182, -13.125, -192.1957812546182],
  [5, 15, 26.25, 21.502208334564855, 217.25883333825942, -13.125, -204.13383333825942],
  [6, 15, 26.25, 13.54350694547071, 225.21753472735355, -13.125, -212.09253472735355],
  [7, 15, 26.25, 7.858720238974897, 230.90232143384935, -13.125, -217.77732143384938],
  [
    8, 12.922565104551516, 22.614488932965152, 7.230641276137881, 231.5304003966864,
    -11.307244466482576, -220.2231559302038,
  ],
  [
    9, 11.264502315156903, 19.71287905152458, 6.816125578789226, 231.94491609403502,
    -9.85643952576229, -222.08847656827274,
  ],
  [
    10, 9.938052083641214, 17.391591146372125, 6.484513020910303, 232.27652865191396,
    -8.695795573186063, -223.58073307872792,
  ],
  [
    11, 8.852774621492012, 15.492355587611021, 6.2131936553730025, 232.54784801745126,
    -7.7461777938055105, -224.80167022364574,
  ],
  [
    12, 7.948376736367678, 13.909659288643436, 5.987094184091919, 232.77394748873235,
    -6.954829644321718, -225.8191178444106,
  ],
  [
    13, 7.183116987416318, 12.570454727978555, 5.79577924685408, 232.9652624259702,
    -6.285227363989278, -226.68003506198087,
  ],
  [
    14, 6.527180059743724, 11.422565104551516, 5.631795014935932, 233.12924665788833,
    -5.711282552275758, -227.41796410561258,
  ],
  [
    15, 5.958701389094142, 10.42772743091475, 5.4896753472735345, 233.27136632555073,
    -5.213863715457375, -228.05750261009334,
  ],
  [
    16, 5.461282552275758, 9.557244466482576, 5.36532063806894, 233.39572103475533,
    -4.778622233241288, -228.61709880151403,
  ],
  [
    17, 5.022383578612478, 9.022383578612478, 5.022383578612478, 233.7386580942118,
    -4.511191789306239, -229.22746630490556,
  ],
  [
    18, 4.632251157578452, 8.632251157578452, 4.632251157578452, 234.1287905152458,
    -4.316125578789226, -229.8126649364566,
  ],
  [19, 4.5, 8.5, 4.0663706143591725, 234.69467105846508, -4.25, -230.4446710584651],
  [20, 4.5, 8.5, 3.438052083641214, 235.32298958918304, -4.25, -231.07298958918307],
  [21, 4.5, 8.5, 2.869573412991631, 235.89146825983264, -4.25, -231.6414682598326],
  [22, 4.5, 8.5, 2.3527746214920118, 236.40826705133225, -4.25, -232.15826705133225],
  [23, 4.5, 8.5, 1.880914855340185, 236.88012681748407, -4.25, -232.63012681748407],
  [24, 4.5, 8.5, 1.4483767363676776, 237.3126649364566, -4.25, -233.0626649364566],
];

// Default consumers: no strokeWidthPx → count-scaled stroke, legacy gap policy.
const DEFAULT_SEGMENTS: PinRow[] = [
  [1, 8.5, 0, 238.76104167282426, 0, 0, 0],
  [
    2, 8.5, 26.263714584010668, 93.11680625240146, 145.6442354204228, -13.131857292005334,
    -132.51237812841745,
  ],
  [
    3, 8.5, 17.50914305600711, 62.07787083493431, 176.68317083788995, -8.754571528003556,
    -167.9285993098864,
  ],
  [
    4, 8.5, 13.131857292005334, 46.55840312620073, 192.20263854662352, -6.565928646002667,
    -185.63670990062087,
  ],
  [5, 8.5, 12.5, 35.252208334564855, 203.50883333825942, -6.25, -197.25883333825942],
  [6, 8.5, 12.5, 27.29350694547071, 211.46753472735355, -6.25, -205.21753472735355],
  [
    7, 7.714285714285714, 11.714285714285715, 22.39443452468918, 216.36660714813507,
    -5.857142857142858, -210.50946429099224,
  ],
  [8, 6.75, 10.75, 19.095130209103033, 219.66591146372122, -5.375, -214.29091146372122],
  [9, 6, 10, 16.529004630313807, 222.23203704251046, -5, -217.23203704251046],
  [10, 5.4, 9.4, 14.476104167282427, 224.28493750554185, -4.7, -219.58493750554183],
  [
    11, 4.909090909090909, 8.90909090909091, 12.796458333893113, 225.96458333893116,
    -4.454545454545455, -221.5100378843857,
  ],
  [12, 4.5, 8.5, 11.396753472735355, 227.3642882000889, -4.25, -223.1142882000889],
  [13, 4.5, 8.5, 9.866233974832635, 228.89480769799164, -4.25, -224.6448076979916],
  [14, 4.5, 8.5, 8.554360119487448, 230.2066815533368, -4.25, -225.95668155333684],
  [
    15, 4.5, 7.958701389094142, 7.958701389094142, 230.80234028373013, -3.979350694547071,
    -226.82298958918304,
  ],
  [
    16, 4.5, 7.461282552275758, 7.461282552275758, 231.29975912054852, -3.730641276137879,
    -227.5691178444106,
  ],
  [
    17, 4.5, 7.022383578612478, 7.022383578612478, 231.7386580942118, -3.511191789306239,
    -228.22746630490556,
  ],
  [
    18, 4.5, 6.632251157578452, 6.632251157578452, 232.1287905152458, -3.316125578789226,
    -228.8126649364566,
  ],
  [
    19, 4.5, 6.283185307179586, 6.283185307179586, 232.47785636564467, -3.141592653589793,
    -229.3362637120549,
  ],
  [
    20, 4.5, 5.969026041820607, 5.969026041820607, 232.79201563100366, -2.9845130209103035,
    -229.80750261009337,
  ],
  [
    21, 4.5, 5.6847867064958155, 5.6847867064958155, 233.07625496632843, -2.8423933532479078,
    -230.2338616130805,
  ],
  [
    22, 4.5, 5.426387310746006, 5.426387310746006, 233.33465436207825, -2.713193655373003,
    -230.62146070670525,
  ],
  [
    23, 4.5, 5.1904574276700925, 5.1904574276700925, 233.57058424515418, -2.5952287138350463,
    -230.9753555313191,
  ],
  [
    24, 4.5, 4.974188368183839, 4.974188368183839, 233.78685330464043, -2.4870941840919194,
    -231.29975912054852,
  ],
];

const TIMELINE_STROKE_UNITS = 15; // size 20, strokeWidthPx 3 (LINE_WIDTH)

function expectSegmentRows(rows: PinRow[], strokeUnitsOverride: number | null): void {
  const pxTargeted = strokeUnitsOverride != null;
  for (const [count, stroke, gap, dash, rest, offset0, offsetLast] of rows) {
    const actualStroke = effectiveSegmentStroke(count, strokeUnitsOverride);
    expect(actualStroke).toBeCloseTo(stroke, 10);

    const first = segmentDash(0, count, actualStroke, pxTargeted);
    const last = segmentDash(count - 1, count, actualStroke, pxTargeted);
    expect(first.gap).toBeCloseTo(gap, 10);
    expect(first.dash).toBeCloseTo(dash, 10);
    expect(first.strokeDasharray[0]).toBeCloseTo(dash, 10);
    expect(first.strokeDasharray[1]).toBeCloseTo(rest, 10);
    expect(first.strokeDashoffset).toBeCloseTo(offset0, 10);
    expect(last.strokeDashoffset).toBeCloseTo(offsetLast, 10);
  }
}

describe('ringGeometry parity with the pre-extraction LoadingIndicator formulas', () => {
  it('keeps the tuned constants', () => {
    expect(RING_R).toBe(38);
    expect(CIRC).toBeCloseTo(238.76104167282426, 10);
    expect(RING_STROKE).toBe(3.5);
    expect(SEGMENT_STROKE_MIN).toBe(4.5);
    expect(SEGMENT_STROKE_MAX).toBe(8.5);
    expect(SEGMENT_PENDING_SCALE).toBe(0.72);
    expect(IDLE_SEGMENT_COUNT).toBe(6);
    expect(IDLE_SEGMENT_GAP).toBe(13);
    expect(IDLE_SEGMENT_DASH).toBeCloseTo(CIRC / 6 - 13, 10);
  });

  it('converts strokeWidthPx to viewBox units exactly as before', () => {
    // The timeline dot: 3px rail width at the 20px dot.
    expect(strokeUnitsForPx(3, 20)).toBe(15);
    // Non-px consumers keep the viewBox defaults.
    expect(strokeUnitsForPx(null, 20)).toBeNull();
    expect(strokeUnitsForPx(undefined, 160)).toBeNull();
    expect(strokeUnitsForPx(0, 20)).toBeNull();
    expect(strokeUnitsForPx(3, 0)).toBeNull();
    expect(strokeUnitsForPx(3, 160)).toBeCloseTo(1.875, 10);
  });

  it('reproduces the px-targeted timeline segment geometry for counts 1..24', () => {
    expectSegmentRows(PX_SEGMENTS, TIMELINE_STROKE_UNITS);
  });

  it('reproduces the default segment geometry for counts 1..24', () => {
    expectSegmentRows(DEFAULT_SEGMENTS, null);
  });

  it('keeps the default count-scaled segment stroke clamps', () => {
    expect(segmentStroke(1)).toBe(8.5);
    expect(segmentStroke(6)).toBe(8.5);
    expect(segmentStroke(7)).toBeCloseTo(54 / 7, 10);
    expect(segmentStroke(12)).toBe(4.5);
    expect(segmentStroke(24)).toBe(4.5);
  });

  it('reproduces the idle-ring dash pattern in both variants', () => {
    // Px-targeted (timeline dot, size 20 / strokeWidthPx 3): the gap comes
    // from the shared seam policy so round caps cannot merge the dashes.
    const px = idleDashPattern(TIMELINE_STROKE_UNITS, true);
    expect(px.gap).toBeCloseTo(26.25, 10); // 15 * 1.75
    expect(px.dash).toBeCloseTo(13.54350694547071, 10);
    expect(px.strokeDasharray[0]).toBeCloseTo(px.dash, 10);
    expect(px.strokeDasharray[1]).toBeCloseTo(px.gap, 10);
    expect(px.strokeDashoffset).toBeCloseTo(-13.125, 10);
    expect(idleGapUnits(TIMELINE_STROKE_UNITS, true)).toBeCloseTo(26.25, 10);

    // Default (SettingsRecoveryScreen, TransferStepChain, MintAddScreen,
    // StatusToast…): the tuned constants, untouched by the seam policy.
    const def = idleDashPattern(RING_STROKE, false);
    expect(def.gap).toBe(13);
    expect(def.dash).toBeCloseTo(26.79350694547071, 10);
    expect(def.strokeDashoffset).toBeCloseTo(-6.5, 10);
    expect(idleGapUnits(RING_STROKE, false)).toBe(13);
  });

  it('keeps the shared seam-gap policy for both branches', () => {
    // Legacy proportional policy (non-px).
    expect(segmentGapUnits(CIRC / 3, 8.5, false)).toBeCloseTo(17.50914305600711, 10);
    expect(segmentGapUnits(CIRC / 6, 8.5, false)).toBeCloseTo(12.5, 10);
    // Px-targeted: gap = stroke + clamp(0.75·stroke) within the step.
    expect(segmentGapUnits(CIRC / 6, 15, true)).toBeCloseTo(26.25, 10);
    expect(segmentGapUnits(CIRC / 24, 4.5, true)).toBeCloseTo(8.5, 10);
  });

  it('keeps the pending-stroke scaling behavior', () => {
    // Px-targeted rings keep full weight; default thins pending arcs to 0.72×.
    expect(pendingStrokeScale(true)).toBe(1);
    expect(pendingStrokeScale(false)).toBe(SEGMENT_PENDING_SCALE);
    // Rest-state widths as ConfirmationSegment renders them (progress 0).
    expect(15 * pendingStrokeScale(true)).toBe(15);
    expect(segmentStroke(3) * pendingStrokeScale(false)).toBeCloseTo(6.12, 10);
  });

  it('keeps the result-disc coverage radius', () => {
    expect(resultDiscRadius(null)).toBe(38); // non-segmented
    expect(resultDiscRadius(effectiveSegmentStroke(3, TIMELINE_STROKE_UNITS))).toBeCloseTo(
      45.5,
      10
    );
    expect(resultDiscRadius(effectiveSegmentStroke(3, null))).toBeCloseTo(42.25, 10);
    expect(resultDiscRadius(effectiveSegmentStroke(24, TIMELINE_STROKE_UNITS))).toBeCloseTo(
      42.25,
      10
    );
  });
});
