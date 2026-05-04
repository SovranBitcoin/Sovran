/**
 * @fileoverview Sovran Test DSL — AST types
 *
 * The parser produces a `Suite` (one per .sov file). A Suite contains
 * `defines` (hoisted reusable sub-flows) and `tests` (the executable
 * entries). Each test or define has a body of `Step` nodes.
 *
 * Steps are tagged unions discriminated by `kind`. Block-shaped steps
 * (`If`, `Repeat`) carry a `body: Step[]` for nested commands. Sub-flows
 * are referenced by name and resolved at execution time so undefined
 * `run name` references can report a useful line number.
 *
 * Source positions are attached to every node so error messages can
 * show `tests/foo.sov:12:5 — <message>` rather than parser-internal jargon.
 */

// ─── Source positions ───────────────────────────────────────────────────────

export interface SourcePos {
  /** Path of the .sov file the AST node came from. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** 1-indexed column number. */
  col: number;
}

// ─── Selectors ──────────────────────────────────────────────────────────────

/**
 * A selector targets an element on the device's accessibility tree.
 *
 * - `id` — exact match on `testID` (preferred, stable across copy/i18n)
 * - `text` — visible label or name (fallback when no testID exists)
 * - `idPrefix` — wildcard match starting with a fixed prefix; used for
 *   dynamic IDs like `#transaction-send-*`. The optional `first` flag
 *   (source form: `#prefix* first`) switches the selection strategy
 *   from the default "topmost visible" heuristic to "first in tree
 *   traversal order". For a horizontal row of siblings like the send
 *   amount suggestion chips (21 / 100 / 250 / send-all), tree order
 *   equals render order equals left-to-right, so `first` picks the
 *   leftmost chip regardless of device width — useful on narrow
 *   screens where the topmost-visible fallback is y-unstable.
 */
export type Selector =
  | { kind: 'id'; id: string; pos: SourcePos }
  | { kind: 'text'; text: string; pos: SourcePos }
  | { kind: 'idPrefix'; prefix: string; first?: boolean; pos: SourcePos };

// ─── Modifiers (shared across taps/waits/asserts) ───────────────────────────

/**
 * Optional `within Ns` clause appended to a wait/assert. Stored as
 * milliseconds for the executor; defaults to the runner's standard
 * step timeout if absent.
 */
export interface WithinModifier {
  withinMs: number;
}

/**
 * Optional `when visible` clause on a `tap`, which makes the tap poll for
 * the target before acting (rather than failing immediately if missing).
 */
export interface WhenVisibleModifier {
  whenVisible: true;
  /** Optional `within Ns` clause attached to the `when visible`. */
  withinMs?: number;
}

// ─── Step variants ──────────────────────────────────────────────────────────

export type Step =
  // App lifecycle
  | LaunchStep
  | HomeStep
  | BackStep

  // Tap / type / keypad
  | TapStep
  | TypeStep
  | KeypadStep

  // Gestures
  | SwipeStep
  | ScrollUntilStep
  | DismissStep

  // Wait
  | WaitForStep

  // Assert (element + variable forms)
  | AssertVisibleStep
  | AssertNotVisibleStep
  | AssertVarStep
  | AssertScreenEqStep

  // Capture
  | CaptureLabelStep
  | CaptureSuffixStep
  | CaptureClipboardStep
  | SetClipboardStep

  // Snapshot
  | SnapshotStep

  // Screenshot (file output, not snapshot variable)
  | ScreenshotStep

  // Control flow
  | IfStep
  | IfVarStep
  | RepeatStep
  | RunStep
  | StableStep

  // Matrix synthesis (internal — not parseable from source)
  | ScopedBundleStep

  // Wallet (cocod)
  | WalletStep;

// ── App lifecycle ──

export interface LaunchStep {
  kind: 'launch';
  bundleId: string;
  pos: SourcePos;
}

export interface HomeStep {
  kind: 'home';
  pos: SourcePos;
}

export interface BackStep {
  kind: 'back';
  pos: SourcePos;
}

// ── Tap / type / keypad ──

export interface TapStep {
  kind: 'tap';
  selector: Selector;
  /** `tap ... when visible [within Ns]` — poll before tapping. */
  whenVisible?: WhenVisibleModifier;
  /** `tap ... expect no-change` — assert nothing happens after tap. */
  expectNoChange?: true;
  pos: SourcePos;
}

export interface TypeStep {
  kind: 'type';
  /** The string to type. May contain `${var}` interpolation. */
  text: string;
  /** Optional target — if absent, types into currently focused field. */
  into?: Selector;
  pos: SourcePos;
}

export interface KeypadStep {
  kind: 'keypad';
  /** A single digit 0-9 as a string. */
  digit: string;
  pos: SourcePos;
}

// ── Gestures ──

export interface SwipeStep {
  kind: 'swipe';
  direction: 'up' | 'down' | 'left' | 'right';
  pos: SourcePos;
}

/**
 * `scroll until <selector> visible` — flick the screen up (or down) in
 * short bursts until the target element is fully inside the viewport.
 *
 * This is the declarative fix for the off-screen-tap footgun: XCUITest
 * exposes rows that are rendered into the AX tree even when they've
 * been scrolled out of the viewport (especially inside virtualized
 * lists), and a naive `tapXY(node.centerX, node.centerY)` at
 * out-of-bounds coordinates ends up tapping whatever's near the edge of
 * the visible area — usually the wrong row entirely. Authors should
 * precede any tap on a dynamic list row with this step.
 *
 * "Fully visible" is the only mode right now — the whole point is to
 * guarantee the subsequent tap lands on the intended element, so
 * partial visibility isn't useful. Timeout and step size are
 * configurable via `within Ns` / `steps N` if we ever need them.
 */
export interface ScrollUntilStep {
  kind: 'scrollUntil';
  selector: Selector;
  /**
   * Direction the scroll container should move to reveal the target.
   * Defaults to `up` — the common case is looking for a row further
   * down a list, which requires scrolling the content upward. Authors
   * can override with `scroll down until ...` for back-to-top flows.
   */
  direction: 'up' | 'down';
  /** Optional `within Ns` clause; defaults to the runner's step timeout. */
  withinMs?: number;
  pos: SourcePos;
}

export interface DismissStep {
  kind: 'dismiss';
  pos: SourcePos;
}

// ── Wait ──

export interface WaitForStep {
  kind: 'waitFor';
  selector: Selector;
  /** `wait for screen <selector>` — semantic alias signalling navigation. */
  isScreen?: true;
  withinMs?: number;
  pos: SourcePos;
}

// ── Assert (element forms) ──

export interface AssertVisibleStep {
  kind: 'assertVisible';
  selector: Selector;
  withinMs?: number;
  pos: SourcePos;
}

export interface AssertNotVisibleStep {
  kind: 'assertNotVisible';
  selector: Selector;
  pos: SourcePos;
}

// ── Assert (variable forms) ──

/**
 * `assert $var <op> <rhs>` — comparison assertions on captured variables.
 *
 * Supported ops:
 *   starts-with, contains, eq, matches, gt
 *
 * `rhs` is either a string literal (matches/contains/starts-with/eq) or
 * another `$var` reference (eq), or a numeric literal (gt). The executor
 * coerces and validates per-op.
 */
export interface AssertVarStep {
  kind: 'assertVar';
  varName: string;
  op: 'starts-with' | 'contains' | 'eq' | 'matches' | 'gt' | 'cashu-amount' | 'bolt11-amount';
  rhs: { kind: 'literal'; value: string } | { kind: 'var'; name: string };
  pos: SourcePos;
}

export interface AssertScreenEqStep {
  kind: 'assertScreenEq';
  /** When set, compare a subtree rooted at this selector instead of full screen. */
  selector?: Selector;
  varName: string;
  pos: SourcePos;
}

// ── Capture ──

export interface CaptureLabelStep {
  kind: 'captureLabel';
  selector: Selector;
  varName: string;
  pos: SourcePos;
}

export interface CaptureSuffixStep {
  kind: 'captureSuffix';
  /** Selector must be `idPrefix` form (`#prefix*`). Validated by parser. */
  selector: Selector;
  varName: string;
  pos: SourcePos;
}

export interface CaptureClipboardStep {
  kind: 'captureClipboard';
  varName: string;
  pos: SourcePos;
}

export interface SetClipboardStep {
  kind: 'setClipboard';
  /** The text to write — may contain `${var}` interpolation. */
  text: string;
  pos: SourcePos;
}

// ── Snapshot ──

export interface SnapshotStep {
  kind: 'snapshot';
  /** Absent = `snapshot screen as $var`. Present = `snapshot <#id> as $var`. */
  selector?: Selector;
  varName: string;
  pos: SourcePos;
}

// ── Screenshot ──

export interface ScreenshotStep {
  kind: 'screenshot';
  /** Filename (without extension), saved under .screenshots/manual/. */
  name: string;
  pos: SourcePos;
}

// ── Control flow ──

export interface IfStep {
  kind: 'if';
  /** `if visible <selector>` vs `if not visible <selector>`. */
  negated: boolean;
  selector: Selector;
  body: Step[];
  pos: SourcePos;
}

/**
 * `if $var <op> <rhs>` / `if not $var <op> <rhs>` — value-based conditional
 * block. Mirrors `AssertVarStep` exactly so the five comparison operators
 * (`starts-with`, `contains`, `matches`, `eq`, `gt`) share the same mental
 * model and the same runtime evaluator — we'd rather have one operator
 * semantics than two subtly different ones.
 *
 * Parser dispatch: after `if ` / `if not `, if the next token starts with
 * `$`, this is a value conditional; otherwise it falls through to the
 * existing `visible <selector>` form. Back-compat with every existing
 * `if visible` / `if not visible` block.
 */
export interface IfVarStep {
  kind: 'ifVar';
  negated: boolean;
  varName: string;
  op: 'starts-with' | 'contains' | 'eq' | 'matches' | 'gt' | 'cashu-amount' | 'bolt11-amount';
  rhs: { kind: 'literal'; value: string } | { kind: 'var'; name: string };
  body: Step[];
  pos: SourcePos;
}

export interface RepeatStep {
  kind: 'repeat';
  count: number;
  body: Step[];
  pos: SourcePos;
}

export interface RunStep {
  kind: 'run';
  /** Name of the `define` to invoke. Resolved at execution time. */
  defineName: string;
  /**
   * Positional arguments passed via `run name with <arg> <arg> ...`.
   * Undefined (not empty-array) when the `run` has no `with` clause, to
   * distinguish `run foo` (legacy, no param check) from `run foo with`
   * (new form, arity must match `Define.params`). Reuses the existing
   * `WalletArg` union so quoted literals and `$var` refs both fit.
   */
  args?: WalletArg[];
  pos: SourcePos;
}

/**
 * `scopedBundle` — internal step synthesized by the matrix runner for
 * `bundle of` stages. Runs a list of `RunStep`s in author order, with a
 * per-variant variable-scope save/restore so probes inside the bundle
 * can't leak captures to their siblings or to downstream stages.
 *
 * Not parseable from source — authors write stages, the matrix expander
 * emits these into the synthesized cell bodies before handing them to
 * `executeTest`. Treated as a block step for logging purposes so the
 * reader sees an explicit "bundle ✓ N probes" close line under the
 * stage's header instead of an orphan tail under the last probe.
 */
export interface ScopedBundleStep {
  kind: 'scopedBundle';
  /** Stage name from the matrix source (for log headers). */
  stageName: string;
  /** Variant run steps to execute in author order with isolation. */
  variants: RunStep[];
  pos: SourcePos;
}

/**
 * `stable <selector> across ... end` — round-trip stability check.
 *
 * Snapshots the selector's AX subtree when the block is entered, runs
 * the body, then asserts the selector matches the captured snapshot
 * when the block exits. This is the declarative form of the old
 * `snapshot … as $foo` + navigate + `assert screen eq $foo` pattern:
 * zero intermediate variables, the intent ("this screen should look
 * the same before and after these operations") lives on line one.
 *
 * Inspired by Playwright's `toMatchAriaSnapshot` (one call bundles
 * capture-and-compare) but adapted for Sovran's within-run comparison
 * semantics, which have no industry equivalent — traditional snapshot
 * libraries compare against a baseline stored on disk between runs.
 */
export interface StableStep {
  kind: 'stable';
  selector: Selector;
  body: Step[];
  pos: SourcePos;
}

// ── Wallet (cocod) ──

export type WalletStep = WalletStep_;

/**
 * `wallet ...` commands shell out to the cocod CLI on the test host.
 * The verb is the cocod subcommand path (e.g. `send cashu`, `mints add`)
 * and `args` carries the rest of the line (literals + interpolated $vars).
 * Output is parsed per-verb in `wallet.ts` and stored in `as` if present.
 */
interface WalletStep_ {
  kind: 'wallet';
  /** The cocod subcommand path: `["send", "cashu"]`, `["mints", "add"]`, etc. */
  command: string[];
  /** Positional arguments after the subcommand path (literals or `$var` refs). */
  args: WalletArg[];
  /** Variable to capture stdout into, if the verb produces output. */
  as?: string;
  pos: SourcePos;
}

/** A single positional arg in a wallet command. */
export type WalletArg =
  | { kind: 'literal'; value: string }
  | { kind: 'var'; name: string };

// ─── Verified comment ──────────────────────────────────────────────────────

/**
 * The `# verified: ...` comment line inside a test block. Parsed as
 * metadata so the runner can rewrite it on success without re-serialising
 * the file.
 */
export interface VerifiedComment {
  /** ISO date `YYYY-MM-DD`. */
  date: string;
  /** Optional ISO time `HH:MM:SS`. */
  time?: string;
  /** Free-text device label (e.g. "iphone (iOS 26.1)"). */
  device?: string;
  /** 1-indexed line number of the verified comment for in-place rewrite. */
  line: number;
}

// ─── Top-level: Define / Test / Matrix / Suite ─────────────────────────────

export interface Define {
  name: string;
  body: Step[];
  /**
   * Ordered list of parameter names declared via `define name with p1 p2`.
   * Undefined when the define has no `with` clause (legacy zero-arg form).
   * Callers invoke it via `run name with <arg> <arg>` where positional
   * args bind to these names in a locally-scoped frame pushed for the
   * body. Captures inside the body still write to the outer test scope —
   * only the param bindings are local.
   */
  params?: string[];
  /** Human-readable description from a preceding `# desc:` comment. */
  description?: string;
  pos: SourcePos;
}

export interface Test {
  name: string;
  body: Step[];
  /** Set if a `# verified: ...` comment was parsed inside this test block. */
  verified?: VerifiedComment;
  /** Human-readable description from a preceding `# desc:` comment. */
  description?: string;
  pos: SourcePos;
}

/**
 * `matrix "<title>" ... end` — an ordered pipeline of stages, each of
 * which contributes one or more variants to the cartesian product of
 * synthesized tests. A matrix is a TOP-LEVEL entity, a peer of `test`
 * and `define` (not a `Step`). It owns no execution semantics of its
 * own — the runner expands it into a fresh `Test` per cell and hands
 * each one to the existing executor.
 *
 * A matrix body accepts three statement kinds:
 *
 *   1. `setup run <name> [with args...]` — fixed prologue prepended to
 *      every generated cell. At most one per matrix.
 *   2. `mode <verbose | quick>` — expansion strategy. Default `verbose`.
 *   3. `stage <name> <one of | bundle of | each of>` ... `end` —
 *      sub-block collecting `RunStep` variants.
 *
 * See scripts/test-dsl/matrix.ts for the expansion rules and synthesis
 * helpers.
 */
export interface MatrixDef {
  kind: 'matrix';
  /** Human title from `matrix "<title>"`. Unique within the suite. */
  title: string;
  /** Optional fixed prologue (run at the start of every generated cell). */
  setup?: RunStep;
  /** Expansion strategy. */
  mode: MatrixMode;
  /** Ordered stages. Each stage contributes one cell-component per tuple. */
  stages: StageDef[];
  /**
   * Set if a `# verified: ...` result table was parsed just before the
   * closing `end`. The runner rewrites this in place after each
   * execution — format and rewrite rules live in verification.ts.
   */
  verification?: MatrixVerification;
  pos: SourcePos;
}

export type MatrixMode = 'verbose' | 'quick';

/**
 * Discriminator for a matrix stage's variant-semantics.
 *
 * - `oneOf`    — pick exactly one variant. Verbose enumerates all;
 *                quick picks the first.
 * - `bundleOf` — run every variant in author order, as a single cell-
 *                component. Bundles are wrapped in per-variant capture
 *                frames at execution time so probes don't leak captures
 *                to siblings.
 * - `eachOf`   — emit one cell per variant (verbose AND quick). Used
 *                for terminal / destructive branches that can't share a
 *                run with their siblings.
 */
export type StageKind = 'oneOf' | 'bundleOf' | 'eachOf';

export interface StageDef {
  /** Stage name, e.g. `mint` / `amount` / `probes`. Used in error messages and cell tuple names. */
  name: string;
  variantKind: StageKind;
  /** At least one `RunStep` — validated at parse close. */
  variants: RunStep[];
  pos: SourcePos;
}

/**
 * Parsed `# verified:` table emitted by the runner into a matrix block.
 * Preserves the range of comment lines that immediately precede the
 * closing `end` so the rewriter can splice a fresh table in place
 * without touching anything else in the file.
 */
export interface MatrixVerification {
  /** ISO date `YYYY-MM-DD` from the header line. */
  date: string;
  /** Optional ISO time `HH:MM:SS`. */
  time?: string;
  /** Free-text device label. */
  device?: string;
  /** Header summary, e.g. `verbose × 8 cells`. */
  summary?: string;
  /** First line (1-indexed) of the comment block to replace on re-stamp. */
  firstLine: number;
  /** Last line (1-indexed, inclusive) of the comment block. */
  lastLine: number;
}

/**
 * One parsed `.sov` file. `defines` are hoisted by name; `tests` are
 * stored in source order; `matrices` are also in source order.
 * Discovery later merges multiple Suites into a single flat lookup map.
 */
export interface Suite {
  /** Source file path (absolute). */
  file: string;
  /** All `define` blocks, keyed by name. Hoisted at parse time. */
  defines: Map<string, Define>;
  /** All `test` blocks, in source order. */
  tests: Test[];
  /** All `matrix` blocks, in source order. */
  matrices: MatrixDef[];
}

// ─── Parse errors ──────────────────────────────────────────────────────────

/**
 * Domain-named parse error. Always carries `file:line:col` so the runner
 * can render the spec-style error message: `tests/foo.sov:12:5 — message`.
 */
export class ParseError extends Error {
  readonly pos: SourcePos;
  constructor(pos: SourcePos, message: string) {
    super(`${pos.file}:${pos.line}:${pos.col} — ${message}`);
    this.name = 'ParseError';
    this.pos = pos;
  }
}
