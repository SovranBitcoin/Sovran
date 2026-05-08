/**
 * @fileoverview Sovran Test DSL — structured runner event stream.
 *
 * The executor emits a typed event for every test/step/matrix boundary
 * so observers (TTY reporter, future JSON reporter, future junit-xml
 * exporter) can consume the run without parsing log strings. Each
 * event carries just the data the observer needs — no pre-formatting,
 * no indentation — so a renderer owns all the presentation.
 *
 * Events are additive to the existing `onLog` string channel. When
 * both are wired, `onEvent` carries the structured facts and `onLog`
 * carries the human-readable transcript. The default CLI behaviour is:
 *
 *   - interactive TTY → wire `onEvent` to the TTY reporter, buffer
 *     `onLog` to a sidecar file for post-run grep
 *   - piped / non-TTY → wire `onLog` to stdout, skip `onEvent`
 *
 * Keep this file strictly type-only (no runtime deps) so it's safe to
 * import from both the executor and the reporter without pulling in
 * terminal code where it isn't wanted.
 */

// ─── Base shape ────────────────────────────────────────────────────────────

interface BaseEvent {
  /** Wall-clock timestamp in ms since epoch. Used for duration math. */
  t: number;
}

export type RunnerEvent =
  | RunBeginEvent
  | RunEndEvent
  | TestBeginEvent
  | TestEndEvent
  | StepBeginEvent
  | StepEndEvent
  | MatrixBeginEvent
  | MatrixCellBeginEvent
  | MatrixCellEndEvent
  | MatrixEndEvent;

export type EventEmitter = (event: RunnerEvent) => void;

// ─── Run-level events (the outermost frame) ────────────────────────────────

/**
 * Fired once per `phone test <...>` invocation, before any work
 * begins. Carries the kind of run so the reporter can pick the right
 * header layout (single test vs. matrix vs. `all`).
 */
export interface RunBeginEvent extends BaseEvent {
  type: 'run.begin';
  /** 'test' = single hand-written test, 'matrix' = a single matrix, 'all' = phone test all */
  kind: 'test' | 'matrix' | 'all';
  /** Display title for the whole run. For `all`, something like "all tests". */
  title: string;
  /** Total runnable units (tests + cells) if known up-front. `all` pre-counts; single paths don't. */
  totalUnits?: number;
}

export interface RunEndEvent extends BaseEvent {
  type: 'run.end';
  ok: boolean;
  passed: number;
  failed: number;
}

// ─── Test-level events (one per hand-written or synthesized test) ──────────

export interface TestBeginEvent extends BaseEvent {
  type: 'test.begin';
  /** Display name — for matrix cells, this is the synthesized tuple name. */
  name: string;
  /** True when emitted by a matrix runner for one of its cells. */
  synthetic: boolean;
}

export interface TestEndEvent extends BaseEvent {
  type: 'test.end';
  name: string;
  ok: boolean;
  /** Number of top-level step indexes executed (i.e. what the executor's `stepIndex` reached). */
  stepCount: number;
  durationMs: number;
  /** Short first-line error for the summary table. */
  error?: string;
}

// ─── Step-level events ─────────────────────────────────────────────────────

/**
 * One event per step invocation, emitted BEFORE the step handler runs.
 * Nested steps inside a block opener (`if`, `repeat`, `run`, `stable`,
 * `scopedBundle`) get higher `depth` values — depth 0 is top-level,
 * depth 1 is one block deep, etc.
 */
export interface StepBeginEvent extends BaseEvent {
  type: 'step.begin';
  /** 1-indexed step counter — matches the `[NN]` prefix in flat logs. */
  index: number;
  /** Nesting depth, 0-indexed. */
  depth: number;
  /** Source-level text from `describeStep(step)` — the verb + interpolation tokens, unresolved. */
  source: string;
  /** True for block openers (if/repeat/run/stable/scopedBundle) — reporter can reserve a "bundle close" slot. */
  isBlock: boolean;
  /** Step kind — useful for picking glyph colours (e.g. tap vs wait vs assert). */
  kind: string;
}

export interface StepEndEvent extends BaseEvent {
  type: 'step.end';
  /** Matches the `index` of the preceding `step.begin`. */
  index: number;
  ok: boolean;
  /** Handler-supplied tail detail — captured value, matched id, `N step(s)`, etc. */
  detail?: string;
  /** Error first-line if ok === false. */
  error?: string;
  /** Mirror of StepBeginEvent.isBlock so observers can treat block closes distinctly. */
  isBlock: boolean;
}

// ─── Matrix-level events ───────────────────────────────────────────────────

export interface MatrixBeginEvent extends BaseEvent {
  type: 'matrix.begin';
  title: string;
  mode: 'verbose' | 'quick';
  totalCells: number;
}

export interface MatrixCellBeginEvent extends BaseEvent {
  type: 'matrix.cell.begin';
  /** 1-indexed cell number within the matrix. */
  cellIndex: number;
  totalCells: number;
  /** Full synthesized test name. */
  cellName: string;
  /** Compact per-stage label, e.g. `amount=via-keypad probes=bundle teardown=dismiss`. */
  tupleLabel: string;
}

export interface MatrixCellEndEvent extends BaseEvent {
  type: 'matrix.cell.end';
  cellIndex: number;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface MatrixEndEvent extends BaseEvent {
  type: 'matrix.end';
  title: string;
  ok: boolean;
  passed: number;
  failed: number;
}
