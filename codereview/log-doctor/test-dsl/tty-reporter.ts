/**
 * @fileoverview Sovran Test DSL — interactive TTY reporter.
 *
 * Append-only terminal UI: every step line commits to scrollback the
 * moment it finalises and is NEVER rewritten. Only one line at the
 * bottom of the terminal is "live" — the currently-running leaf step
 * with its spinner — plus a small header footer below it that shows
 * the mutable progress bar / stats / elapsed.
 *
 *   [06] ✓ wait for #payment-info-token-data       ← committed
 *   [07] ▸ run probe-copy-button                   ← committed
 *     [08] ✓ tap #send-token-copy                  ← committed
 *     [09] ⠋ capture clipboard as $copied          ← live tail (rewrites)
 *   ─────────────────────────────────────────────
 *   [matrix] SendTokenScreen — action coverage    ← live header (rewrites)
 *     ████████░░░░░░░░ 2/4 (50%)  ETA ~45s
 *     ✓ 2  ✗ 0  ⏱ 01:23
 *
 * The design honours a simple rule: **once a line has been posted,
 * it stays.** Spinners can rewrite themselves while a step is running
 * (that's not "hiding old logs" — the line hasn't finalised yet), and
 * the header can update in place (it's mutable status, not history).
 * Everything else is immutable.
 *
 * Block openers commit at `step.begin` with a `▸` glyph. Leaf steps
 * commit at `step.end` — before that they live in the live tail with a
 * spinner. Block closers commit at `step.end` with `✓` / `✗` and an
 * optional detail tail, matching the source step's index so you can
 * pair open/close visually.
 *
 * Fall back to the flat streaming log via `--no-ui` for CI or piped
 * output — this reporter only runs when stdout is a real TTY.
 */

import * as fs from 'fs';
import * as nodePath from 'path';

import type {
  MatrixBeginEvent,
  MatrixCellBeginEvent,
  MatrixCellEndEvent,
  MatrixEndEvent,
  RunBeginEvent,
  RunEndEvent,
  RunnerEvent,
  StepBeginEvent,
  StepEndEvent,
  TestBeginEvent,
  TestEndEvent,
} from './events';

// ─── ANSI helpers ──────────────────────────────────────────────────────────

const ESC = '\x1b[';
const c = {
  reset: `${ESC}0m`,
  bold: (s: string) => `${ESC}1m${s}${ESC}22m`,
  dim: (s: string) => `${ESC}2m${s}${ESC}22m`,
  gray: (s: string) => `${ESC}90m${s}${ESC}39m`,
  red: (s: string) => `${ESC}31m${s}${ESC}39m`,
  green: (s: string) => `${ESC}32m${s}${ESC}39m`,
  yellow: (s: string) => `${ESC}33m${s}${ESC}39m`,
  blue: (s: string) => `${ESC}34m${s}${ESC}39m`,
  magenta: (s: string) => `${ESC}35m${s}${ESC}39m`,
  cyan: (s: string) => `${ESC}36m${s}${ESC}39m`,
};

/** Strip ANSI escapes so visible-width calculations are correct. */
function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * Truncate a string to fit within a visible-width budget. Leaves the
 * trailing `…` visible and preserves the colour reset at the end so an
 * abruptly-cut line doesn't bleed colour into the next one.
 */
function truncateVisible(s: string, max: number): string {
  if (visibleLength(s) <= max) return s;
  let visible = 0;
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\x1b' && s[i + 1] === '[') {
      const end = s.indexOf('m', i);
      if (end === -1) break;
      out += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (visible + 1 > max - 1) break;
    out += s[i];
    visible++;
    i++;
  }
  return `${out}…${c.reset}`;
}

// ─── Spinner ───────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_MS = 100;

// ─── Duration formatting ──────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

// ─── Reporter state ────────────────────────────────────────────────────────

/** Per-step data retained ONLY while the step is in flight. */
interface LiveStep {
  index: number;
  depth: number;
  source: string;
  kind: string;
  startedAt: number;
}

/** Block openers on the call stack — popped when their step.end fires. */
interface OpenBlock {
  index: number;
  depth: number;
  source: string;
  kind: string;
  startedAt: number;
}

interface ReporterState {
  runTitle: string;
  runKind: 'test' | 'matrix' | 'all';
  runStartedAt: number;

  /** Current unit index (1-indexed) — incremented per test or per cell. */
  unitIndex: number;
  totalUnits: number;
  passed: number;
  failed: number;

  /** Rolling window of recent unit durations for ETA. */
  recentDurations: number[];

  /** The single currently-running leaf step — drawn in the live tail. */
  currentLeaf: LiveStep | null;

  /** Stack of in-progress block openers. */
  blockStack: OpenBlock[];

  /** Total leaf steps completed across all units (fine-grained progress). */
  completedSteps: number;
  /** Total leaf steps in the current unit. */
  unitSteps: number;

  finished: boolean;
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface TtyReporterOptions {
  stream?: NodeJS.WriteStream;
  /** Sidecar log path for the full transcript. */
  sidecarLogPath?: string;
  /**
   * Optional registration function for the recovery log sink exposed
   * by `log-doctor.ts`. When present, the reporter plugs its own
   * `commit()` path into that sink so WDA bring-up / tunnel recovery
   * progress messages land inside the reporter's scrollback instead of
   * bypassing the live-area cursor math. `finish()` unregisters by
   * calling the same setter with `null`.
   *
   * This is threaded through as a callback (instead of imported
   * directly) to avoid a circular module dependency:
   * `log-doctor.ts` already imports `createTtyReporter`, so it
   * wouldn't be able to `import { setRecoveryLogSink }` the other way
   * without breaking module load order.
   */
  setRecoveryLogSink?: (sink: ((line: string) => void) | null) => void;
}

export interface TtyReporter {
  onEvent(event: RunnerEvent): void;
  onLog(line: string): void;
  /**
   * Suspend the live-area repainting and the spinner ticker. Used
   * when an out-of-band operation (WDA bring-up, SIGINT handler) is
   * about to write directly to the terminal and would race the
   * reporter's cursor math. Nestable via internal counter.
   */
  suspend(): void;
  /** Inverse of `suspend()`. Safe to call when not suspended (no-op). */
  resume(): void;
  finish(): void;
  sidecarLogPath: string;
}

export function createTtyReporter(opts: TtyReporterOptions = {}): TtyReporter {
  const stream = opts.stream ?? process.stdout;

  // Sidecar log — we tee every log line here so users can grep the
  // transcript after the run without the rich UI getting in the way.
  // Default location mirrors the existing .screenshots / .snapshots
  // convention under tests/ so all test artefacts live in one place.
  const sidecarLogPath =
    opts.sidecarLogPath ??
    nodePath.join(process.cwd(), 'tests', '.test-runs', `run-${Date.now()}.log`);
  try {
    fs.mkdirSync(nodePath.dirname(sidecarLogPath), { recursive: true });
  } catch {
    /* best effort */
  }
  let sidecarStream: fs.WriteStream | null = null;
  try {
    sidecarStream = fs.createWriteStream(sidecarLogPath, { flags: 'w' });
  } catch {
    /* sidecar logging is best-effort */
  }

  const state: ReporterState = {
    runTitle: '',
    runKind: 'test',
    runStartedAt: Date.now(),
    unitIndex: 0,
    totalUnits: 0,
    passed: 0,
    failed: 0,
    recentDurations: [],
    currentLeaf: null,
    blockStack: [],
    completedSteps: 0,
    unitSteps: 0,
    finished: false,
  };

  /**
   * How many lines are currently in the "live area" at the bottom of
   * the terminal — the spot we redraw in place without appending to
   * scrollback. Walk back up by this many lines before rewriting.
   */
  let liveLineCount = 0;
  let spinnerFrame = 0;
  let tickHandle: NodeJS.Timeout | null = null;

  function startTicker(): void {
    if (tickHandle) return;
    tickHandle = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
      update();
    }, SPINNER_MS);
    if (typeof tickHandle.unref === 'function') tickHandle.unref();
  }

  function stopTicker(): void {
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  // ── Suspend / resume (for mid-run WDA recovery) ──
  //
  // When `log-doctor.ts`'s `recoverWDA` / `ensureWDAReady` paths need
  // to print bring-up progress mid-run, the reporter must stop
  // repainting its live footer and its ticker so those lines don't
  // race against the cursor math in `clearLive` / `paintLive`. The
  // sink plugged in via `opts.setRecoveryLogSink` calls `commit()`
  // for each line, and `commit()` does the right thing
  // (clearLive → write → paintLive) as long as the reporter isn't
  // actively repainting from a ticker tick in the middle of the
  // sink's own call. Suspending the ticker removes that race.
  //
  // `suspendCount` is a counter (not a bool) so nested suspends —
  // unlikely in practice because `wdaRecoveryPromise` serialises
  // bring-ups, but cheap to support — don't resume prematurely.
  let suspendCount = 0;
  function suspend(): void {
    suspendCount++;
    if (suspendCount === 1) {
      stopTicker();
      clearLive();
    }
  }
  function resume(): void {
    if (suspendCount === 0) return;
    suspendCount--;
    if (suspendCount === 0) {
      paintLive();
      startTicker();
    }
  }

  // ── Event handling ──

  function onEvent(event: RunnerEvent): void {
    switch (event.type) {
      case 'run.begin':
        handleRunBegin(event);
        break;
      case 'run.end':
        handleRunEnd(event);
        break;
      case 'test.begin':
        handleTestBegin(event);
        break;
      case 'test.end':
        handleTestEnd(event);
        break;
      case 'step.begin':
        handleStepBegin(event);
        break;
      case 'step.end':
        handleStepEnd(event);
        break;
      case 'matrix.begin':
        handleMatrixBegin(event);
        break;
      case 'matrix.cell.begin':
        handleMatrixCellBegin(event);
        break;
      case 'matrix.cell.end':
        handleMatrixCellEnd(event);
        break;
      case 'matrix.end':
        handleMatrixEnd(event);
        break;
    }
  }

  function onLog(line: string): void {
    // `sidecarStream.writable` becomes false as soon as `.end()` is
    // called in `finish()`. Without the guard, any log line emitted
    // after the summary is printed — which happens in the `phone test
    // all` path, where `streamLog('')` is invoked between the final
    // run.end and reporter.finish() — triggers an
    // `ERR_STREAM_WRITE_AFTER_END` that escapes the try/catch because
    // `write()` emits the error on the stream asynchronously rather
    // than throwing synchronously, crashing the whole CLI.
    if (sidecarStream && sidecarStream.writable) {
      try {
        sidecarStream.write(line + '\n');
      } catch {
        /* best effort */
      }
    }
  }

  function handleRunBegin(event: RunBeginEvent): void {
    state.runTitle = event.title;
    state.runKind = event.kind;
    state.runStartedAt = event.t;
    state.totalUnits = event.totalUnits ?? 0;
    startTicker();

    // Commit a permanent banner to scrollback so users can scroll all
    // the way up and still know what run they're looking at. No
    // separator here — the live header below will draw its own
    // dividing rule as the join between scrollback and live.
    const kindTag =
      event.kind === 'matrix' ? c.magenta('[matrix]') : event.kind === 'all' ? c.cyan('[all]') : c.cyan('[test]');
    const unitSuffix = event.totalUnits
      ? c.dim(`  (${event.totalUnits} unit${event.totalUnits === 1 ? '' : 's'})`)
      : '';
    commit([`${kindTag} ${c.bold(event.title)}${unitSuffix}`]);
  }

  function handleRunEnd(_event: RunEndEvent): void {
    state.finished = true;
    // Final summary is committed in finish(); run.end just stops the ticker.
    stopTicker();
    update();
  }

  function handleTestBegin(event: TestBeginEvent): void {
    if (state.runKind === 'test') {
      state.unitIndex = 1;
      state.totalUnits = 1;
    }
    // For standalone tests we commit a test-start marker; for matrix
    // cells the matrix handler already committed a cell marker and we
    // don't repeat it here.
    if (!event.synthetic) {
      commit([`${c.blue('▶')} ${c.bold(event.name)}`]);
    }
    // Reset per-test step state.
    state.blockStack = [];
    state.currentLeaf = null;
    state.unitSteps = 0;
  }

  function handleTestEnd(event: TestEndEvent): void {
    const dur = formatDuration(event.durationMs);
    const steps = `${event.stepCount} step${event.stepCount === 1 ? '' : 's'}`;
    if (event.ok) {
      state.passed++;
      commit([`  ${c.green('✓')} ${event.name}  ${c.dim(`${steps}  ${dur}`)}`]);
    } else {
      state.failed++;
      const errSuffix = event.error ? `\n    ${c.red('╰ ' + truncatePlain(event.error, 140))}` : '';
      commit([`  ${c.red('✗')} ${c.red(event.name)}  ${c.dim(`${steps}  ${dur}`)}${errSuffix}`]);
    }
    state.recentDurations.push(event.durationMs);
    if (state.recentDurations.length > 8) state.recentDurations.shift();
  }

  function handleStepBegin(event: StepBeginEvent): void {
    if (event.isBlock) {
      // Commit an opener line immediately. No spinner — the block's
      // body is what's "running" and its leaf children will each get
      // their own live spinner turn.
      state.blockStack.push({
        index: event.index,
        depth: event.depth,
        source: event.source,
        kind: event.kind,
        startedAt: event.t,
      });
      const line = renderStepLine({
        index: event.index,
        depth: event.depth,
        source: event.source,
        kind: event.kind,
        glyph: 'open',
      });
      commit([line]);
    } else {
      // Leaf — becomes the live tail with a spinner until step.end.
      state.currentLeaf = {
        index: event.index,
        depth: event.depth,
        source: event.source,
        kind: event.kind,
        startedAt: event.t,
      };
      update();
    }
  }

  function handleStepEnd(event: StepEndEvent): void {
    if (event.isBlock) {
      // Match and pop the block opener. Commit a closer line that
      // shares the block's source index, which pairs visually with
      // the `▸` line from step.begin.
      const opener = state.blockStack.pop();
      if (!opener) return;
      const durationMs = event.t - opener.startedAt;
      const line = renderStepLine({
        index: opener.index,
        depth: opener.depth,
        source: opener.source,
        kind: opener.kind,
        glyph: event.ok ? 'blockDone' : 'fail',
        durationMs,
        ...(event.detail ? { detail: event.detail } : {}),
        ...(event.error ? { error: event.error } : {}),
      });
      commit([line]);
    } else {
      // Leaf finalise — finalize the live tail into a committed line.
      state.completedSteps++;
      state.unitSteps++;
      if (!state.currentLeaf || state.currentLeaf.index !== event.index) {
        // Shouldn't happen but bail out gracefully.
        state.currentLeaf = null;
        update();
        return;
      }
      const leaf = state.currentLeaf;
      state.currentLeaf = null;
      const durationMs = event.t - leaf.startedAt;
      const line = renderStepLine({
        index: leaf.index,
        depth: leaf.depth,
        source: leaf.source,
        kind: leaf.kind,
        glyph: event.ok ? 'ok' : 'fail',
        durationMs,
        ...(event.detail ? { detail: event.detail } : {}),
        ...(event.error ? { error: event.error } : {}),
      });
      commit([line]);
    }
  }

  function handleMatrixBegin(event: MatrixBeginEvent): void {
    // In `phone test all` mode, `run.begin` has already set
    // `state.totalUnits` to the combined count of plain tests + matrix
    // cells and `state.runKind` to `'all'`. A nested `matrix.begin`
    // must NOT overwrite those — doing so dropped totalUnits to just
    // the matrix's cell count, and since plain-test outcomes had
    // already been tallied into state.passed/state.failed, the next
    // cell end made `done > total`, driving a negative `.repeat()`
    // argument in renderHeader and crashing with
    // `RangeError: Invalid count value: -6`.
    //
    // Only adopt the matrix's totals when the run is the matrix
    // itself (standalone `phone test <matrix-name>` mode, which
    // already set runKind=`'matrix'` and totalUnits=cellCount in
    // run.begin — this branch is effectively a no-op then).
    if (state.runKind === 'matrix') {
      state.runTitle = event.title;
      state.totalUnits = event.totalCells;
    }
  }

  function handleMatrixCellBegin(event: MatrixCellBeginEvent): void {
    state.unitIndex = event.cellIndex;
    // See handleMatrixBegin — don't clobber the run-level totalUnits
    // when we're nested inside a `phone test all` run.
    if (state.runKind === 'matrix') {
      state.totalUnits = event.totalCells;
    }
    // Reset step state for this cell.
    state.blockStack = [];
    state.currentLeaf = null;
    commit([
      '',
      `${c.blue('▶')} ${c.bold(`cell ${event.cellIndex}/${event.totalCells}`)}  ${c.dim(event.tupleLabel)}`,
    ]);
  }

  function handleMatrixCellEnd(event: MatrixCellEndEvent): void {
    if (event.ok) state.passed++;
    else state.failed++;
    state.recentDurations.push(event.durationMs);
    if (state.recentDurations.length > 8) state.recentDurations.shift();

    const dur = formatDuration(event.durationMs);
    if (event.ok) {
      commit([`  ${c.green('✓')} cell ${event.cellIndex} passed  ${c.dim(dur)}`]);
    } else {
      const errSuffix = event.error
        ? `\n    ${c.red('╰ ' + truncatePlain(event.error, 140))}`
        : '';
      commit([`  ${c.red('✗')} cell ${event.cellIndex} failed  ${c.dim(dur)}${errSuffix}`]);
    }
  }

  function handleMatrixEnd(_event: MatrixEndEvent): void {
    // No extra work — cell.end events already committed per-cell
    // history and run.end / finish() handle the overall summary.
  }

  // ── Scrollback + live area ──

  /** Append `lines` to scrollback, then redraw the live area below them. */
  function commit(lines: string[]): void {
    clearLive();
    const width = columns();
    for (const line of lines) {
      stream.write(truncateVisible(line, width) + '\n');
    }
    paintLive();
  }

  /** Refresh the live area without committing anything. */
  function update(): void {
    clearLive();
    paintLive();
  }

  function clearLive(): void {
    if (liveLineCount > 0 && stream.moveCursor && stream.clearScreenDown) {
      stream.moveCursor(0, -liveLineCount);
      stream.cursorTo(0);
      stream.clearScreenDown();
    }
    liveLineCount = 0;
  }

  function paintLive(): void {
    const width = columns();
    const lines: string[] = [];

    // Live tail: the currently-running leaf step with its spinner.
    if (state.currentLeaf) {
      lines.push(
        renderStepLine({
          index: state.currentLeaf.index,
          depth: state.currentLeaf.depth,
          source: state.currentLeaf.source,
          kind: state.currentLeaf.kind,
          glyph: 'running',
        })
      );
      // If a step has been running a while, add a "waiting Ns" note
      // directly beneath it so the user knows progress is actually
      // stalled vs. "just short-running at this spinner frame".
      const waited = Date.now() - state.currentLeaf.startedAt;
      if (waited > 2000) {
        lines.push(c.dim(`      waiting ${formatDuration(waited)}`));
      }
    }

    // Header — sticky footer below the live tail.
    lines.push(...renderHeader());

    for (const line of lines) {
      stream.write(truncateVisible(line, width) + '\n');
    }
    liveLineCount = lines.length;
  }

  function renderHeader(): string[] {
    const width = columns();
    const elapsed = formatDuration(Date.now() - state.runStartedAt);
    const total = state.totalUnits;
    const done = state.passed + state.failed;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const progressBarWidth = Math.max(12, Math.min(24, width - 50));
    // Clamp `filled` to [0, progressBarWidth] so a total/done accounting
    // mismatch (e.g. if a future event is emitted out of order) can't
    // pass a negative count to `String.prototype.repeat`. Without the
    // clamp, `'░'.repeat(progressBarWidth - filled)` throws
    // `RangeError: Invalid count value: -N` the moment `done > total`.
    const rawFilled = total > 0 ? Math.round(progressBarWidth * (done / total)) : 0;
    const filled = Math.max(0, Math.min(progressBarWidth, rawFilled));
    const bar = '█'.repeat(filled) + c.dim('░'.repeat(progressBarWidth - filled));

    let etaStr = '';
    if (total > 0 && done > 0 && done < total && state.recentDurations.length > 0) {
      const avg =
        state.recentDurations.reduce((s, v) => s + v, 0) / state.recentDurations.length;
      const remainingMs = (total - done) * avg;
      const prefix = state.recentDurations.length < 3 ? '~' : '';
      etaStr = `  ETA ${prefix}${formatDuration(remainingMs)}`;
    }

    const title = c.bold(state.runTitle || '(no run)');
    const kindTag =
      state.runKind === 'matrix'
        ? c.magenta('[matrix]')
        : state.runKind === 'all'
          ? c.cyan('[all]')
          : c.cyan('[test]');
    const progressLine = `${bar}  ${done}/${total || '?'} (${pct}%)${etaStr}`;
    const statsLine = `${c.green(`✓ ${state.passed}`)}  ${
      state.failed > 0 ? c.red(`✗ ${state.failed}`) : c.dim(`✗ ${state.failed}`)
    }  ${c.dim(`⏱ ${elapsed}`)}`;
    const stepLine = `step ${state.completedSteps}` +
      (state.unitSteps > 0 ? c.dim(` (${state.unitSteps} in current)`) : '');

    return [
      c.dim('─'.repeat(width)),
      `${kindTag} ${title}`,
      `  ${progressLine}  ${stepLine}`,
      `  ${statsLine}`,
    ];
  }

  // ── Step line rendering ──

  interface StepLineInput {
    index: number;
    depth: number;
    source: string;
    kind: string;
    glyph: 'running' | 'ok' | 'fail' | 'open' | 'blockDone';
    detail?: string;
    error?: string;
    /** Wall-clock duration of this step in ms. Shown on completed lines. */
    durationMs?: number;
  }

  function renderStepLine(input: StepLineInput): string {
    const indent = '  '.repeat(input.depth + 1);
    const idx = c.dim(`[${String(input.index).padStart(2, '0')}]`);
    const verb = colorizeSource(input.source, input.kind);

    let glyph: string;
    switch (input.glyph) {
      case 'running':
        glyph = c.yellow(SPINNER_FRAMES[spinnerFrame]);
        break;
      case 'ok':
        glyph = c.green('✓');
        break;
      case 'fail':
        glyph = c.red('✗');
        break;
      case 'open':
        glyph = c.cyan('▸');
        break;
      case 'blockDone':
        glyph = c.green('▣');
        break;
    }

    let tail = '';
    if ((input.glyph === 'ok' || input.glyph === 'blockDone') && input.detail) {
      tail = `  ${c.dim('→')} ${c.dim(truncatePlain(input.detail, 80))}`;
    } else if (input.glyph === 'fail' && input.error) {
      tail = `  ${c.red('—')} ${c.red(truncatePlain(input.error, 100))}`;
    }

    // Duration tag — shown on all completed/failed steps. Sub-second
    // shows milliseconds, ≥1s shows seconds with one decimal.
    let dur = '';
    if (input.durationMs !== undefined) {
      const ms = input.durationMs;
      const formatted = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
      dur = ms >= 2000
        ? `  ${c.yellow(formatted)}`
        : `  ${c.dim(formatted)}`;
    }

    return `${indent}${glyph} ${idx} ${verb}${tail}${dur}`;
  }

  function colorizeSource(source: string, kind: string): string {
    switch (kind) {
      case 'tap':
      case 'type':
      case 'keypad':
      case 'swipe':
      case 'scrollUntil':
        return c.cyan(source);
      case 'waitFor':
        return c.yellow(source);
      case 'assertVisible':
      case 'assertNotVisible':
      case 'assertVar':
      case 'assertScreenEq':
        return c.magenta(source);
      case 'captureLabel':
      case 'captureSuffix':
      case 'captureClipboard':
      case 'snapshot':
        return c.green(source);
      case 'run':
      case 'scopedBundle':
      case 'if':
      case 'ifVar':
      case 'repeat':
      case 'stable':
        return c.bold(source);
      case 'wallet':
        return c.yellow(source);
      default:
        return source;
    }
  }

  function truncatePlain(s: string, max: number): string {
    const flat = s.replace(/\s+/g, ' ').trim();
    if (flat.length <= max) return flat;
    return flat.slice(0, max - 1) + '…';
  }

  function columns(): number {
    return Math.max(40, (stream.columns ?? 80) - 1);
  }

  // ── Finish ──

  function finish(): void {
    stopTicker();
    // Clear the live area, then commit a final one-line summary to
    // scrollback. Everything else is already in scrollback via
    // per-step / per-cell commits.
    clearLive();
    const elapsed = formatDuration(Date.now() - state.runStartedAt);
    const total = state.passed + state.failed;
    const allOk = state.failed === 0;
    const header = allOk
      ? c.green(`✓ ${state.passed}/${total} passed`)
      : c.red(`✗ ${state.failed}/${total} failed`);
    stream.write('\n');
    stream.write(c.dim('─'.repeat(columns())) + '\n');
    stream.write(
      `${header}  ${c.dim(`⏱ ${elapsed}`)}  ${c.dim(`log: ${nodePath.relative(process.cwd(), sidecarLogPath)}`)}\n`
    );
    stream.write(c.dim('─'.repeat(columns())) + '\n');

    if (sidecarStream) {
      try {
        sidecarStream.end();
      } catch {
        /* best effort */
      }
      // Clear the reference so any late emitLine() calls from
      // fire-and-forget paths (e.g. post-failure screenshot promises
      // in executor.ts: `takeScreenshot(...).then(p => ctx.emit(...))`)
      // that land after `finish()` completes don't try to write to
      // the closed stream.
      sidecarStream = null;
    }

    // Unplug the recovery log sink so any stray `wdaRequest` calls
    // from teardown paths (e.g. delete-session cleanup inside
    // `ephemeralSession`) that still hit `emitRecoveryLine` fall
    // through to `process.stderr.write` instead of an orphaned
    // reporter that's just been finalised.
    if (opts.setRecoveryLogSink) {
      try {
        opts.setRecoveryLogSink(null);
      } catch {
        /* best effort */
      }
    }
  }

  // Plug the reporter into the log-doctor WDA recovery log sink so
  // `[wda] ...` bring-up progress messages commit through `commit()`
  // instead of racing stderr writes against the live area. Each line
  // committed this way appears above the live footer in scrollback,
  // matching the flow for normal step-line commits.
  if (opts.setRecoveryLogSink) {
    opts.setRecoveryLogSink((line: string) => {
      // Commit goes through the same clearLive → write → paintLive
      // dance as every other scrollback line, keeping the reporter's
      // cursor math internally consistent even when the line
      // originated from outside the event stream.
      commit([line]);
    });
  }

  return {
    onEvent,
    onLog,
    suspend,
    resume,
    finish,
    sidecarLogPath,
  };
}

/**
 * Is stdout a real TTY that can host the reporter? False in CI, piped
 * output, and anywhere else the cursor helpers are unavailable.
 */
export function isInteractiveTty(stream: NodeJS.WriteStream = process.stdout): boolean {
  return Boolean(
    stream.isTTY &&
      stream.columns &&
      stream.columns > 40 &&
      typeof stream.moveCursor === 'function' &&
      typeof stream.clearScreenDown === 'function'
  );
}
