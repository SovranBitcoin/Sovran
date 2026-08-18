/**
 * @fileoverview Sovran Test DSL — executor.
 *
 * Walks a parsed Suite/Test AST and dispatches each Step to the existing
 * helpers in codereview/log-doctor/index.ts. The executor is the only place that
 * knows about both the AST shape AND the device-driving helpers — every
 * other module is intentionally narrow (parser knows AST only, wallet
 * knows cocod only, snapshot knows tree shapes only).
 *
 * Per-test state:
 *   - `vars` — Record<string, string> for ${var} interpolation. Populated
 *     by capture/snapshot/wallet/repeat-counter steps. Cleared between tests.
 *   - The block-execution stack is implicit in the recursive walk over
 *     IfStep.body / RepeatStep.body / Define.body.
 *
 * Sub-flows (`define name` / `run name`) share the calling test's var
 * scope — captures inside a sub-flow are visible to its caller. Cycles
 * are detected via a per-execution `runningDefines` set and fail loud.
 *
 * Errors thrown by any helper are caught at the step boundary, so a
 * single failed step short-circuits the test (returning ok=false) and
 * preserves the log of everything that ran successfully before it.
 */

import * as nodePath from 'path';
import * as fs from 'fs';

import {
  type AssertNotVisibleStep,
  type AssertScreenEqStep,
  type AssertVarStep,
  type AssertVisibleStep,
  type CaptureClipboardStep,
  type CaptureLabelStep,
  type CaptureSuffixStep,
  type Define,
  type IfStep,
  type IfVarStep,
  type MatrixDef,
  type MatrixMode,
  type RepeatStep,
  type RunStep,
  type ScopedBundleStep,
  type ScreenshotStep,
  type ScrollUntilStep,
  type SetClipboardStep,
  type SnapshotStep,
  type StableStep,
  type StageDef,
  type Step,
  type Suite,
  type TapStep,
  type Test,
  type TypeStep,
  type WaitForStep,
  type WalletStep,
  type Selector,
} from './ast';
import type { EventEmitter as RunnerEventEmitter } from './events';
import { interpolateString } from './interpolate';
import {
  buildSnapshot,
  deserializeSnapshot,
  diffSnapshots,
  formatSnapshotText,
  pruneSnapshot,
  renderDiff,
  serializeSnapshot,
  loadSnapshotIgnores,
} from './snapshot';
import { executeWallet, pingCocod } from './wallet';
import type { ExecuteMatrixResult, MatrixCellResult } from './types';

// All test artefacts live under `tests/`. Three sibling subdirs, ALL
// dot-prefixed so they stay grouped-and-hidden from `ls` but still
// committed-or-gitignored per the layout below:
//
//   tests/.screenshots/<artefactPath>/
//       Per-step PNGs and burst-capture frames. Binary, noisy,
//       gitignored.
//
//   tests/.snapshots/<artefactPath>/
//       Per-step accessibility-tree snapshots, pruned to a semantic
//       skeleton and written in a git-diff-friendly text format.
//       COMMITTED to git so drift shows up in PR diffs and a human
//       can review what the runner thinks the screen looks like at
//       every step of every test.
//
//   tests/.diffs/<artefactPath>/
//       Failed-diff dumps. Written only when a `stable ... across`
//       or `assert screen eq` step fails, and contain the full
//       rendered diff plus both expected/actual snapshots so any
//       pattern that needs to be added to `.snapshot-ignores` is
//       one `grep` away. Local-only — gitignored.
//
// `<artefactPath>` is either `<sanitized-test-name>` for plain tests
// or `<sanitized-matrix-title>/<cell-slug>` for matrix cells, so
// matrix-cell artefacts nest under their matrix instead of spewing
// flat-and-truncated names into the root of each dir.
const TESTS_ROOT = nodePath.resolve(process.cwd(), 'tests');
const SCREENSHOTS_DIR = nodePath.join(TESTS_ROOT, '.screenshots');
const SNAPSHOTS_DIR = nodePath.join(TESTS_ROOT, '.snapshots');
const DIFFS_DIR = nodePath.join(TESTS_ROOT, '.diffs');

// Load any user-defined snapshot ignore patterns once per process run.
// Tests can add lines to tests/.snapshot-ignores to silence trivial diffs
// (e.g. relative-time strings, percentage indicators) without recompiling.
loadSnapshotIgnores(nodePath.join(TESTS_ROOT, '.snapshot-ignores'));

import {
  type FlatNode,
  assertID,
  assertText,
  dismissModal,
  findByTestID,
  findByTestIDPrefix,
  findByTestIDPrefixFirst,
  findTopmostNavBackButton,
  flattenAll,
  getCurrentTree,
  preflightDismissDevMenu,
  pressHome,
  relaunchApp,
  captureElementLabel,
  readClipboard,
  writeClipboard,
  scrollUntilVisible,
  sleep,
  swipe,
  takeScreenshot,
  tapByID,
  tapByText,
  tapKeypadDigit,
  tapXY,
  typeKeys,
  waitForID,
  waitForText,
} from '../wda';

/**
 * Prefix-lookup dispatch: picks either the topmost-visible heuristic
 * (default) or the first-in-document-order primitive based on the
 * `first` flag on the selector. Every executor handler that resolves
 * a `#prefix*` selector funnels through this so the flag is honoured
 * uniformly.
 */
function findPrefixNode(
  flat: FlatNode[],
  sel: Extract<Selector, { kind: 'idPrefix' }>
): FlatNode | null {
  return sel.first
    ? findByTestIDPrefixFirst(flat, sel.prefix)
    : findByTestIDPrefix(flat, sel.prefix);
}

// ─── Public API ────────────────────────────────────────────────────────────

interface ExecuteOptions {
  /** Where to drop step screenshots. Defaults to .screenshots/<artefactPath>/. */
  screenshotDir?: string;
  /** Pretty test name used in the leading log line. */
  testName: string;
  /**
   * Relative path used to bucket this test's screenshots, per-step
   * snapshots, and failure diff dumps on disk. Defaults to
   * `sanitizeForFile(testName)` (one flat directory per test). The
   * matrix runner overrides this to nest matrix cells under their
   * matrix title:
   *
   *   <sanitized-matrix-title>/<stage1-variant1__stage2-variant2__...>
   *
   * So a cell's artefacts end up at e.g.
   *   tests/.screenshots/SendTokenScreen-action-coverage/
   *     amount-send-amount-via-keypad__probes-bundle__teardown-terminator-dismiss/
   *
   * instead of in the old flat-and-truncated form. Matrix cell
   * directories are mutually disjoint, so a failing cell never
   * clobbers another cell's artefacts on clean-up, and matrix roots
   * group visually when inspected by a human.
   */
  artefactPath?: string;
  /** Suite the test came from — used to resolve `run` references first. */
  suite: Suite;
  /**
   * Cross-suite define lookup. When `run <name>` doesn't resolve in the
   * local suite, the executor falls back to this map — discovery builds
   * it by merging defines from every parsed `.sov` file so `_shared/`
   * utilities can be called from any flow file without having to
   * duplicate them per suite.
   */
  globalDefines?: Map<string, Define>;
  /**
   * Optional streaming callback — invoked for every log line as it's
   * emitted, so `phone test` can print each step live as it runs
   * instead of waiting for the whole test to finish and dumping a
   * buffered blob. When set, the CLI handler should return an empty
   * string to avoid double-printing the returned `log` array.
   */
  onLog?: (line: string) => void;
  /**
   * Optional structured event sink. Emitted alongside `onLog` — the
   * two carry the same information in different shapes. Observers
   * that render a live UI (e.g. the TTY reporter) should subscribe to
   * events and ignore the log strings; observers that just want a
   * transcript should stick with `onLog`. See `./events.ts` for the
   * full event type.
   */
  onEvent?: RunnerEventEmitter;
  /**
   * When true, suppress the `test.begin` / `test.end` events. Used by
   * the matrix runner so it can emit its own cell-level events and
   * have the per-cell synthesized test stay invisible to observers
   * that only care about cell boundaries. Log-string emission is
   * unaffected.
   */
  suppressTestEvents?: boolean;
  /** Marks the emitted `test.begin` / `test.end` as synthetic (matrix cell). */
  syntheticTest?: boolean;
}

interface ExecuteResult {
  ok: boolean;
  log: string[];
}

/**
 * Execute one parsed Test against the connected device. The runner is
 * stateless across tests — every call sets up a fresh `vars` record and
 * a fresh screenshot dir. Returns `{ ok, log }` mirroring the legacy
 * runTestSteps signature so the CLI integration is a near-drop-in.
 */
export async function executeTest(test: Test, opts: ExecuteOptions): Promise<ExecuteResult> {
  const log: string[] = [];
  const emitLine = (line: string): void => {
    log.push(line);
    if (opts.onLog) opts.onLog(line);
  };
  emitLine(
    `▶ test: ${opts.testName}${test.name && test.name !== opts.testName ? '  — ' + test.name : ''}`
  );
  // Resolve the relative artefact path: caller-supplied (matrix cells
  // use nested `<matrix>/<cell>`) or default to a sanitized test name.
  const artefactPath = opts.artefactPath ?? sanitizeForFile(opts.testName);
  const shotDir = opts.screenshotDir ?? prepareScreenshotsDir(artefactPath);
  emitLine(`  screenshots → ${nodePath.relative(process.cwd(), shotDir)}/`);
  const stepSnapDir = prepareStepSnapshotsDir(artefactPath);
  emitLine(`  snapshots   → ${nodePath.relative(process.cwd(), stepSnapDir)}/`);
  // Prepare the diff-dump root upfront too — nuking it recursively
  // keeps stale per-run failure dumps from accumulating across tests
  // that keep the same artefactPath. `dumpSnapshotDiff` will mkdir
  // subdirectories as needed inside this tree.
  prepareDiffsDir(artefactPath);

  // The first visible artefact is step 01 (the `launch` step), not a
  // "start" snapshot of whatever happened to be on screen before the
  // test began — test authors only care about what the app shows *in
  // response to* the test, and the pre-launch state is either the
  // leftover from an earlier test run or a WDA handshake placeholder
  // that serialises slowly and carries no information.

  // Per-test state. Dir stacks start with a single entry — the
  // cell/test root — which is the `shotDir` / `stepSnapDir` we just
  // prepared. Every block handler push/pops a nested leaf on top of
  // this, so the bottom-most entry survives for the whole test.
  const ctx: ExecCtx = {
    vars: {},
    localFrames: [],
    suite: opts.suite,
    globalDefines: opts.globalDefines,
    testName: opts.testName,
    artefactPath,
    runningDefines: new Set<string>(),
    shotDirStack: [shotDir],
    snapDirStack: [stepSnapDir],
    blockRelPath: '',
    stepIndex: 1,
    log,
    emit: emitLine,
    emitEvent: opts.onEvent,
    depth: 0,
    walletPinged: false,
    repeatCounter: undefined,
  };

  const startedAt = Date.now();
  let lastError: string | undefined;

  if (!opts.suppressTestEvents) {
    opts.onEvent?.({
      type: 'test.begin',
      t: startedAt,
      name: opts.testName,
      synthetic: opts.syntheticTest ?? false,
    });
  }

  try {
    await executeBody(test.body, ctx);
    if (!opts.suppressTestEvents) {
      opts.onEvent?.({
        type: 'test.end',
        t: Date.now(),
        name: opts.testName,
        ok: true,
        stepCount: ctx.stepIndex - 1,
        durationMs: Date.now() - startedAt,
      });
    }
    return { ok: true, log };
  } catch (err) {
    // The throwing step has already pushed its `✗` line via executeStep's
    // catch — nothing more to do here.
    lastError = err instanceof Error ? err.message.split('\n', 1)[0] : String(err);
    if (!opts.suppressTestEvents) {
      const endEvent: import('./events').TestEndEvent = {
        type: 'test.end',
        t: Date.now(),
        name: opts.testName,
        ok: false,
        stepCount: ctx.stepIndex - 1,
        durationMs: Date.now() - startedAt,
      };
      if (lastError) endEvent.error = lastError;
      opts.onEvent?.(endEvent);
    }
    return { ok: false, log };
  }
}

// ─── Matrix runner ─────────────────────────────────────────────────────────

/**
 * Options for running a matrix. Mostly mirror `ExecuteOptions` because
 * every synthesized cell hands off to `executeTest` unchanged — this
 * exists as its own interface so the runner can thread matrix-level
 * context (title, mode, sink) independent of per-cell options.
 */
interface ExecuteMatrixOptions {
  /** Source suite the matrix came from — used to resolve variants. */
  suite: Suite;
  /** Cross-suite define fallback (from `_shared/` etc). */
  globalDefines?: Map<string, Define>;
  /** Streaming log sink — forwarded to each cell's `executeTest` call. */
  onLog?: (line: string) => void;
  /**
   * Structured event sink. The matrix runner emits its own
   * `matrix.begin` / `matrix.cell.begin` / `matrix.cell.end` /
   * `matrix.end` events and suppresses per-cell `test.begin` /
   * `test.end` so observers don't get a duplicate stream. Step-level
   * events still pass through for every cell.
   */
  onEvent?: RunnerEventEmitter;
}

/**
 * Expand a matrix into cells and execute each one against the device.
 * The matrix itself has no execution semantics of its own — it's a
 * pure combinator over reusable `define`s. Each cell becomes a
 * synthesized `Test` and goes through the existing `executeTest` path
 * unchanged, so every DSL feature (captures, `if visible`, `repeat`,
 * nested `run`, `stable ... across`) works inside variants without
 * special-casing.
 *
 * Capture isolation: `bundle of` stages wrap their variants in an
 * internal `scopedBundle` step so sibling probes can't leak captures
 * to each other or to downstream stages. `one of` and `each of` stages
 * pass their picked variant through directly so upstream state (e.g.
 * the selected mint) stays visible to later stages, matching today's
 * `run`-returns-to-outer-scope semantics.
 */
export async function executeMatrix(
  matrix: MatrixDef,
  opts: ExecuteMatrixOptions
): Promise<ExecuteMatrixResult> {
  const startedAt = new Date();
  const cells = expandMatrix(matrix);
  const emit = opts.onLog ?? ((): void => {});

  emit(
    `▶ matrix: ${matrix.title}  (${matrix.mode} × ${cells.length} cell${cells.length === 1 ? '' : 's'})`
  );

  opts.onEvent?.({
    type: 'matrix.begin',
    t: startedAt.getTime(),
    title: matrix.title,
    mode: matrix.mode,
    totalCells: cells.length,
  });

  const results: MatrixCellResult[] = [];
  let passed = 0;
  let failed = 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const header = `──── cell ${i + 1}/${cells.length}: ${cell.tupleLabel} ────`;
    emit('');
    emit(header);

    const cellStart = Date.now();
    opts.onEvent?.({
      type: 'matrix.cell.begin',
      t: cellStart,
      cellIndex: i + 1,
      totalCells: cells.length,
      cellName: cell.cellName,
      tupleLabel: cell.tupleLabel,
    });

    const synthesized: Test = {
      name: cell.cellName,
      body: cell.body,
      pos: matrix.pos,
    };

    // Bucket every cell's artefacts under
    //   <sanitized-matrix-title>/<cell-slug>
    // so inspecting the filesystem matches the way humans read the
    // matrix: open the matrix folder, see each cell as its own subdir,
    // open a cell to see that cell's steps. No truncation, no name
    // collisions between cells whose slugged prefixes happen to agree
    // (which the old flat-and-trimmed layout suffered from).
    const artefactPath = nodePath.join(
      sanitizeForFile(matrix.title),
      sanitizeCellSlug(cell.tupleLabel)
    );

    const execOpts: ExecuteOptions = {
      testName: cell.cellName,
      artefactPath,
      suite: opts.suite,
      // Matrix cells run under the cell.begin/cell.end envelope — we
      // suppress per-cell test.begin/test.end events so observers see
      // exactly one progress unit per cell (the cell itself) rather
      // than a duplicate synthetic-test envelope around the same work.
      suppressTestEvents: true,
      syntheticTest: true,
    };
    if (opts.globalDefines) execOpts.globalDefines = opts.globalDefines;
    if (opts.onLog) execOpts.onLog = opts.onLog;
    if (opts.onEvent) execOpts.onEvent = opts.onEvent;

    const exec = await executeTest(synthesized, execOpts);

    const result: MatrixCellResult = {
      cellName: cell.cellName,
      tupleLabel: cell.tupleLabel,
      ok: exec.ok,
    };
    if (!exec.ok) {
      // Pull the first error line out of the transcript so the result
      // table has a short diagnostic. The full log already streamed via
      // onLog so the caller sees it; this is just for the stamp.
      const failLine = exec.log.find((l) => /\s✗\s/.test(l) || /✗ /.test(l));
      if (failLine) {
        result.error = failLine
          .replace(/^\s+/, '')
          .replace(/^.*?✗\s*/, '')
          .slice(0, 120);
      }
    }
    results.push(result);
    if (exec.ok) passed++;
    else failed++;

    const cellEndEvent: import('./events').MatrixCellEndEvent = {
      type: 'matrix.cell.end',
      t: Date.now(),
      cellIndex: i + 1,
      ok: exec.ok,
      durationMs: Date.now() - cellStart,
    };
    if (result.error) cellEndEvent.error = result.error;
    opts.onEvent?.(cellEndEvent);
  }

  emit('');
  emit(`──── matrix summary: ${matrix.title} — ${passed} passed, ${failed} failed ────`);

  opts.onEvent?.({
    type: 'matrix.end',
    t: Date.now(),
    title: matrix.title,
    ok: failed === 0,
    passed,
    failed,
  });

  return {
    ok: failed === 0,
    cells: results,
    mode: matrix.mode,
    startedAt,
  };
}

/**
 * Pure enumeration + synthesis for a matrix — no I/O, no device, no
 * mutation. Turns the parsed matrix into a flat list of synthesized
 * cells, each with a body of Steps ready for `executeTest`.
 *
 * Extracted from `executeMatrix` so unit tests can verify expansion
 * rules (tuple count, ordering, cell names, capture-isolation wrapping)
 * without touching WDA or the real executor.
 */
function expandMatrix(matrix: MatrixDef): SynthesizedCell[] {
  // Per-stage "choice lists": each stage contributes a list of
  // alternatives, and each alternative is a tuple `{ label, steps }`
  // — `steps` is the list of Steps that stage contributes to ONE cell
  // if this alternative is picked. Cartesian product of the choice
  // lists gives us every cell.
  type Choice = { label: string; steps: Step[] };
  const stageChoices: Choice[][] = matrix.stages.map((stage) =>
    stageChoicesFor(stage, matrix.mode)
  );

  // Cartesian product.
  const cells: SynthesizedCell[] = [];
  const tuple: Choice[] = [];

  function recurse(stageIdx: number): void {
    if (stageIdx === matrix.stages.length) {
      const tupleLabel = matrix.stages.map((s, i) => `${s.name}=${tuple[i].label}`).join(' ');
      const cellName = `${matrix.title} [${tupleLabel}]`;

      const body: Step[] = [];
      if (matrix.setup) body.push(matrix.setup);
      for (const choice of tuple) {
        for (const step of choice.steps) body.push(step);
      }

      cells.push({ cellName, tupleLabel, body });
      return;
    }
    const choices = stageChoices[stageIdx];
    for (const choice of choices) {
      tuple.push(choice);
      recurse(stageIdx + 1);
      tuple.pop();
    }
  }
  recurse(0);
  return cells;
}

interface SynthesizedCell {
  cellName: string;
  tupleLabel: string;
  body: Step[];
}

function stageChoicesFor(stage: StageDef, mode: MatrixMode): { label: string; steps: Step[] }[] {
  switch (stage.variantKind) {
    case 'oneOf': {
      const picks = mode === 'quick' ? [stage.variants[0]] : stage.variants;
      return picks.map((variant) => ({
        label: variant.defineName,
        steps: [variant],
      }));
    }
    case 'eachOf':
      // Always enumerate every variant — quick mode keeps terminal
      // coverage because each-of variants are typically mutually
      // exclusive destructive branches.
      return stage.variants.map((variant) => ({
        label: variant.defineName,
        steps: [variant],
      }));
    case 'bundleOf': {
      // Single choice that wraps every variant in a scoped-bundle
      // step. The label is `bundle` so the tuple string stays short;
      // failures naturally include the offending probe's name via the
      // executor's error propagation.
      const wrapped: ScopedBundleStep = {
        kind: 'scopedBundle',
        stageName: stage.name,
        variants: stage.variants,
        pos: stage.pos,
      };
      return [{ label: 'bundle', steps: [wrapped] }];
    }
  }
}

// ─── Execution context ─────────────────────────────────────────────────────

interface ExecCtx {
  /**
   * OUTER (test-level) variable scope. All captures, wallet `as`
   * bindings, and `repeat` counter writes go here, regardless of
   * whether the test is currently inside a parameterized `define`
   * body. Matches today's capture semantics: define authors can rely
   * on their captures being visible to the caller.
   */
  vars: Record<string, string>;
  /**
   * Structured event sink. Undefined when no observer is wired —
   * event emission is a no-op in that case, so the existing flat-log
   * path carries zero cost for callers that don't care.
   */
  emitEvent?: RunnerEventEmitter;
  /**
   * Nesting depth for events — 0 at top-level, +1 for each enclosing
   * block opener (if / repeat / run / stable / scopedBundle). The
   * reporter uses this to indent the live tree. `executeStep`
   * increments this around `runStep()` for block kinds, so nested
   * `executeBody` calls see the bumped value.
   */
  depth: number;
  /**
   * Stack of LOCAL variable frames pushed by `execRun` when a `run …
   * with <args>` invocation binds parameters. Top of stack shadows
   * lower frames, and both shadow `vars` (but `vars` is still written
   * to by captures). Popped on define exit so param bindings never
   * leak to callers.
   */
  localFrames: Record<string, string>[];
  suite: Suite;
  /**
   * Cross-suite define fallback (from `_shared/` etc). `execRun` checks
   * `ctx.suite.defines` first, then this map. Optional so single-file
   * test invocations still work.
   */
  globalDefines?: Map<string, Define>;
  /** Pretty test name — used as the label in the leading log line. */
  testName: string;
  /**
   * Relative path under the three artefact roots (`tests/.screenshots`,
   * `tests/.snapshots`, `tests/.diffs`). For plain tests this is just
   * `<sanitized-test-name>`. For matrix cells it's
   * `<matrix-title>/<cell-tuple>` — see `ExecuteOptions.artefactPath`
   * for the full rationale. Used by `dumpSnapshotDiff` to drop
   * failure artefacts into the matching cell's `.diffs/` bucket.
   */
  artefactPath: string;
  /** Defines currently on the call stack — used to detect recursion cycles. */
  runningDefines: Set<string>;
  /**
   * Stack of artefact directories mirroring the block structure of
   * the currently-executing test. The bottom of each stack is the
   * test's root dir; block handlers (`execRun`, `execScopedBundle`,
   * `execIf`, `execIfVar`, `execRepeat`, `execStable`) push a new
   * leaf `<NN-label>/` when they enter and pop on exit, so per-step
   * artefacts land in a directory tree that reads like the test's
   * story rather than one flat dump.
   *
   * Top of stack (`at(-1)`) is the active dir — every screenshot or
   * snapshot write consults it through `currentShotDir(ctx)` /
   * `currentSnapDir(ctx)`. The top never goes below length 1.
   */
  shotDirStack: string[];
  snapDirStack: string[];
  /**
   * Cached relative path (against the cell root) of the top of the
   * dir stack. Kept in sync by the block handlers so
   * `dumpSnapshotDiff` can mirror the same block hierarchy under
   * `tests/.diffs/<artefactPath>/<blockRelPath>/` without having to
   * re-derive the relative path from the two absolute strings on
   * every call.
   */
  blockRelPath: string;
  stepIndex: number;
  log: string[];
  /**
   * Append-a-log-line helper. Always pushes to `log` (for the returned
   * buffered transcript) AND forwards to `opts.onLog` if one was given,
   * so `phone test` can stream each line live as it's emitted. Use this
   * instead of `ctx.log.push(...)` everywhere — the extra callback hop
   * is what makes long-running steps (e.g. `wait for "Received"`) show
   * progress before they complete.
   */
  emit: (line: string) => void;
  /** True after we've pinged cocod once for this test. */
  walletPinged: boolean;
  /** Current `repeat` loop index, exposed as ${i} inside the body. Undefined outside loops. */
  repeatCounter: number | undefined;
}

// ─── Body execution (used by tests, defines, if/repeat blocks) ─────────────

async function executeBody(body: Step[], ctx: ExecCtx): Promise<void> {
  for (const step of body) {
    await executeStep(step, ctx);
  }
}

// ─── Step dispatch ─────────────────────────────────────────────────────────

/**
 * Result of executing a single step. `detail` is the text rendered on
 * the `→` tail line shown underneath the step's header; leave it
 * undefined (or an empty string) to suppress the tail entirely.
 *
 * Handlers should return JUST the new information that's worth showing
 * — e.g. a captured value, a matched wildcard id, a snapshot size. The
 * executor is responsible for the `→` prefix and indentation so every
 * step's output lines up consistently, and for falling back to a
 * variable-trace tail when a step has `${name}` interpolation but the
 * handler didn't provide its own detail.
 */
interface StepResult {
  detail?: string;
}

/**
 * Step kinds that open a block — their body runs as a nested sequence
 * of steps, each of which gets its own header/tail line in the log.
 * Because the reader sees those inner steps between the block's
 * opening header and its outcome, we format the block's success /
 * failure as a DEDICATED closing line (re-stating the block's step
 * index) rather than the normal indented tail that sits visually
 * "under" whatever ran last. Otherwise the outcome looks like a stray
 * second tail on the final inner step.
 */
function isBlockKind(step: Step): boolean {
  return (
    step.kind === 'stable' ||
    step.kind === 'if' ||
    step.kind === 'ifVar' ||
    step.kind === 'repeat' ||
    // `run` is a block in the sense that its sub-flow's steps render
    // between the `run` header and its closing line. Treating it as a
    // block keeps the close line anchored to the `run` step's own
    // index instead of floating under whatever the define's last
    // step was.
    step.kind === 'run' ||
    // `scopedBundle` is the matrix-synthesized bundle wrapper — same
    // rationale as `run`: its inner probes render between the bundle
    // header and the close line so the reader can see the isolation
    // boundary explicitly.
    step.kind === 'scopedBundle'
  );
}

/**
 * Flatten the executor's variable scopes into a single lookup record
 * for interpolation, assertion checks, and var-trace rendering. Local
 * frames (pushed by `run … with`) shadow the outer test scope, and
 * deeper local frames shadow shallower ones — standard lexical scope
 * semantics.
 *
 * Called fresh on every read because scopes are cheap to merge (the
 * outer object has at most a handful of captures, local frames carry
 * at most a handful of params) and caching would require invalidation
 * on every `push`/`pop`, which is more code than the savings are worth.
 *
 * Writes still go through `ctx.vars[name] = value` directly — that's
 * how captures preserve their "outer scope" semantics per the plan.
 */
function readVars(ctx: ExecCtx): Record<string, string> {
  if (ctx.localFrames.length === 0) return ctx.vars;
  const out: Record<string, string> = { ...ctx.vars };
  for (const frame of ctx.localFrames) {
    Object.assign(out, frame);
  }
  return out;
}

/**
 * Shared operator evaluator used by both `assert $var <op> <rhs>` and
 * the new `if $var <op> <rhs>` block. Extracted so the two forms can't
 * diverge — one implementation, one set of numeric coercion rules,
 * one set of error messages.
 *
 * Returns `true` when the comparison holds, `false` when it doesn't.
 * Throws on malformed inputs (invalid regex, non-numeric `gt` operands)
 * so the caller can attribute the failure to the step the user wrote.
 */
function evaluateVarOp(
  op: AssertVarStep['op'],
  lhs: string,
  rhs: string,
  contextLabel: string
): boolean {
  switch (op) {
    case 'starts-with':
      return lhs.startsWith(rhs);
    case 'contains':
      return lhs.includes(rhs);
    case 'matches': {
      let re: RegExp;
      try {
        re = new RegExp(rhs);
      } catch {
        throw new Error(`${contextLabel}: invalid regex "${rhs}"`);
      }
      return re.test(lhs);
    }
    case 'eq':
      return lhs === rhs;
    case 'gt': {
      const a = Number(lhs);
      const b = Number(rhs);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new Error(`${contextLabel}: non-numeric operand ("${lhs}" / "${rhs}")`);
      }
      return a > b;
    }
    case 'cashu-amount': {
      const { decodeCashuAmount } = require('./cashu-decode') as typeof import('./cashu-decode');
      const amount = decodeCashuAmount(lhs);
      const expected = Number(rhs);
      if (!Number.isFinite(expected)) {
        throw new Error(`${contextLabel}: non-numeric rhs "${rhs}"`);
      }
      return amount === expected;
    }
    case 'bolt11-amount': {
      const { decodeBolt11Amount } = require('./cashu-decode') as typeof import('./cashu-decode');
      const amount = decodeBolt11Amount(lhs);
      const expected = Number(rhs);
      if (!Number.isFinite(expected)) {
        throw new Error(`${contextLabel}: non-numeric rhs "${rhs}"`);
      }
      return amount === expected;
    }
  }
}

async function executeStep(step: Step, ctx: ExecCtx): Promise<void> {
  const idx = ctx.stepIndex++;

  // Pre-step "header" line — emitted BEFORE the step runs so long
  // operations (wait for, wallet send, tap) show up immediately instead
  // of appearing only when they complete. The header always reflects
  // what the test author wrote (interpolation tokens intact) so you can
  // cross-reference against the .sov source file.
  const src = describeStep(step);
  ctx.emit(`  [${idx}] ${src}`);

  const blockStep = isBlockKind(step);

  // Structured event for observers (TTY reporter, etc). Depth is
  // captured BEFORE we increment for the block, so a block opener
  // renders at the same depth as its siblings while its body renders
  // at depth + 1.
  const stepStartedAt = Date.now();
  ctx.emitEvent?.({
    type: 'step.begin',
    t: stepStartedAt,
    index: idx,
    depth: ctx.depth,
    source: src,
    isBlock: blockStep,
    kind: step.kind,
  });

  // Run the step's handler, capturing any thrown error so we can
  // emit post-step artefacts (screenshot + snapshot) through a
  // unified path regardless of outcome.
  //
  // Why unified: we used to take a dedicated `-FAIL.png` screenshot
  // in the error branch and a separate plain `NN-<label>.png` in the
  // success branch, which made the filesystem layout diverge
  // depending on whether each step passed. The user's preference
  // (captured in memory as `feedback_no_fail_screenshots`) is that
  // every step should produce exactly ONE post-step file at the same
  // filename pattern — the regular screenshot already captures the
  // visual state at the moment of failure, and the forthcoming
  // snapshot-diff tooling will make pass/fail obvious from the
  // `.snap` diff itself. One code path, one artefact per step.
  if (blockStep) ctx.depth++;
  let result: StepResult | null = null;
  let caught: unknown = null;
  try {
    result = await runStep(step, ctx);
  } catch (err) {
    caught = err;
  }
  if (blockStep) ctx.depth--;

  // Brief settle for nav/animation, then capture post-step
  // screenshot + per-step AX snapshot.
  //
  // Screenshots are only taken for steps that change or observe device
  // state (taps, waits, launches, wallet ops). Conditionals, asserts,
  // captures, and block control-flow are skipped — they don't change
  // the screen and add noise to the artefact directory.
  //
  // AX snapshots are kept unconditional (small text files, primary
  // debugging record). Short-circuited block openers (null result with
  // no error) still skip the snap dump because their body's inner
  // steps already captured the state they care about.
  // Steps that change or observe device state — screenshots and AX
  // snapshots are only captured for these. Assertions, captures,
  // conditionals, and block control-flow are pure logic that never
  // change what's on screen, so their post-step tree fetch is wasted
  // (~5-15s per step on dense screens).
  const VISUAL_KINDS = new Set([
    'launch',
    'home',
    'back',
    'tap',
    'type',
    'keypad',
    'swipe',
    'scrollUntil',
    'dismiss',
    'waitFor',
    'screenshot',
    'wallet',
  ]);
  const isVisual = VISUAL_KINDS.has(step.kind);
  if (isVisual) await sleep(150);
  if (isVisual || caught !== null) {
    try {
      await takeScreenshot(screenshotPath(ctx, idx, src));
    } catch {
      /* best effort */
    }
  }
  if ((isVisual || caught !== null) && (result !== null || caught !== null)) {
    try {
      await dumpStepSnapshot(ctx, idx, src);
    } catch {
      /* best effort — snapshot dumping must never break a passing test */
    }
  }

  // Failure path: emit the step.end event + the visible error line(s),
  // then re-throw so `executeTest`'s outer catch short-circuits the
  // rest of the body.
  const fmtStepDur = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
  if (caught !== null) {
    const err = caught;
    const msg = err instanceof Error ? err.message : String(err);
    const firstLine = msg.split('\n', 1)[0];
    const endEvent: import('./events').StepEndEvent = {
      type: 'step.end',
      t: Date.now(),
      index: idx,
      ok: false,
      isBlock: blockStep,
    };
    if (firstLine) endEvent.error = firstLine;
    ctx.emitEvent?.(endEvent);
    const durTag = `  (${fmtStepDur(Date.now() - stepStartedAt)})`;
    if (blockStep) {
      // Block closing line on failure. Re-states the step index and
      // verb so the reader can see exactly which block failed — then
      // the one-line message from the error (usually the rendered
      // diff for a stable drift, or "body aborted: …" for a bubbled
      // inner-step failure).
      ctx.emit(`  [${idx}] ✗ ${src} — ${firstLine}${durTag}`);
    } else {
      // Non-block failure — emit the first line as the headline, then
      // any subsequent lines indented below. Splitting per line (same
      // discipline as the block path) keeps every `ctx.emit` call
      // strictly single-line, which downstream consumers (matrix
      // stamp writer, TTY reporter) rely on for safe embedding.
      ctx.emit(`        ✗ ${firstLine}${durTag}`);
    }
    // Extra lines from the error message (rendered diffs, multi-line
    // troubleshooting hints, stack-like context) get indented below
    // whichever headline we just emitted. Each `ctx.emit` call
    // strictly single-line — never embed a newline-containing string
    // into a single emit or the matrix stamp rewriter will splice a
    // broken comment block into the `.sov` file.
    const rest = msg.slice(firstLine.length + 1);
    if (rest.length > 0) {
      for (const line of rest.split('\n')) ctx.emit(`        ${line}`);
    }
    throw err;
  }

  // Success path. Figure out what goes on the post-step tail line.
  // Every non-block step gets EXACTLY one tail — either a `→` line
  // with the detail, or a bare `✓` that explicitly confirms the step
  // ran without producing any output. The implicit-success-is-silent
  // model was too subtle: `dismiss`, `wait for screen ...`, `assert
  // screen eq ...` all looked identical to a skipped step, and users
  // had to count ✗ lines to know whether the test actually did
  // anything.
  //
  // Detail priority:
  //   1. Handler-supplied detail always wins — the handler knows best
  //      what's interesting (captured value, matched id, snapshot size).
  //   2. Else, if the source has `${name}` tokens, surface the current
  //      variable values so you can see what got wired in without
  //      grepping backwards for the `capture` that set them.
  //   3. Else, a bare `✓` so the step's outcome is still visible.
  if (result !== null) {
    let detail = result.detail;
    if (!detail || detail.length === 0) {
      detail = formatVarValues(src, readVars(ctx));
    }
    const endEvent: import('./events').StepEndEvent = {
      type: 'step.end',
      t: Date.now(),
      index: idx,
      ok: true,
      isBlock: blockStep,
    };
    if (detail && detail.length > 0) endEvent.detail = detail;
    ctx.emitEvent?.(endEvent);
    const durTag = `  (${fmtStepDur(Date.now() - stepStartedAt)})`;
    if (blockStep) {
      // Block closing line on success. Re-states the step index +
      // verb and appends the detail if any — lives at the same left
      // margin as the block header, not indented under the final
      // inner step, so you can trace the whole block structure by
      // scanning for matching `[N]` prefixes.
      const suffix = detail && detail.length > 0 ? ` — ${detail}` : '';
      ctx.emit(`  [${idx}] ✓ ${src}${suffix}${durTag}`);
    } else if (detail && detail.length > 0) {
      ctx.emit(`        → ${detail}${durTag}`);
    } else {
      ctx.emit(`        ✓${durTag}`);
    }
  } else {
    // A `null` result from a block opener means the block was
    // short-circuited (e.g. `if visible` with the guard false). Still
    // emit a step.end so observers can close their tree representation.
    ctx.emitEvent?.({
      type: 'step.end',
      t: Date.now(),
      index: idx,
      ok: true,
      isBlock: blockStep,
    });
  }
}

/**
 * Build a pruned AX snapshot of the current screen and write it to
 * `tests/.snapshots/<artefactPath>/NN-<label>.snap` in text form.
 *
 * Runs AFTER the step's post-settle delay so the tree is stable — if
 * we grabbed it mid-animation we'd see a frozen frame of the ongoing
 * transition. Best-effort: any error (WDA disconnect, fs write fail,
 * empty tree) is swallowed at the call site so the test pipeline
 * doesn't fail on telemetry noise.
 */
async function dumpStepSnapshot(ctx: ExecCtx, idx: number, label: string): Promise<void> {
  const tree = await getCurrentTree();
  const raw = buildSnapshot(tree);
  if (!raw) return;
  const pruned = pruneSnapshot(raw);
  const text = formatSnapshotText(pruned);
  const file = stepSnapshotPath(ctx, idx, label);
  fs.writeFileSync(file, text);
}

/**
 * Regex used to pull every `${name}` token out of a describeStep string.
 * Matches the shape accepted by the interpolation module, so any source
 * step a test author writes will have its variable references surfaced.
 */
const VAR_REF_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * Render the variable-values tail for a step that contains `${name}`
 * interpolation references. Format choices:
 *
 *   - Zero references → empty string (no tail line).
 *   - One reference   → just the value, unwrapped: `81`.
 *   - Many references → `name=value, name=value` pairs in source order.
 *
 * The single-var case drops the key because the header already shows
 * which variable is being referenced (there's only one), so repeating
 * its name is pure noise. Multi-var tests disambiguate with `key=value`.
 *
 * Unset variables render as `<undefined>` rather than being omitted —
 * you want to see the misconfiguration, not silently lose it.
 */
function formatVarValues(sourceText: string, vars: Record<string, string>): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  VAR_REF_RE.lastIndex = 0;
  while ((m = VAR_REF_RE.exec(sourceText)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      names.push(m[1]);
    }
  }
  if (names.length === 0) return '';
  const valueOf = (name: string): string => {
    const v = vars[name];
    return v === undefined ? '<undefined>' : preview(v, 60);
  };
  if (names.length === 1) return valueOf(names[0]);
  return names.map((n) => `${n}=${valueOf(n)}`).join(', ');
}

/**
 * Execute one step and return the tail-line detail (if any). A `null`
 * return is reserved for block openers that have no immediate effect of
 * their own; a `{}` return means "success, no detail worth showing".
 *
 * Handlers should keep `detail` narrow — it's rendered after a `→`
 * prefix in the log and must not repeat information already on the
 * step's header line. The executor automatically falls back to a
 * variable-values tail when a step has `${name}` interpolation and the
 * handler didn't supply its own detail, so tap/wait handlers with no
 * novel output can just return `{}`.
 */
async function runStep(step: Step, ctx: ExecCtx): Promise<StepResult | null> {
  switch (step.kind) {
    // ── App lifecycle ──
    case 'launch':
      await relaunchApp(step.bundleId);
      return {};
    case 'home':
      await pressHome();
      return {};
    case 'back':
      return await execBack();

    // ── Tap / type / keypad ──
    case 'tap':
      return await execTap(step, ctx);
    case 'type':
      return await execType(step, ctx);
    case 'keypad': {
      // Interpolate `${name}`/`$name` refs at runtime so
      // parameterized defines can drive the keypad from a caller-
      // supplied amount. Re-validates the resolved value so a caller
      // accidentally passing "10" through a param gets a clear
      // runtime error rather than a silent no-op.
      const resolved = interpolateString(step.digit, readVars(ctx));
      if (!/^[0-9]$/.test(resolved)) {
        throw new Error(
          `keypad: expected a single digit 0-9 after interpolation, got '${resolved}'`
        );
      }
      await tapKeypadDigit(resolved);
      return {};
    }

    // ── Gestures ──
    case 'swipe':
      await swipe(step.direction);
      return {};
    case 'scrollUntil':
      return await execScrollUntil(step, ctx);
    case 'dismiss':
      await dismissModal();
      return {};

    // ── Wait ──
    case 'waitFor':
      return await execWaitFor(step, ctx);

    // ── Assert ──
    case 'assertVisible':
      return await execAssertVisible(step, ctx);
    case 'assertNotVisible':
      return await execAssertNotVisible(step, ctx);
    case 'assertVar':
      return execAssertVar(step, ctx);
    case 'assertScreenEq':
      return await execAssertScreenEq(step, ctx);

    // ── Capture ──
    case 'captureLabel':
      return await execCaptureLabel(step, ctx);
    case 'captureSuffix':
      return await execCaptureSuffix(step, ctx);
    case 'captureClipboard':
      return await execCaptureClipboard(step, ctx);
    case 'setClipboard':
      return await execSetClipboard(step, ctx);

    // ── Snapshot ──
    case 'snapshot':
      return await execSnapshot(step, ctx);

    // ── Screenshot ──
    case 'screenshot':
      return await execScreenshot(step, ctx);

    // ── Control flow ──
    case 'if':
      return await execIf(step, ctx);
    case 'ifVar':
      return await execIfVar(step, ctx);
    case 'repeat':
      return await execRepeat(step, ctx);
    case 'run':
      return await execRun(step, ctx);
    case 'stable':
      return await execStable(step, ctx);
    case 'scopedBundle':
      return await execScopedBundle(step, ctx);

    // ── Wallet ──
    case 'wallet':
      return execWalletStep(step, ctx);
  }
}

// ─── Per-step handlers ─────────────────────────────────────────────────────

/**
 * Resolve a selector against the current variable scope. Selectors can
 * contain `${name}` interpolation references — e.g.
 * `#transaction-send-${sendId}` — which need to be expanded to a concrete
 * testID before the find/tap helpers can use them.
 *
 * Returns a new Selector; the original is not mutated.
 */
function resolveSelector(sel: Selector, vars: Record<string, string>): Selector {
  if (sel.kind === 'id') {
    return { ...sel, id: interpolateString(sel.id, vars) };
  }
  if (sel.kind === 'idPrefix') {
    // Spread preserves the `first` flag alongside interpolated prefix.
    return { ...sel, prefix: interpolateString(sel.prefix, vars) };
  }
  return { ...sel, text: interpolateString(sel.text, vars) };
}

async function execBack(): Promise<StepResult> {
  const tree = await getCurrentTree();
  const hit = findTopmostNavBackButton(tree);
  if (!hit) {
    throw new Error('back: no navigation bar with a tappable back button on the current screen');
  }
  await tapXY(hit.centerX, hit.centerY);
  return {};
}

async function execTap(step: TapStep, ctx: ExecCtx): Promise<StepResult> {
  const sel = resolveSelector(step.selector, readVars(ctx));

  // ── Optional `expect no-change` ──
  if (step.expectNoChange) {
    const before = await snapshotForDiff(undefined);
    await performTap(sel, step.whenVisible !== undefined, step.whenVisible?.withinMs);
    await sleep(1000);
    const after = await snapshotForDiff(undefined);
    if (!before || !after) {
      throw new Error('tap expect no-change: failed to snapshot screen');
    }
    const diff = diffSnapshots(before, after);
    if (diff.length > 0) {
      throw new Error(
        `tap ${describeSelector(sel)} expect no-change — screen changed:\n${renderDiff(diff, 'screen changed after tap')}`
      );
    }
    return {};
  }

  await performTap(sel, step.whenVisible !== undefined, step.whenVisible?.withinMs);
  // No detail — the executor will auto-surface `${var}` values as the
  // tail line if the source has any interpolation references.
  return {};
}

async function performTap(
  sel: Selector,
  whenVisible: boolean,
  withinMs: number | undefined
): Promise<void> {
  // Outer retry: up to 2 attempts. The second attempt only runs if
  // the first one failed with an error that looks like "the element
  // I was trying to tap was gone from the tree by the time I fetched
  // it", which is what happens when a notification banner from a
  // background app (Signal, Messages, a payment notification from
  // Sovran itself) slides in during the narrow window between the
  // end of `waitForID` and the tap's own tree fetch. The preflight
  // call at the start of each attempt dismisses the banner, so the
  // retry lands on a clean tree.
  //
  // Only the "element not there" family of errors retry — a genuine
  // off-screen error, a bad selector, or any other explicit failure
  // surfaces immediately so tests fail fast when the cause isn't
  // transient.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Pre-flight: dismiss the Expo dev menu, notification banners,
    // and the iOS app switcher before the tap. Runs at the start of
    // every attempt so a late obstruction between iterations gets
    // cleared on the second pass.
    await preflightDismissDevMenu();

    try {
      if (sel.kind === 'id') {
        if (whenVisible) await waitForID(sel.id, withinMs);
        await tapByID(sel.id);
        return;
      }
      if (sel.kind === 'text') {
        if (whenVisible) await waitForText(sel.text, withinMs);
        await tapByText(sel.text);
        return;
      }
      // idPrefix taps — resolve the wildcard to a concrete node and
      // tap its centre. `findPrefixNode` honours the `first` flag when
      // present so `tap #amount-chip-* first` deterministically lands
      // on the left-most chip instead of the y-unstable topmost match.
      const tree = await getCurrentTree();
      const flat = flattenAll(tree);
      const node = findPrefixNode(flat, sel);
      if (!node || !node.rect) {
        throw new Error(`tap ${describeSelector(sel)}: no matching element on the current screen`);
      }
      await tapXY(node.centerX, node.centerY);
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Only retry on the transient "element missing from tree" case.
      // Examples: `no element with testID="foo"`, `tap #foo*: no
      // matching element on the current screen`, `timeout after
      // 10000ms` (waitForID couldn't find the element because the
      // tree was stuck on switcher/banner for the whole poll window).
      // Off-screen guards, keypad-not-found, and other deterministic
      // failures bubble up immediately.
      const retryable =
        /no element with testID/.test(msg) ||
        /no matching element on the current screen/.test(msg) ||
        /^timeout after \d+ms$/.test(msg);
      if (!retryable || attempt === 1) throw err;
      // Fall through to next attempt after preflight.
    }
  }
  // Unreachable in practice — the loop either returns or throws — but
  // TS needs a terminal path.
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function execType(step: TypeStep, ctx: ExecCtx): Promise<StepResult> {
  const text = interpolateString(step.text, readVars(ctx));
  let resolvedInto: Selector | undefined;
  if (step.into) {
    resolvedInto = resolveSelector(step.into, readVars(ctx));
    if (resolvedInto.kind === 'id') await tapByID(resolvedInto.id);
    else if (resolvedInto.kind === 'text') await tapByText(resolvedInto.text);
    else throw new Error(`type into <#prefix*> is not supported`);
  }
  await typeKeys(text);
  // The executor auto-surfaces `${var}` values from the source if any
  // interpolation happened — no explicit detail needed here.
  return {};
}

async function execScrollUntil(step: ScrollUntilStep, ctx: ExecCtx): Promise<StepResult> {
  const sel = resolveSelector(step.selector, readVars(ctx));
  const label = describeSelector(sel);
  // Build a lookup predicate matching the selector kind.
  // `scrollUntilVisible` takes a callback instead of a selector because
  // it re-queries the tree on every iteration and we want to keep
  // selector semantics (`idPrefix` prefers visually-topmost matches,
  // `id` is exact, …) consistent with the rest of the runner. Text
  // selectors aren't supported — they have no stable "topmost" ordering
  // and scroll-until is explicitly about landing the right element
  // under a subsequent tap.
  if (sel.kind === 'text') {
    throw new Error(
      `scroll until "${sel.text}": only #testID and #prefix* selectors are supported`
    );
  }
  const predicate = (flat: FlatNode[]): FlatNode | null => {
    if (sel.kind === 'id') return findByTestID(flat, sel.id);
    return findPrefixNode(flat, sel);
  };
  const node = await scrollUntilVisible(predicate, step.direction, label, step.withinMs);
  void ctx;
  // Surface the final matched id on the tail so authors can see what
  // landed in the viewport — same convention as `wait for #foo-*`.
  return { detail: `#${node.identifier}` };
}

async function execWaitFor(step: WaitForStep, ctx: ExecCtx): Promise<StepResult> {
  const sel = resolveSelector(step.selector, readVars(ctx));
  // No burst capture on waits: the post-step screenshot + snapshot
  // that `executeStep` takes once the wait completes is the only
  // frame that matters for review. Capturing every ~300ms while we
  // poll floods `tests/.screenshots/` with `wait-<N>-<frame>.png`
  // files that all look like a blurry version of the final state.
  //
  // `within Ns` from the source applies to BOTH id and text selectors
  // as well as the idPrefix branch below. Historically the id/text
  // paths silently dropped the modifier and always used the default
  // 10s step timeout, so a `wait for screen #screen-wallet within 20s`
  // was clipped to 10s. Now the user-supplied budget is forwarded.
  if (sel.kind === 'id') {
    await waitForID(sel.id, step.withinMs);
    return {};
  }
  if (sel.kind === 'text') {
    await waitForText(sel.text, step.withinMs);
    return {};
  }
  // idPrefix wait — poll until any matching node appears. Capture the
  // matched node so we can surface its full id on the tail line
  // (`→ #transaction-send-81`), which is the whole point of the
  // wildcard form from the test author's perspective. Honours the
  // `first` flag via `findPrefixNode`.
  const deadline = Date.now() + (step.withinMs ?? 90_000);
  let matched: string | null = null;
  while (Date.now() < deadline) {
    try {
      const tree = await getCurrentTree();
      const flat = flattenAll(tree);
      const node = findPrefixNode(flat, sel);
      if (node) {
        matched = node.identifier;
        break;
      }
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  if (!matched) throw new Error(`wait for ${describeSelector(sel)}: timed out`);
  void ctx;
  return { detail: `#${matched}` };
}

async function execAssertVisible(step: AssertVisibleStep, ctx: ExecCtx): Promise<StepResult> {
  const sel = resolveSelector(step.selector, readVars(ctx));
  if (step.withinMs) {
    if (sel.kind === 'id') await waitForID(sel.id, step.withinMs);
    else if (sel.kind === 'text') await waitForText(sel.text, step.withinMs);
    else throw new Error(`assert ... visible within Ns: idPrefix not supported`);
    return {};
  }
  if (sel.kind === 'id') await assertID(sel.id);
  else if (sel.kind === 'text') await assertText(sel.text);
  else {
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    if (!findPrefixNode(flat, sel)) {
      throw new Error(`assert ${describeSelector(sel)} visible: not present`);
    }
  }
  return {};
}

async function execAssertNotVisible(step: AssertNotVisibleStep, ctx: ExecCtx): Promise<StepResult> {
  const sel = resolveSelector(step.selector, readVars(ctx));
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  let found = false;
  if (sel.kind === 'id') found = findByTestID(flat, sel.id) !== null;
  else if (sel.kind === 'text') {
    // findByText returns a TextMatch object, null if no match.
    found = flat.some((n) => n.label === sel.text || n.name === sel.text);
  } else found = findPrefixNode(flat, sel) !== null;

  if (found) {
    throw new Error(`assert ${describeSelector(sel)} not visible: element IS present`);
  }
  return {};
}

function execAssertVar(step: AssertVarStep, ctx: ExecCtx): StepResult {
  const vars = readVars(ctx);
  const value = vars[step.varName];
  if (value === undefined) {
    const bound = Object.keys(vars).join(', ') || 'none';
    throw new Error(`assert $${step.varName}: undefined variable (bound: ${bound})`);
  }
  const rhsStr = resolveRhs(step.rhs, vars, `assert $${step.varName} ${step.op}`);
  const label = `assert $${step.varName} ${step.op} ${formatRhsForError(step.rhs, rhsStr)}`;
  const ok = evaluateVarOp(step.op, value, rhsStr, label);
  if (!ok) {
    throw new Error(`${label}: "${preview(value)}" does not match`);
  }
  return {};
}

/**
 * Resolve the right-hand side of a variable comparison. Literals go
 * through string interpolation so `"${prefix}-foo"` works; `$var` refs
 * are looked up in the provided flattened scope. Shared between
 * `execAssertVar` and `execIfVar` so both forms accept the same grammar.
 */
function resolveRhs(
  rhs: AssertVarStep['rhs'],
  vars: Record<string, string>,
  contextLabel: string
): string {
  if (rhs.kind === 'literal') {
    return interpolateString(rhs.value, vars);
  }
  const v = vars[rhs.name];
  if (v === undefined) {
    throw new Error(`${contextLabel} $${rhs.name}: rhs variable undefined`);
  }
  return v;
}

function formatRhsForError(rhs: AssertVarStep['rhs'], resolved: string): string {
  if (rhs.kind === 'literal') return `"${preview(resolved, 30)}"`;
  return `$${rhs.name}`;
}

async function execAssertScreenEq(step: AssertScreenEqStep, ctx: ExecCtx): Promise<StepResult> {
  const stored = readVars(ctx)[step.varName];
  if (!stored) {
    throw new Error(`assert ... eq $${step.varName}: variable not set`);
  }
  const before = deserializeSnapshot(stored);
  const sel = step.selector ? resolveSelector(step.selector, readVars(ctx)) : undefined;
  const fresh = await snapshotForDiff(sel);
  if (!fresh) {
    throw new Error(`assert ... eq $${step.varName}: failed to snapshot current screen`);
  }
  const diff = diffSnapshots(before, fresh);
  if (diff.length > 0) {
    const rendered = renderDiff(diff, `screen differs from $${step.varName}`);
    // Persist the full diff + both snapshots so the user can grep for any
    // single field that needs an entry in `tests/.snapshot-ignores`.
    const dumpPath = dumpSnapshotDiff(
      ctx,
      `assert-screen-eq-${step.varName}`,
      rendered,
      stored,
      serializeSnapshot(fresh)
    );
    throw new Error(
      `${rendered}\n\n(full diff + snapshots dumped to ${nodePath.relative(process.cwd(), dumpPath)})`
    );
  }
  return {};
}

async function execCaptureLabel(step: CaptureLabelStep, ctx: ExecCtx): Promise<StepResult> {
  const sel = resolveSelector(step.selector, readVars(ctx));
  if (sel.kind !== 'id') {
    throw new Error(`capture <${describeSelector(sel)}> as: only #testID selectors are supported`);
  }
  // ── Fast path: session-based element label read ──
  // Avoids the full tree fetch (~15-30s) by using the cached WDA
  // session to find the element and read its label attribute directly.
  try {
    const label = await captureElementLabel(sel.id);
    if (label) {
      ctx.vars[step.varName] = label;
      return { detail: `"${preview(label)}" (${label.length} chars)` };
    }
  } catch {
    // Fall through to tree path.
  }

  // ── Slow fallback: full tree fetch with retry ──
  const CAPTURE_RETRY_MS = 3_000;
  const deadline = Date.now() + CAPTURE_RETRY_MS;
  let node: FlatNode | null = null;
  let didPreflight = false;
  while (Date.now() < deadline) {
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    node = findByTestID(flat, sel.id);
    if (node) break;
    if (!didPreflight) {
      didPreflight = true;
      await preflightDismissDevMenu();
      continue;
    }
    await sleep(150);
  }
  if (!node) {
    throw new Error(`capture #${sel.id} as $${step.varName}: element not on current screen`);
  }
  const value = node.label || node.name || '';
  if (!value) {
    throw new Error(
      `capture #${sel.id} as $${step.varName}: element has no accessibility label/name`
    );
  }
  ctx.vars[step.varName] = value;
  return { detail: `"${preview(value)}" (${value.length} chars)` };
}

async function execCaptureSuffix(step: CaptureSuffixStep, ctx: ExecCtx): Promise<StepResult> {
  const sel = resolveSelector(step.selector, readVars(ctx));
  if (sel.kind !== 'idPrefix') {
    throw new Error(`capture ... suffix as: requires a wildcard selector (#prefix*)`);
  }
  // Retry loop matching execCaptureLabel — the element may not yet be
  // present if a popup is animating in or the screen is settling after
  // an external state change (e.g. cocod redeeming a token).
  const CAPTURE_RETRY_MS = 3_000;
  const deadline = Date.now() + CAPTURE_RETRY_MS;
  let node: FlatNode | null = null;
  let didPreflight = false;
  while (Date.now() < deadline) {
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    node = findPrefixNode(flat, sel);
    if (node) break;
    if (!didPreflight) {
      didPreflight = true;
      await preflightDismissDevMenu();
      continue;
    }
    await sleep(150);
  }
  if (!node) {
    throw new Error(
      `capture ${describeSelector(sel)} suffix as $${step.varName}: no matching testID on screen`
    );
  }
  const suffix = node.identifier.slice(sel.prefix.length);
  ctx.vars[step.varName] = suffix;
  // Suffixes are always plain identifiers (digits / kebab-case) so we
  // render them unquoted — `→ 81` reads better than `→ "81"` and the
  // test author's mental model is "the id that matched".
  return { detail: suffix };
}

async function execCaptureClipboard(step: CaptureClipboardStep, ctx: ExecCtx): Promise<StepResult> {
  const text = await readClipboard();
  ctx.vars[step.varName] = text;
  return { detail: `"${preview(text)}" (${text.length} chars)` };
}

async function execSetClipboard(step: SetClipboardStep, ctx: ExecCtx): Promise<StepResult> {
  const text = interpolateString(step.text, readVars(ctx));
  await writeClipboard(text);
  return { detail: `${text.length} chars` };
}

async function execSnapshot(step: SnapshotStep, ctx: ExecCtx): Promise<StepResult> {
  const sel = step.selector ? resolveSelector(step.selector, readVars(ctx)) : undefined;
  const snap = await snapshotForDiff(sel);
  if (!snap) {
    throw new Error(`snapshot ... as $${step.varName}: failed (selector did not match)`);
  }
  const serialized = serializeSnapshot(snap);
  ctx.vars[step.varName] = serialized;
  // Surface the serialized snapshot size — useful for spotting when a
  // screen suddenly grew or shrank between runs (often a hint that a
  // session-variable pattern needs to be added to .snapshot-ignores).
  // The node count is more meaningful than bytes but we don't track it
  // in the serialized form, so bytes is what we've got.
  return { detail: `${serialized.length} bytes` };
}

async function snapshotForDiff(
  selector: Selector | undefined
): Promise<ReturnType<typeof buildSnapshot>> {
  const tree = await getCurrentTree();
  const raw = !selector
    ? buildSnapshot(tree)
    : selector.kind !== 'id'
      ? (() => {
          throw new Error(
            `snapshot ${describeSelector(selector)}: only #testID selectors are supported`
          );
        })()
      : buildSnapshot(tree, { kind: 'id', id: selector.id });
  if (!raw) return null;
  // Prune to the semantic skeleton BEFORE serializing/diffing. Raw
  // React Native AX trees are 30–60 levels of anonymous `Other`
  // wrappers (every RN `<View>` becomes an `RCTView` classified as
  // `XCUIElementTypeOther`); comparing them directly produces huge,
  // unreadable diffs on trivial layout reflows. Pruning collapses the
  // scaffolding and leaves only meaningful nodes (testID / label /
  // interactive types), giving `stable ... across` and `assert screen
  // eq` the same skeleton the git-committed per-step snapshots use.
  return pruneSnapshot(raw);
}

async function execScreenshot(step: ScreenshotStep, ctx: ExecCtx): Promise<StepResult> {
  const dir = nodePath.join(SCREENSHOTS_DIR, 'manual');
  fs.mkdirSync(dir, { recursive: true });
  const out = await takeScreenshot(nodePath.join(dir, `${sanitizeForFile(step.name)}.png`));
  void ctx;
  return { detail: nodePath.relative(process.cwd(), out) };
}

// ── Control flow ──

async function execIf(step: IfStep, ctx: ExecCtx): Promise<StepResult> {
  const sel = resolveSelector(step.selector, readVars(ctx));
  const visible = await isVisibleNow(sel);
  const branch = step.negated ? !visible : visible;
  if (branch) {
    // Push a nested artefact dir only after the guard resolves true.
    // This keeps the filesystem clean of empty `NN-if-not-visible-foo/`
    // dirs from the overwhelmingly common short-circuit case where
    // the element simply isn't on screen.
    await withBlockDir(ctx, ctx.stepIndex - 1, step, async () => {
      await executeBody(step.body, ctx);
    });
    return { detail: `ran ${step.body.length} step(s)` };
  }
  return { detail: 'skipped' };
}

/**
 * Peek the AX tree ONCE and look for the selector. Single fetch, no
 * polling — `if visible` is a point-in-time check ("is this here right
 * now?"), not a "wait for it to show up" check. If an author wants to
 * wait for the element, that's exactly what `wait for <selector>` is
 * for.
 *
 * The previous implementation polled for 2 full seconds at 200ms
 * intervals, which burned ~1–2 seconds per `if visible` step on the
 * expected-false branch (where the element never appears). In the
 * probe bundle that meant ~4s/cell of pure dead time across
 * `probe-copy-as-emoji` and `probe-check-status`, both of which start
 * with `if not visible <hidden-button>` guards that evaluate false
 * every run.
 */
async function isVisibleNow(sel: Selector): Promise<boolean> {
  try {
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    if (sel.kind === 'id') return findByTestID(flat, sel.id) !== null;
    if (sel.kind === 'text') {
      return flat.some((n) => n.label === sel.text || n.name === sel.text);
    }
    return findPrefixNode(flat, sel) !== null;
  } catch {
    return false;
  }
}

async function execRepeat(step: RepeatStep, ctx: ExecCtx): Promise<StepResult> {
  const prevCounter = ctx.repeatCounter;
  // Skip the whole push/pop when count == 0 — no body ever runs, so
  // there's nothing to bucket. The `ran 0 step(s)` detail still
  // surfaces on the closing line via the caller's result handling.
  if (step.count === 0) {
    ctx.repeatCounter = prevCounter;
    return { detail: 'ran 0 step(s)' };
  }
  // All N iterations share ONE nested dir. The per-iteration artefacts
  // are distinguishable by their global step index (which increments
  // across iterations because every inner step fires `executeStep`),
  // so `05-tap-foo.png` on iter 1 and `08-tap-foo.png` on iter 2
  // never collide even though they live in the same folder.
  await withBlockDir(ctx, ctx.stepIndex - 1, step, async () => {
    for (let i = 0; i < step.count; i++) {
      ctx.repeatCounter = i;
      ctx.vars['i'] = String(i);
      await executeBody(step.body, ctx);
    }
  });
  ctx.repeatCounter = prevCounter;
  if (prevCounter === undefined) delete ctx.vars['i'];
  else ctx.vars['i'] = String(prevCounter);
  return { detail: `ran ${step.count * step.body.length} step(s)` };
}

/**
 * `stable <selector> across ... end` — round-trip stability check.
 *
 * Takes a snapshot at block entry, runs the body, takes a fresh
 * snapshot at block exit, and fails the step if they differ. Every
 * step inside the body is still executed via `executeStep`, so it
 * gets its own log line + success indicator just like a top-level
 * step. The `stable` header line is emitted before the block runs so
 * the reader can see "this whole block is a stability check" without
 * having to read to the `end`.
 *
 * On a diff, the full rendered diff + both serialized snapshots land
 * in `tests/.diffs/<artefactPath>/stable-...txt` so a test author can
 * grep for the specific field that needs a `.snapshot-ignores`
 * entry — same pattern as the legacy `assert screen eq` path.
 */
async function execStable(step: StableStep, ctx: ExecCtx): Promise<StepResult> {
  const sel = resolveSelector(step.selector, readVars(ctx));
  if (sel.kind !== 'id') {
    throw new Error(`stable <${describeSelector(sel)}>: only #testID selectors are supported`);
  }
  const before = await snapshotForDiff(sel);
  if (!before) {
    throw new Error(`failed to capture initial snapshot (selector did not match)`);
  }
  const beforeSerialized = serializeSnapshot(before);

  // Wrap the body (and the subsequent stability comparison) inside a
  // nested artefact dir so every inner probe's screenshots and
  // snapshots land under `NN-stable-<selector>/`. The final-snapshot
  // capture runs INSIDE the block dir too so its AX snap dumps into
  // the same bucket as the body's other `.snap` files.
  return await withBlockDir(ctx, ctx.stepIndex - 1, step, async () => {
    // Run the body. A failure inside the body short-circuits the whole
    // stable block — we don't bother with the post-snapshot in that
    // case because the inner failure is the root cause the test author
    // needs to see. The inner step has already emitted its own `✗`
    // line, so we wrap the bubbled error with a clear "inner step
    // failed" marker instead of repeating the raw message; executeStep's
    // block-close logic pairs this with the stable block's header so
    // the reader can see which block aborted without being double-
    // billed for the root cause.
    try {
      await executeBody(step.body, ctx);
    } catch (err) {
      const innerMsg = err instanceof Error ? err.message : String(err);
      const firstLine = innerMsg.split('\n', 1)[0];
      throw new Error(`aborted by inner step — ${firstLine}`);
    }

    // Post-snapshot. Note this uses the *resolved* selector captured at
    // block entry, not a fresh one — if the body interpolates a variable
    // that was used in the header, we still compare the same target.
    const after = await snapshotForDiff(sel);
    if (!after) {
      throw new Error(`failed to capture final snapshot (selector did not match after body)`);
    }
    const diff = diffSnapshots(before, after);
    if (diff.length > 0) {
      const rendered = renderDiff(diff, `drifted across block`);
      const dumpPath = dumpSnapshotDiff(
        ctx,
        `stable-${sel.id}`,
        rendered,
        beforeSerialized,
        serializeSnapshot(after)
      );
      throw new Error(
        `${rendered}\n\n(full diff + snapshots dumped to ${nodePath.relative(process.cwd(), dumpPath)})`
      );
    }
    return { detail: `${step.body.length} step(s), no drift` };
  });
}

async function execRun(step: RunStep, ctx: ExecCtx): Promise<StepResult> {
  const name = step.defineName;
  if (ctx.runningDefines.has(name)) {
    throw new Error(`run ${name}: recursion cycle detected`);
  }
  // Resolve the define. Local suite first (keeps today's behaviour),
  // then the cross-suite global map (populated by discovery with the
  // merge of every parsed .sov file, including `_shared/` utilities).
  let def = ctx.suite.defines.get(name);
  if (!def && ctx.globalDefines) {
    def = ctx.globalDefines.get(name);
  }
  if (!def) {
    const local = Array.from(ctx.suite.defines.keys());
    const global = ctx.globalDefines ? Array.from(ctx.globalDefines.keys()) : [];
    const known =
      Array.from(new Set([...local, ...global]))
        .sort()
        .join(', ') || 'none';
    throw new Error(`run ${name}: undefined define (known: ${known})`);
  }

  // Arity check.
  const declaredParams = def.params ?? [];
  const providedArgs = step.args ?? [];
  if (declaredParams.length !== providedArgs.length) {
    throw new Error(
      `run ${name}: expected ${declaredParams.length} arg(s) (${declaredParams.join(', ') || 'none'}), got ${providedArgs.length}`
    );
  }

  // Resolve args against the CALLER's current scope so inside-a-define
  // calls can forward their own params through unchanged:
  //   run inner-flow with $outcome $amount
  const callerVars = readVars(ctx);
  const frame: Record<string, string> = {};
  for (let i = 0; i < declaredParams.length; i++) {
    const arg = providedArgs[i];
    if (arg.kind === 'var') {
      const v = callerVars[arg.name];
      if (v === undefined) {
        const bound = Object.keys(callerVars).join(', ') || 'none';
        throw new Error(
          `run ${name}: arg #${i + 1} references $${arg.name} which is undefined (bound: ${bound})`
        );
      }
      frame[declaredParams[i]] = v;
    } else {
      // Literal — still interpolate `${...}` so quoted strings can
      // reference captured outer vars at call time.
      frame[declaredParams[i]] = interpolateString(arg.value, callerVars);
    }
  }

  ctx.runningDefines.add(name);
  if (declaredParams.length > 0) ctx.localFrames.push(frame);
  try {
    // Every `run <define>` opens a nested artefact dir named after
    // the define. This is the most visible part of the story-
    // hierarchical layout: reading `tests/.screenshots/<test>/`
    // surfaces `01-run-launch-fresh/`, `02-run-mint-ln-outcome/`,
    // etc., and stepping into one shows exactly the probe steps
    // that define invoked.
    await withBlockDir(ctx, ctx.stepIndex - 1, step, async () => {
      await executeBody(def.body, ctx);
    });
  } finally {
    if (declaredParams.length > 0) ctx.localFrames.pop();
    ctx.runningDefines.delete(name);
  }
  return { detail: `ran ${def.body.length} step(s)` };
}

/**
 * Execute a matrix-synthesized `bundle of` stage with per-variant
 * capture isolation. Each variant runs under a vars save/restore so
 * siblings can't see each other's captures, and the bundle as a whole
 * also save/restores around the full run so downstream stages don't
 * inherit any per-probe state.
 *
 * Save/restore is done by key-level mutation rather than object
 * replacement so `ctx.vars`'s object identity is preserved for any
 * downstream code that reads it. Keys present before a probe ran get
 * their original value restored; keys introduced by the probe are
 * deleted.
 */
async function execScopedBundle(step: ScopedBundleStep, ctx: ExecCtx): Promise<StepResult> {
  const outerSnapshot = { ...ctx.vars };
  try {
    // Wrap the whole bundle in a nested dir. Inner variants are
    // themselves `run <probe-name>` steps (see the matrix
    // synthesizer), so each probe in turn pushes its own
    // `NN-run-probe-copy-button/` dir inside the bundle's dir —
    // giving a two-level hierarchy:
    //   10-bundle-probes/
    //     11-run-probe-copy-button/
    //       12-if-visible-send-token-copy/
    //         13-tap-send-token-copy.png
    //         ...
    //     14-run-probe-share-button/
    //       ...
    await withBlockDir(ctx, ctx.stepIndex - 1, step, async () => {
      for (const variant of step.variants) {
        const probeSnapshot = { ...ctx.vars };
        try {
          await executeStep(variant, ctx);
        } finally {
          restoreVars(ctx.vars, probeSnapshot);
        }
      }
    });
  } finally {
    restoreVars(ctx.vars, outerSnapshot);
  }
  return { detail: `${step.variants.length} probe(s), captures isolated` };
}

function restoreVars(target: Record<string, string>, snap: Record<string, string>): void {
  // Delete any keys that weren't in the snapshot.
  for (const k of Object.keys(target)) {
    if (!(k in snap)) delete target[k];
  }
  // Restore values from the snapshot (this also re-introduces any keys
  // that might have been deleted between snap and now, though no
  // current executor path deletes vars).
  for (const k of Object.keys(snap)) {
    target[k] = snap[k];
  }
}

async function execIfVar(step: IfVarStep, ctx: ExecCtx): Promise<StepResult> {
  const vars = readVars(ctx);
  const value = vars[step.varName];
  if (value === undefined) {
    const bound = Object.keys(vars).join(', ') || 'none';
    throw new Error(`if $${step.varName}: undefined variable (bound: ${bound})`);
  }
  const rhsStr = resolveRhs(step.rhs, vars, `if $${step.varName} ${step.op}`);
  const label = `if${step.negated ? ' not' : ''} $${step.varName} ${step.op} ${formatRhsForError(step.rhs, rhsStr)}`;
  let ok = evaluateVarOp(step.op, value, rhsStr, label);
  if (step.negated) ok = !ok;
  if (ok) {
    // See execIf — same rationale: push the nested artefact dir only
    // after the guard resolves true so unrun branches don't litter
    // the filesystem with empty `NN-if-var-foo/` directories.
    await withBlockDir(ctx, ctx.stepIndex - 1, step, async () => {
      await executeBody(step.body, ctx);
    });
    return { detail: `ran ${step.body.length} step(s)` };
  }
  return { detail: 'skipped' };
}

// ── Wallet ──

function execWalletStep(step: WalletStep, ctx: ExecCtx): StepResult {
  if (!ctx.walletPinged) {
    pingCocod();
    ctx.walletPinged = true;
  }
  // Pass the flattened scope (outer + local frames) so wallet args can
  // reference `$paramName` when the step lives inside a parameterized
  // define body. Bindings still go to the outer scope below so the
  // caller can read them.
  const result = executeWallet(step, readVars(ctx));
  if (step.as && result.boundValue !== undefined) {
    ctx.vars[step.as] = result.boundValue;
  }
  // Prefer surfacing what the step *bound* — that's the payload a test
  // author typically wants to see (balance JSON, new invoice). If the
  // step has no bound value (e.g. `wallet send bolt11 $invoice` is a
  // fire-and-forget pay), fall back to the resolved arg list so you
  // can see exactly what got handed to cocod — the header only shows
  // `$invoice` in its unresolved form.
  if (result.boundValue !== undefined) {
    return { detail: preview(result.boundValue, 80) };
  }
  if (result.resolvedArgs.length > 0) {
    return { detail: preview(result.resolvedArgs.join(' '), 80) };
  }
  return {};
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function describeSelector(sel: Selector): string {
  switch (sel.kind) {
    case 'id':
      return `#${sel.id}`;
    case 'idPrefix':
      return `#${sel.prefix}*${sel.first ? ' first' : ''}`;
    case 'text':
      return `"${sel.text}"`;
  }
}

/**
 * Render a Step in its source-level form — i.e. what the test author
 * wrote. This is the canonical text shown on the pre-step "header" line
 * in the execution log, so it must include every modifier that a test
 * author would write inline: `launch <bundleId>`, `tap #foo when
 * visible`, `wait for screen #bar`, `assert $x eq "y"`, etc. Any detail
 * that only appears here will end up duplicated on the post-step
 * "result" line (because the handler's summary is matched against
 * this to suppress redundancy) — so keep this in sync with the
 * handlers in `runStep`.
 */
function describeStep(step: Step): string {
  switch (step.kind) {
    case 'launch':
      return `launch ${step.bundleId}`;
    case 'home':
      return 'home';
    case 'back':
      return 'back';
    case 'tap': {
      const wv = step.whenVisible
        ? step.whenVisible.withinMs !== undefined
          ? ` when visible within ${step.whenVisible.withinMs}ms`
          : ' when visible'
        : '';
      const noChange = step.expectNoChange ? ' expect no-change' : '';
      return `tap ${describeSelector(step.selector)}${wv}${noChange}`;
    }
    case 'type':
      return `type "${preview(step.text)}"${step.into ? ` into ${describeSelector(step.into)}` : ''}`;
    case 'keypad':
      return `keypad ${step.digit}`;
    case 'swipe':
      return `swipe ${step.direction}`;
    case 'scrollUntil': {
      const within = step.withinMs !== undefined ? ` within ${step.withinMs}ms` : '';
      const dir = step.direction === 'up' ? '' : 'down ';
      return `scroll ${dir}until ${describeSelector(step.selector)} visible${within}`;
    }
    case 'dismiss':
      return 'dismiss';
    case 'waitFor': {
      const within = step.withinMs !== undefined ? ` within ${step.withinMs}ms` : '';
      return `${step.isScreen ? 'wait for screen' : 'wait for'} ${describeSelector(step.selector)}${within}`;
    }
    case 'assertVisible': {
      const within = step.withinMs !== undefined ? ` within ${step.withinMs}ms` : '';
      return `assert ${describeSelector(step.selector)} visible${within}`;
    }
    case 'assertNotVisible':
      return `assert ${describeSelector(step.selector)} not visible`;
    case 'assertVar': {
      const rhs = step.rhs.kind === 'literal' ? `"${step.rhs.value}"` : `$${step.rhs.name}`;
      return `assert $${step.varName} ${step.op} ${rhs}`;
    }
    case 'assertScreenEq':
      return `assert screen eq $${step.varName}`;
    case 'captureLabel':
      return `capture ${describeSelector(step.selector)} as $${step.varName}`;
    case 'captureSuffix':
      return `capture ${describeSelector(step.selector)} suffix as $${step.varName}`;
    case 'captureClipboard':
      return `capture clipboard as $${step.varName}`;
    case 'setClipboard':
      return `clipboard set ${step.text}`;
    case 'snapshot':
      return `snapshot ${step.selector ? describeSelector(step.selector) : 'screen'} as $${step.varName}`;
    case 'screenshot':
      return `screenshot ${step.name}`;
    case 'if':
      return `if ${step.negated ? 'not ' : ''}visible ${describeSelector(step.selector)}`;
    case 'ifVar': {
      const rhs = step.rhs.kind === 'literal' ? `"${step.rhs.value}"` : `$${step.rhs.name}`;
      return `if ${step.negated ? 'not ' : ''}$${step.varName} ${step.op} ${rhs}`;
    }
    case 'repeat':
      return `repeat ${step.count}`;
    case 'run': {
      if (!step.args || step.args.length === 0) return `run ${step.defineName}`;
      const argsText = step.args
        .map((a) => (a.kind === 'var' ? `$${a.name}` : `"${a.value}"`))
        .join(' ');
      return `run ${step.defineName} with ${argsText}`;
    }
    case 'stable':
      return `stable ${describeSelector(step.selector)} across`;
    case 'scopedBundle':
      return `bundle ${step.stageName} (${step.variants.length} probe${step.variants.length === 1 ? '' : 's'})`;
    case 'wallet': {
      // Include positional args on the header so the test author can
      // see WHAT cocod is being asked to do, not just WHICH subcommand.
      // `$var` refs render as `$var` (not their resolved value) — the
      // tail line shows the final resolved arg list.
      const argsText = step.args.map((a) => (a.kind === 'var' ? `$${a.name}` : a.value)).join(' ');
      return `wallet ${step.command.join(' ')}${argsText ? ` ${argsText}` : ''}`;
    }
  }
}

function preview(s: string, max = 60): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function sanitizeForFile(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Sanitize a matrix cell's tuple label into a filesystem-safe single
 * path component. Unlike `sanitizeForFile`, this:
 *   - DOES NOT truncate (cell slugs must remain unique even when long,
 *     otherwise two neighbouring cells collide on disk).
 *   - Converts `=` in `stage=variant` to `-` for readability.
 *   - Converts spaces between stages to `__` (double underscore) so
 *     the resulting slug visually separates each stage's contribution.
 *
 * Example input  : `amount=send-amount-via-keypad probes=bundle teardown=terminator-dismiss`
 * Example output : `amount-send-amount-via-keypad__probes-bundle__teardown-terminator-dismiss`
 */
function sanitizeCellSlug(tupleLabel: string): string {
  return tupleLabel
    .replace(/=/g, '-')
    .replace(/\s+/g, '__')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Prepare the per-step screenshot dir for a test. `relPath` is the
 * already-sliced relative path under `tests/.screenshots/` —
 * `<sanitized-test-name>` for plain tests, or
 * `<matrix-title>/<cell-slug>` for matrix cells.
 *
 * Screenshots are local scratch (gitignored), so we nuke the whole
 * cell root recursively and rebuild it empty. Nesting-aware block
 * handlers create child dirs lazily on push, so there's nothing to
 * preserve here.
 */
function prepareScreenshotsDir(relPath: string): string {
  const dir = nodePath.join(SCREENSHOTS_DIR, relPath);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Recursively walk a directory tree, deleting every file that ends in
 * `.snap` while leaving subdirectories and non-snap files intact. Used
 * at test start to sweep stale committed-snapshot files out of the
 * `.snapshots/<cell>` tree so a step that was removed or renamed in
 * the source doesn't leave a ghost baseline behind.
 */
function purgeSnapFilesRecursive(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) {
      purgeSnapFilesRecursive(p);
    } else if (entry.isFile() && entry.name.endsWith('.snap')) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Prepare the per-step AX-tree snapshot dir for a test. These files
 * live under `tests/.snapshots/<relPath>/` and ARE committed to git,
 * so clearing stale files between runs is essential — otherwise a
 * deleted step leaves its old `.snap` file orphaned and the PR diff
 * is cluttered by a pretend-passing baseline.
 *
 * Unlike the screenshot dir, we DON'T nuke the whole tree: the
 * committed `.snap` file directories carry meaning in git (their
 * presence documents "this block fired in a previous run"), and a
 * block that didn't fire in this run should show up in git as a
 * deleted-file diff, not a deleted-dir diff. So: walk the tree,
 * delete every `.snap`, leave directories + any non-snap files in
 * place. Block handlers then mkdir their children lazily as they
 * push.
 */
function prepareStepSnapshotsDir(relPath: string): string {
  const dir = nodePath.join(SNAPSHOTS_DIR, relPath);
  fs.mkdirSync(dir, { recursive: true });
  purgeSnapFilesRecursive(dir);
  return dir;
}

/**
 * Prepare the per-step diff dump dir for a test. Failure diffs are
 * per-run and local-only, so we nuke recursively and rebuild empty.
 */
function prepareDiffsDir(relPath: string): string {
  const dir = nodePath.join(DIFFS_DIR, relPath);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Build a screenshot file path inside the CURRENT block dir. `ctx`'s
 * `shotDirStack` top-of-stack is the active leaf for the
 * currently-running block; every step always lands inside whatever
 * its enclosing block has pushed. The filename uses the GLOBAL
 * `ctx.stepIndex` (not a per-block local index) so screenshot names
 * stay grep-able across PR discussions — paste `14-capture-clipboard.png`
 * into chat and a reader can find it regardless of which block dir it
 * lives in.
 */
function screenshotPath(ctx: ExecCtx, index: number, label: string): string {
  const dir = ctx.shotDirStack[ctx.shotDirStack.length - 1];
  const idx = String(index).padStart(2, '0');
  return nodePath.join(dir, `${idx}-${sanitizeForFile(label)}.png`);
}

function stepSnapshotPath(ctx: ExecCtx, index: number, label: string): string {
  const dir = ctx.snapDirStack[ctx.snapDirStack.length - 1];
  const idx = String(index).padStart(2, '0');
  return nodePath.join(dir, `${idx}-${sanitizeForFile(label)}.snap`);
}

/**
 * Derive a filesystem-safe label for a block-shaped step, suitable
 * for use as the leaf name of a nested artefact directory. Uses
 * `describeStep` as the starting point so the directory name
 * matches the human-readable step label from the source, and then
 * sanitizes for the filesystem (kebab-case, truncated).
 *
 * Examples:
 *   `run probe-copy-button`                 → `run-probe-copy-button`
 *   `bundle probes (7 probes)`              → `bundle-probes-7-probes`
 *   `if visible #send-token-copy`           → `if-visible-send-token-copy`
 *   `if not visible #more-button`           → `if-not-visible-more-button`
 *   `if $outcome eq "ISSUED"`               → `if-outcome-eq-ISSUED`
 *   `repeat 3 times`                        → `repeat-3-times`
 *   `stable #screen-mint-quote across`      → `stable-screen-mint-quote-across`
 */
function blockDirLabel(step: Step): string {
  return sanitizeForFile(describeStep(step));
}

/**
 * Push a new block-scoped leaf directory onto the stack. Creates the
 * nested dir on disk (both for screenshots and snapshots) so
 * subsequent per-step writes from inside the block body go into the
 * right place. The matching `popBlockDir` unwinds both stacks and
 * the `blockRelPath` cache.
 *
 * `blockIndex` is the global step index of the block opener itself —
 * that's what we prefix the dir name with so the filesystem tree
 * mirrors the global step numbering of the test's execution log.
 */
function pushBlockDir(ctx: ExecCtx, blockIndex: number, step: Step): void {
  const label = `${String(blockIndex).padStart(2, '0')}-${blockDirLabel(step)}`;
  const parentShot = ctx.shotDirStack[ctx.shotDirStack.length - 1];
  const parentSnap = ctx.snapDirStack[ctx.snapDirStack.length - 1];
  const childShot = nodePath.join(parentShot, label);
  const childSnap = nodePath.join(parentSnap, label);
  try {
    fs.mkdirSync(childShot, { recursive: true });
  } catch {
    /* best effort */
  }
  try {
    fs.mkdirSync(childSnap, { recursive: true });
  } catch {
    /* best effort */
  }
  ctx.shotDirStack.push(childShot);
  ctx.snapDirStack.push(childSnap);
  ctx.blockRelPath = ctx.blockRelPath === '' ? label : nodePath.join(ctx.blockRelPath, label);
}

function popBlockDir(ctx: ExecCtx): void {
  if (ctx.shotDirStack.length > 1) ctx.shotDirStack.pop();
  if (ctx.snapDirStack.length > 1) ctx.snapDirStack.pop();
  // Drop the last path segment off blockRelPath.
  if (ctx.blockRelPath !== '') {
    const sepIdx = ctx.blockRelPath.lastIndexOf(nodePath.sep);
    ctx.blockRelPath = sepIdx === -1 ? '' : ctx.blockRelPath.slice(0, sepIdx);
  }
}

/**
 * Run a block body wrapped in a push/pop pair. Guarantees the stack
 * is restored on early exit (exception OR normal return), so a body
 * that throws doesn't leave a stale leaf on top of the dir stack.
 */
async function withBlockDir<T>(
  ctx: ExecCtx,
  blockIndex: number,
  step: Step,
  body: () => Promise<T>
): Promise<T> {
  pushBlockDir(ctx, blockIndex, step);
  try {
    return await body();
  } finally {
    popBlockDir(ctx);
  }
}

/**
 * Persist a failed snapshot diff to
 * `tests/.diffs/<artefactPath>/<blockRelPath>/<label>.txt` so the
 * user can inspect what changed without rerunning. Includes the
 * rendered diff plus the full expected and actual snapshots so any
 * pattern that needs to be added to `.snapshot-ignores` is one
 * `grep` away.
 *
 * Diffs are stored in their own top-level `.diffs/` root (as opposed
 * to nested under `.snapshots/` or `.screenshots/`) so the committed
 * `.snapshots/` tree stays clean of local-only failure artefacts and
 * so gitignore can match the entire diff hierarchy with a single
 * `tests/.diffs/` rule.
 *
 * The block relative path (`ctx.blockRelPath`) is joined into the
 * output path so a diff that failed inside a nested `run probe-copy-button`
 * lands in the matching nested dir under `.diffs/`, mirroring the
 * same hierarchy used by screenshots and snapshots.
 */
function dumpSnapshotDiff(
  ctx: ExecCtx,
  label: string,
  diffText: string,
  expected: string,
  actual: string
): string {
  const dir = nodePath.join(DIFFS_DIR, ctx.artefactPath, ctx.blockRelPath);
  fs.mkdirSync(dir, { recursive: true });
  const file = nodePath.join(dir, `${sanitizeForFile(label)}.txt`);
  const body = [
    diffText,
    '',
    '──── expected ────',
    expected,
    '',
    '──── actual ────',
    actual,
    '',
  ].join('\n');
  fs.writeFileSync(file, body);
  return file;
}
