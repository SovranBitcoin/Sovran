/**
 * @fileoverview Sovran Test DSL — parser.
 *
 * Consumes a `SourceLine[]` from the lexer and produces a `Suite` AST.
 *
 * Architecture:
 *   - Verb dispatch is a longest-match table — each entry knows how to
 *     parse its arguments (selector, modifiers, var bindings).
 *   - Block tracking is a stack: `test`, `define`, `if`, `if not visible`,
 *     and `repeat N times` are openers; `end` closes the topmost frame.
 *   - Errors are domain-named and carry `file:line:col`.
 *
 * The parser is intentionally not lookahead-heavy — every line is parsed
 * standalone, and block nesting is tracked via the stack rather than via
 * AST recursion. This keeps the error messages localised to the offending
 * line and avoids "expected expression" cascades.
 */

import {
  ParseError,
  type AssertNotVisibleStep,
  type AssertScreenEqStep,
  type AssertVarStep,
  type AssertVisibleStep,
  type CaptureClipboardStep,
  type CaptureLabelStep,
  type CaptureSuffixStep,
  type Define,
  type DismissStep,
  type HomeStep,
  type IfStep,
  type IfVarStep,
  type KeypadStep,
  type LaunchStep,
  type MatrixDef,
  type MatrixMode,
  type MatrixVerification,
  type RepeatStep,
  type RunStep,
  type ScreenshotStep,
  type Selector,
  type SetClipboardStep,
  type SnapshotStep,
  type SourcePos,
  type StableStep,
  type StageDef,
  type StageKind,
  type Step,
  type Suite,
  type ScrollUntilStep,
  type SwipeStep,
  type TapStep,
  type Test,
  type TypeStep,
  type VerifiedComment,
  type WaitForStep,
  type WalletArg,
  type WalletStep,
} from './ast';
import { lex, type SourceLine } from './lexer';
import { parseSelector, unescapeString } from './selector';

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Parse a `.sov` file's source text into a Suite. The `file` argument is
 * the absolute path used in error messages and source positions.
 */
export function parseSuite(source: string, file: string): Suite {
  const lines = lex(source);
  const parser = new Parser(lines, file);
  return parser.parse();
}

// ─── Block stack frames ────────────────────────────────────────────────────

type BlockFrame =
  | { kind: 'test'; name: string; pos: SourcePos; body: Step[]; verified?: VerifiedComment; description?: string }
  | { kind: 'define'; name: string; params?: string[]; pos: SourcePos; body: Step[]; description?: string }
  | { kind: 'if'; negated: boolean; selector: Selector; pos: SourcePos; body: Step[] }
  | {
      kind: 'ifVar';
      negated: boolean;
      varName: string;
      op: IfVarStep['op'];
      rhs: IfVarStep['rhs'];
      pos: SourcePos;
      body: Step[];
    }
  | { kind: 'repeat'; count: number; pos: SourcePos; body: Step[] }
  | { kind: 'stable'; selector: Selector; pos: SourcePos; body: Step[] }
  | {
      /**
       * Open `matrix "<title>"` block. Accepts only matrix-local
       * directives in its body: `setup run …`, `mode …`, and nested
       * `stage … end` sub-blocks. Has no `body: Step[]` — stages are
       * collected into `stages` directly and setup/mode into their
       * own fields.
       */
      kind: 'matrix';
      title: string;
      pos: SourcePos;
      setup?: RunStep;
      mode?: MatrixMode;
      stages: StageDef[];
      verification?: MatrixVerification;
      /** Transient — highest comment-block range for verification preserved on close. */
      verifiedPendingFirst?: number;
      verifiedPendingLast?: number;
    }
  | {
      /**
       * Open `stage <name> <kind>` sub-block inside a matrix. Accepts
       * only `run …` variant lines. Variants are collected as
       * `RunStep[]` and attached to the parent matrix on close.
       */
      kind: 'stage';
      name: string;
      variantKind: StageKind;
      pos: SourcePos;
      variants: RunStep[];
    };

// ─── Parser class ──────────────────────────────────────────────────────────

class Parser {
  private readonly lines: SourceLine[];
  private readonly file: string;
  private idx = 0;
  private readonly defines = new Map<string, Define>();
  private readonly tests: Test[] = [];
  private readonly matrices: MatrixDef[] = [];
  /** Stack of open blocks. The topmost frame's `body` is where new Steps go. */
  private readonly stack: BlockFrame[] = [];
  /** Pending `# desc:` text to attach to the next `test` or `define`. */
  private pendingDesc: string | undefined;

  constructor(lines: SourceLine[], file: string) {
    this.lines = lines;
    this.file = file;
  }

  parse(): Suite {
    while (this.idx < this.lines.length) {
      const line = this.lines[this.idx++];
      this.handleLine(line);
    }
    if (this.stack.length > 0) {
      const top = this.stack[this.stack.length - 1];
      throw new ParseError(top.pos, `unclosed ${top.kind} block — missing 'end'`);
    }
    return {
      file: this.file,
      defines: this.defines,
      tests: this.tests,
      matrices: this.matrices,
    };
  }

  // ── Line dispatch ──

  private handleLine(line: SourceLine): void {
    const pos: SourcePos = { file: this.file, line: line.line, col: line.col };

    // `# verified: ...` lines mean something inside a `test` block (where
    // they stamp the single pass/fail outcome) AND inside a `matrix`
    // block (where they carry a multi-line pass/fail table for each
    // cell). Both are handled here so the verified-comment detector in
    // the lexer stays trivial. Stray verified comments elsewhere are
    // silently ignored.
    // `# desc: ...` lines attach as a description to the next `test` or
    // `define` opener. Stash the text and consume it when the opener fires.
    if (line.isDescComment) {
      this.pendingDesc = line.text.replace(/^#\s*desc\s*:\s*/i, '').trim();
      return;
    }

    if (line.isVerifiedComment) {
      const top = this.topFrame();
      if (top?.kind === 'test') {
        top.verified = parseVerifiedComment(line.text, line.line);
        return;
      }
      if (top?.kind === 'matrix') {
        // Track the contiguous comment-block range so the rewriter
        // (writeMatrixResultTable) can strip the old stamp cleanly. We
        // don't interpret the table itself — only the header-most
        // comment is parsed for date/time/device metadata; the
        // remaining lines are replaced wholesale on the next run.
        if (top.verifiedPendingFirst === undefined) {
          const meta = parseVerifiedComment(line.text, line.line);
          top.verification = {
            date: meta.date,
            firstLine: line.line,
            lastLine: line.line,
          };
          if (meta.time) top.verification.time = meta.time;
          if (meta.device) top.verification.device = meta.device;
          top.verifiedPendingFirst = line.line;
        }
        top.verifiedPendingLast = line.line;
        if (top.verification) top.verification.lastLine = line.line;
        return;
      }
      return; // stray, ignore
    }

    const text = line.text;

    // ── End of a block ──
    if (text === 'end') {
      this.closeBlock(pos);
      return;
    }

    // ── Top-level openers (must be at indent 0 for test/define/matrix) ──
    if (text.startsWith('test ')) {
      this.openTest(text, pos);
      return;
    }
    if (text.startsWith('define ')) {
      this.openDefine(text, pos);
      return;
    }
    if (text.startsWith('matrix ')) {
      this.openMatrix(text, pos);
      return;
    }

    // ── Inside a matrix frame: only matrix-local directives are allowed. ──
    const top = this.topFrame();
    if (top?.kind === 'matrix') {
      this.handleMatrixLine(top, text, pos);
      return;
    }

    // ── Inside a stage frame: only `run <name> …` variant lines are allowed. ──
    if (top?.kind === 'stage') {
      this.handleStageLine(top, text, pos);
      return;
    }

    // ── Inside a test/define/nested block: every other line is a Step. ──
    if (!top) {
      throw new ParseError(
        pos,
        `statement '${verb(text)}' must be inside a 'test', 'define', or 'matrix' block`
      );
    }

    const step = this.parseStep(text, pos);
    if (step) top.body.push(step);
  }

  // ── Block openers / closers ──

  private openTest(text: string, pos: SourcePos): void {
    if (this.stack.length > 0) {
      throw new ParseError(pos, `'test' cannot be nested inside another block`);
    }
    // `test "Name"` — the rest of the line is a quoted string.
    const rest = text.slice('test '.length).trim();
    if (!rest.startsWith('"')) {
      throw new ParseError(pos, `'test' requires a quoted name: test "..."`);
    }
    const closeIdx = findClosingQuote(rest, 1);
    if (closeIdx === -1) {
      throw new ParseError(pos, `unterminated string in test name`);
    }
    const name = unescapeString(rest.slice(1, closeIdx));
    const trailing = rest.slice(closeIdx + 1).trim();
    if (trailing.length > 0) {
      throw new ParseError(pos, `unexpected text after test name: '${trailing}'`);
    }
    const desc = this.pendingDesc;
    this.pendingDesc = undefined;
    this.stack.push({ kind: 'test', name, pos, body: [], ...(desc ? { description: desc } : {}) });
  }

  private openDefine(text: string, pos: SourcePos): void {
    if (this.stack.length > 0) {
      throw new ParseError(pos, `'define' cannot be nested inside another block`);
    }
    // `define <name>` or `define <name> with p1 p2 ...`
    // Params are space-separated identifiers using the same grammar as
    // `$var` names so `${paramName}` interpolation just works inside
    // the body — kebab-case would clash with the existing interpolation
    // regex.
    const rest = text.slice('define '.length).trim();
    if (rest.length === 0) {
      throw new ParseError(pos, `'define' requires a name`);
    }
    const withIdx = rest.search(/\s+with(?:\s|$)/);
    const namePart = withIdx === -1 ? rest : rest.slice(0, withIdx).trim();
    const paramsPart = withIdx === -1 ? '' : rest.slice(withIdx).replace(/^\s+with\s*/, '').trim();
    if (namePart.length === 0) {
      throw new ParseError(pos, `'define' requires a name`);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(namePart)) {
      throw new ParseError(
        pos,
        `define name '${namePart}' must be kebab-case [a-z][a-z0-9-]*`
      );
    }
    if (this.defines.has(namePart)) {
      throw new ParseError(pos, `duplicate define '${namePart}'`);
    }
    let params: string[] | undefined;
    if (withIdx !== -1) {
      if (paramsPart.length === 0) {
        throw new ParseError(pos, `'define ${namePart} with' requires at least one parameter name`);
      }
      params = paramsPart.split(/\s+/);
      for (const p of params) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p)) {
          throw new ParseError(
            pos,
            `define parameter '${p}' must match /[a-zA-Z_][a-zA-Z0-9_]*/ (so $${p} interpolation works)`
          );
        }
      }
      // Duplicate-param check — otherwise later args silently shadow earlier ones.
      const seen = new Set<string>();
      for (const p of params) {
        if (seen.has(p)) {
          throw new ParseError(pos, `duplicate define parameter '${p}'`);
        }
        seen.add(p);
      }
    }
    const defineDesc = this.pendingDesc;
    this.pendingDesc = undefined;
    const frame: Extract<BlockFrame, { kind: 'define' }> = {
      kind: 'define',
      name: namePart,
      pos,
      body: [],
    };
    if (params) frame.params = params;
    if (defineDesc) (frame as any).description = defineDesc;
    this.stack.push(frame);
  }

  private closeBlock(pos: SourcePos): void {
    const top = this.stack.pop();
    if (!top) {
      throw new ParseError(pos, `'end' with no matching block`);
    }
    if (top.kind === 'test') {
      const test: Test = { name: top.name, body: top.body, pos: top.pos };
      if (top.verified) test.verified = top.verified;
      if (top.description) test.description = top.description;
      this.tests.push(test);
      return;
    }
    if (top.kind === 'define') {
      const def: Define = { name: top.name, body: top.body, pos: top.pos };
      if (top.params) def.params = top.params;
      if (top.description) def.description = top.description;
      this.defines.set(top.name, def);
      return;
    }
    if (top.kind === 'matrix') {
      // Parse-time validation — the matrix runner refuses to enumerate
      // anything malformed, so catching these at parse time gives the
      // test author a line-accurate error instead of a cryptic expansion
      // failure later.
      if (top.stages.length === 0) {
        throw new ParseError(top.pos, `matrix '${top.title}' has no stages`);
      }
      for (const stage of top.stages) {
        if (stage.variants.length === 0) {
          throw new ParseError(
            stage.pos,
            `matrix '${top.title}': stage '${stage.name}' has no variants`
          );
        }
      }
      // Reject duplicate titles within a single suite so discovery's
      // cross-suite collision logic (file::name qualification) only has
      // to worry about file-level collisions.
      if (this.matrices.some((m) => m.title === top.title)) {
        throw new ParseError(top.pos, `duplicate matrix '${top.title}' in this suite`);
      }
      const matrix: MatrixDef = {
        kind: 'matrix',
        title: top.title,
        mode: top.mode ?? 'verbose',
        stages: top.stages,
        pos: top.pos,
      };
      if (top.setup) matrix.setup = top.setup;
      if (top.verification) matrix.verification = top.verification;
      this.matrices.push(matrix);
      return;
    }
    if (top.kind === 'stage') {
      // Attach the finished stage to the enclosing matrix frame. The
      // stage opener already validated that its parent is a matrix —
      // this is just delivery.
      const parent = this.topFrame();
      if (!parent || parent.kind !== 'matrix') {
        throw new ParseError(
          pos,
          `closed stage block has no matrix parent — internal parser error`
        );
      }
      const stage: StageDef = {
        name: top.name,
        variantKind: top.variantKind,
        variants: top.variants,
        pos: top.pos,
      };
      parent.stages.push(stage);
      return;
    }
    if (top.kind === 'if') {
      const ifStep: IfStep = {
        kind: 'if',
        negated: top.negated,
        selector: top.selector,
        body: top.body,
        pos: top.pos,
      };
      this.appendToParent(ifStep, pos);
      return;
    }
    if (top.kind === 'ifVar') {
      const ifVarStep: IfVarStep = {
        kind: 'ifVar',
        negated: top.negated,
        varName: top.varName,
        op: top.op,
        rhs: top.rhs,
        body: top.body,
        pos: top.pos,
      };
      this.appendToParent(ifVarStep, pos);
      return;
    }
    if (top.kind === 'repeat') {
      const repeatStep: RepeatStep = {
        kind: 'repeat',
        count: top.count,
        body: top.body,
        pos: top.pos,
      };
      this.appendToParent(repeatStep, pos);
      return;
    }
    if (top.kind === 'stable') {
      const stableStep: StableStep = {
        kind: 'stable',
        selector: top.selector,
        body: top.body,
        pos: top.pos,
      };
      this.appendToParent(stableStep, pos);
      return;
    }
  }

  private appendToParent(step: Step, pos: SourcePos): void {
    const parent = this.topFrame();
    if (!parent) {
      throw new ParseError(pos, `closed block has no parent — internal parser error`);
    }
    // Matrix/stage frames don't hold Steps — nested `if` / `repeat` /
    // `stable` blocks cannot live inside them because `handleMatrixLine`
    // and `handleStageLine` reject any non-whitelisted opener up front.
    // If we ever reach here with one of those as the parent it's an
    // internal inconsistency, not a user error.
    if (parent.kind === 'matrix' || parent.kind === 'stage') {
      throw new ParseError(
        pos,
        `internal parser error — cannot append step to ${parent.kind} frame`
      );
    }
    parent.body.push(step);
  }

  // ── Matrix / stage openers and dispatch ──

  /**
   * `matrix "<title>"` — open a top-level matrix block. Matrices cannot
   * nest inside any other block (not even another matrix) — they're a
   * peer of `test` and `define`, and the parse-time namespace wants
   * them to live at the top of a file so the source reads as a flat
   * catalog of runnable entities.
   */
  private openMatrix(text: string, pos: SourcePos): void {
    if (this.stack.length > 0) {
      throw new ParseError(pos, `'matrix' cannot be nested inside another block`);
    }
    const rest = text.slice('matrix '.length).trim();
    if (!rest.startsWith('"')) {
      throw new ParseError(pos, `'matrix' requires a quoted title: matrix "..."`);
    }
    const closeIdx = findClosingQuote(rest, 1);
    if (closeIdx === -1) {
      throw new ParseError(pos, `unterminated string in matrix title`);
    }
    const title = unescapeString(rest.slice(1, closeIdx));
    if (title.length === 0) {
      throw new ParseError(pos, `matrix title cannot be empty`);
    }
    const trailing = rest.slice(closeIdx + 1).trim();
    if (trailing.length > 0) {
      throw new ParseError(pos, `unexpected text after matrix title: '${trailing}'`);
    }
    this.stack.push({
      kind: 'matrix',
      title,
      pos,
      stages: [],
    });
  }

  /**
   * Dispatch a line that appears directly inside a `matrix` frame.
   * Accepts only matrix-local directives: `setup run …`, `mode …`,
   * `stage … one of|bundle of|each of` (sub-block opener). Everything
   * else is a parse error — matrix bodies are intentionally restricted
   * so authors can't accidentally drop a tap/wait/capture at the
   * matrix level where it would never execute.
   */
  private handleMatrixLine(
    frame: Extract<BlockFrame, { kind: 'matrix' }>,
    text: string,
    pos: SourcePos
  ): void {
    // setup run <define> [with args...]
    if (text.startsWith('setup ')) {
      if (frame.setup) {
        throw new ParseError(pos, `matrix '${frame.title}' already has a 'setup run'`);
      }
      const rest = text.slice('setup '.length).trim();
      if (!rest.startsWith('run ')) {
        throw new ParseError(
          pos,
          `matrix '${frame.title}': 'setup' must be 'setup run <define> [with args...]'`
        );
      }
      const runStep = this.parseRun(rest, pos);
      frame.setup = runStep;
      return;
    }

    // mode verbose | quick
    if (text.startsWith('mode ')) {
      if (frame.mode) {
        throw new ParseError(pos, `matrix '${frame.title}' already has a 'mode'`);
      }
      const value = text.slice('mode '.length).trim();
      if (value !== 'verbose' && value !== 'quick') {
        throw new ParseError(
          pos,
          `matrix '${frame.title}': mode must be 'verbose' or 'quick' (got '${value}')`
        );
      }
      frame.mode = value;
      return;
    }

    // stage <name> one of | bundle of | each of
    if (text.startsWith('stage ')) {
      this.openStage(frame, text, pos);
      return;
    }

    throw new ParseError(
      pos,
      `matrix '${frame.title}': unexpected '${verb(text)}' — expected 'setup run …', 'mode …', or 'stage …'`
    );
  }

  private openStage(
    parent: Extract<BlockFrame, { kind: 'matrix' }>,
    text: string,
    pos: SourcePos
  ): void {
    // `stage <name> <kind>` — `<kind>` is one of `one of`, `bundle of`,
    // `each of`. `<name>` is a kebab-case identifier so error messages
    // and tuple strings stay readable.
    const rest = text.slice('stage '.length).trim();
    // Match `<name> (one|bundle|each) of` strictly so `stage probes
    // each OF` doesn't silently pass.
    const m = /^([a-z][a-z0-9-]*)\s+(one|bundle|each)\s+of$/.exec(rest);
    if (!m) {
      throw new ParseError(
        pos,
        `matrix '${parent.title}': stage must be 'stage <name> <one of|bundle of|each of>' (got '${rest}')`
      );
    }
    const [, name, kindWord] = m;
    if (parent.stages.some((s) => s.name === name)) {
      throw new ParseError(pos, `matrix '${parent.title}': duplicate stage '${name}'`);
    }
    const variantKind: StageKind =
      kindWord === 'one' ? 'oneOf' : kindWord === 'bundle' ? 'bundleOf' : 'eachOf';
    this.stack.push({
      kind: 'stage',
      name,
      variantKind,
      pos,
      variants: [],
    });
  }

  /**
   * Dispatch a line inside a `stage` frame. Stages accept only `run`
   * variants — any other verb here would never execute because the
   * matrix runner synthesizes cells by concatenating variant run
   * statements, not stage bodies.
   */
  private handleStageLine(
    frame: Extract<BlockFrame, { kind: 'stage' }>,
    text: string,
    pos: SourcePos
  ): void {
    if (!text.startsWith('run ')) {
      throw new ParseError(
        pos,
        `stage '${frame.name}': only 'run <define>' statements are allowed (got '${verb(text)}')`
      );
    }
    const runStep = this.parseRun(text, pos);
    frame.variants.push(runStep);
  }

  private topFrame(): BlockFrame | undefined {
    return this.stack[this.stack.length - 1];
  }

  // ── Step parser ──

  /**
   * Parse one statement (a non-block line). Block openers (`if`, `repeat`)
   * push a new frame on the stack and return null — their body is collected
   * by the next iterations and finalized on `end`.
   */
  private parseStep(text: string, pos: SourcePos): Step | null {
    // Block openers first — they don't produce a Step yet.
    //
    // Value-based `if` form is dispatched by sniffing the first
    // non-whitespace token after `if ` / `if not `. If it starts with
    // `$`, parse as `IfVarStep`; otherwise fall through to the existing
    // `visible` form. This keeps back-compat with every `if visible
    // #foo` block in existing tests.
    if (text.startsWith('if not $') || /^if\s+\$/.test(text)) {
      return this.parseIfVar(text, pos);
    }
    if (text.startsWith('if not visible ')) {
      const rest = text.slice('if not visible '.length);
      const { selector } = parseSelector(rest, pos);
      this.stack.push({ kind: 'if', negated: true, selector, pos, body: [] });
      return null;
    }
    if (text.startsWith('if visible ')) {
      const rest = text.slice('if visible '.length);
      const { selector } = parseSelector(rest, pos);
      this.stack.push({ kind: 'if', negated: false, selector, pos, body: [] });
      return null;
    }
    if (text.startsWith('repeat ')) {
      // `repeat N times`
      const m = /^repeat\s+(\d+)\s+times$/.exec(text);
      if (!m) {
        throw new ParseError(pos, `'repeat' must be 'repeat N times' (got '${text}')`);
      }
      const count = Number(m[1]);
      if (!Number.isInteger(count) || count < 0) {
        throw new ParseError(pos, `'repeat' count must be a non-negative integer`);
      }
      this.stack.push({ kind: 'repeat', count, pos, body: [] });
      return null;
    }
    // `stable <selector> across` opens a block. The body runs between
    // capture and re-assert, and `end` closes it. The `across` keyword
    // reads naturally out loud — "this screen is stable *across* these
    // operations" — and makes it obvious that the body is what might
    // change vs. what the check is guarding.
    if (text.startsWith('stable ')) {
      const rest = text.slice('stable '.length);
      const { selector, consumed } = parseSelector(rest, pos);
      const tail = rest.slice(consumed).trim();
      if (tail !== 'across') {
        throw new ParseError(
          pos,
          `'stable <selector>' must be followed by 'across' (got '${tail}')`
        );
      }
      this.stack.push({ kind: 'stable', selector, pos, body: [] });
      return null;
    }

    // Wallet — match before generic verbs so `wallet send` doesn't trip on `send`.
    if (text.startsWith('wallet ')) {
      return this.parseWallet(text, pos);
    }

    // Plain verbs (longest prefix match for multi-word forms).
    if (text === 'home') return { kind: 'home', pos } satisfies HomeStep;
    if (text === 'back') return { kind: 'back', pos };
    if (text === 'dismiss') return { kind: 'dismiss', pos } satisfies DismissStep;

    if (text.startsWith('launch ')) {
      const bundleId = text.slice('launch '.length).trim();
      if (bundleId.length === 0) {
        throw new ParseError(pos, `'launch' requires a bundle id`);
      }
      return { kind: 'launch', bundleId, pos } satisfies LaunchStep;
    }

    if (text.startsWith('keypad ')) {
      const raw = text.slice('keypad '.length).trim();
      // Accept either a literal 0-9 or a `$var`/`${var}` reference that
      // resolves to a single digit at runtime. Normalise the bare
      // `$name` form to `${name}` so the executor's interpolation
      // regex (`${name}` only) handles both uniformly. The executor
      // re-validates after interpolation so a caller passing "10"
      // through a param gets a clear runtime error instead of a
      // silent no-op.
      let digit = raw;
      const bareRef = /^\$([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(raw);
      if (bareRef) digit = `\${${bareRef[1]}}`;
      const isLiteral = /^[0-9]$/.test(digit);
      const isBracedRef = /^\$\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(digit);
      if (!isLiteral && !isBracedRef) {
        throw new ParseError(
          pos,
          `'keypad' requires a single digit 0-9 or a $var reference (got '${raw}')`
        );
      }
      return { kind: 'keypad', digit, pos } satisfies KeypadStep;
    }

    if (text.startsWith('swipe ')) {
      const dir = text.slice('swipe '.length).trim();
      if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') {
        throw new ParseError(
          pos,
          `'swipe' direction must be one of up|down|left|right (got '${dir}')`
        );
      }
      return { kind: 'swipe', direction: dir, pos } satisfies SwipeStep;
    }

    if (text.startsWith('scroll ')) return this.parseScrollUntil(text, pos);

    if (text.startsWith('screenshot ')) {
      const rest = text.slice('screenshot '.length).trim();
      const name = rest.startsWith('"') ? parseQuotedString(rest, pos) : rest;
      return { kind: 'screenshot', name, pos } satisfies ScreenshotStep;
    }

    if (text.startsWith('run ')) {
      return this.parseRun(text, pos);
    }

    if (text.startsWith('tap ')) return this.parseTap(text, pos);
    if (text.startsWith('type ')) return this.parseType(text, pos);
    if (text.startsWith('wait for ')) return this.parseWaitFor(text, pos);
    if (text.startsWith('assert ')) return this.parseAssert(text, pos);
    if (text.startsWith('capture ')) return this.parseCapture(text, pos);
    if (text.startsWith('snapshot ')) return this.parseSnapshot(text, pos);
    if (text.startsWith('clipboard set ')) return this.parseClipboardSet(text, pos);

    throw new ParseError(pos, `unknown verb '${verb(text)}'`);
  }

  // ── Verb-specific parsers ──

  /**
   * `tap <selector>`
   * `tap <selector> when visible`
   * `tap <selector> when visible within Ns`
   * `tap <selector> expect no-change`
   */
  private parseTap(text: string, pos: SourcePos): TapStep {
    const rest = text.slice('tap '.length);
    const { selector, consumed } = parseSelector(rest, pos);
    const tail = rest.slice(consumed).trim();

    const step: TapStep = { kind: 'tap', selector, pos };

    if (tail === '') return step;

    if (tail === 'expect no-change') {
      step.expectNoChange = true;
      return step;
    }

    // `when visible` [`within Ns`]
    const wvMatch = /^when\s+visible(?:\s+within\s+(\d+)s)?$/.exec(tail);
    if (wvMatch) {
      step.whenVisible = { whenVisible: true };
      if (wvMatch[1]) {
        step.whenVisible.withinMs = Number(wvMatch[1]) * 1000;
      }
      return step;
    }

    throw new ParseError(
      pos,
      `unexpected modifier on 'tap': '${tail}' (expected 'when visible [within Ns]' or 'expect no-change')`
    );
  }

  /**
   * `type <"string">`
   * `type <"string"> into <selector>`
   */
  private parseType(text: string, pos: SourcePos): TypeStep {
    const rest = text.slice('type '.length);
    if (!rest.startsWith('"')) {
      throw new ParseError(pos, `'type' requires a quoted string: type "..."`);
    }
    const closeIdx = findClosingQuote(rest, 1);
    if (closeIdx === -1) {
      throw new ParseError(pos, `unterminated string in 'type'`);
    }
    const typedText = unescapeString(rest.slice(1, closeIdx));
    const tail = rest.slice(closeIdx + 1).trim();

    const step: TypeStep = { kind: 'type', text: typedText, pos };

    if (tail === '') return step;

    if (tail.startsWith('into ')) {
      const intoTail = tail.slice('into '.length);
      const { selector } = parseSelector(intoTail, pos);
      step.into = selector;
      return step;
    }

    throw new ParseError(pos, `unexpected text after 'type "..."': '${tail}'`);
  }

  /**
   * `scroll until <selector> visible`
   * `scroll until <selector> visible within Ns`
   * `scroll down until <selector> visible`         — reverse direction
   *
   * Fully visible is the only semantics — partial visibility doesn't
   * make the subsequent tap safe, so we don't accept a `partially`
   * modifier.
   */
  private parseScrollUntil(text: string, pos: SourcePos): ScrollUntilStep {
    // `scroll up until ...`, `scroll down until ...`, or bare
    // `scroll until ...` (which defaults to `up`).
    let rest = text.slice('scroll '.length);
    let direction: 'up' | 'down' = 'up';
    if (rest.startsWith('up ')) {
      rest = rest.slice(3);
    } else if (rest.startsWith('down ')) {
      direction = 'down';
      rest = rest.slice(5);
    }
    if (!rest.startsWith('until ')) {
      throw new ParseError(
        pos,
        `'scroll' requires 'scroll [up|down] until <selector> visible' (got '${text}')`
      );
    }
    rest = rest.slice('until '.length);
    const { selector, consumed } = parseSelector(rest, pos);
    const tail = rest.slice(consumed).trim();

    if (!tail.startsWith('visible')) {
      throw new ParseError(
        pos,
        `'scroll until <selector>' must be followed by 'visible' (got '${tail}')`
      );
    }
    const afterVisible = tail.slice('visible'.length).trim();

    const step: ScrollUntilStep = { kind: 'scrollUntil', selector, direction, pos };
    if (afterVisible === '') return step;

    const m = /^within\s+(\d+)s$/.exec(afterVisible);
    if (m) {
      step.withinMs = Number(m[1]) * 1000;
      return step;
    }

    throw new ParseError(
      pos,
      `unexpected modifier on 'scroll until': '${afterVisible}' (expected 'within Ns')`
    );
  }

  /**
   * `wait for <selector>`
   * `wait for <selector> within Ns`
   * `wait for screen <selector>`
   * `wait for screen <selector> within Ns`
   */
  private parseWaitFor(text: string, pos: SourcePos): WaitForStep {
    let rest = text.slice('wait for '.length);
    let isScreen = false;
    if (rest.startsWith('screen ')) {
      isScreen = true;
      rest = rest.slice('screen '.length);
    }
    const { selector, consumed } = parseSelector(rest, pos);
    const tail = rest.slice(consumed).trim();

    const step: WaitForStep = { kind: 'waitFor', selector, pos };
    if (isScreen) step.isScreen = true;

    if (tail === '') return step;

    const m = /^within\s+(\d+)s$/.exec(tail);
    if (m) {
      step.withinMs = Number(m[1]) * 1000;
      return step;
    }

    throw new ParseError(pos, `unexpected modifier on 'wait for': '${tail}'`);
  }

  /**
   * `assert <selector> visible [within Ns]`
   * `assert <selector> not visible`
   * `assert $var <op> <rhs>`        — starts-with | contains | matches | eq | gt
   * `assert screen eq $var`
   * `assert <selector> eq $var`     — subtree comparison
   */
  private parseAssert(
    text: string,
    pos: SourcePos
  ): AssertVisibleStep | AssertNotVisibleStep | AssertVarStep | AssertScreenEqStep {
    const rest = text.slice('assert '.length);

    // ── assert screen eq $var ──
    if (rest.startsWith('screen eq ')) {
      const varRef = rest.slice('screen eq '.length).trim();
      const varName = parseVarRef(varRef, pos);
      return { kind: 'assertScreenEq', varName, pos };
    }

    // ── assert $var <op> <rhs> ──
    if (rest.startsWith('$')) {
      const m = /^\$([a-zA-Z_][a-zA-Z0-9_]*)\s+(starts-with|contains|matches|eq|gt|cashu-amount|bolt11-amount)\s+(.+)$/.exec(
        rest
      );
      if (!m) {
        throw new ParseError(
          pos,
          `'assert $var' must be 'assert $name <starts-with|contains|matches|eq|gt|cashu-amount|bolt11-amount> <rhs>'`
        );
      }
      const [, varName, op, rhsRaw] = m;
      const rhs = parseAssertRhs(rhsRaw.trim(), pos);
      return {
        kind: 'assertVar',
        varName,
        op: op as AssertVarStep['op'],
        rhs,
        pos,
      };
    }

    // ── assert <selector> visible | not visible | eq $var ──
    const { selector, consumed } = parseSelector(rest, pos);
    const tail = rest.slice(consumed).trim();

    if (tail === 'visible') {
      return { kind: 'assertVisible', selector, pos };
    }
    if (tail === 'not visible') {
      return { kind: 'assertNotVisible', selector, pos };
    }
    const visibleWithin = /^visible\s+within\s+(\d+)s$/.exec(tail);
    if (visibleWithin) {
      return {
        kind: 'assertVisible',
        selector,
        withinMs: Number(visibleWithin[1]) * 1000,
        pos,
      };
    }
    if (tail.startsWith('eq ')) {
      const varRef = tail.slice('eq '.length).trim();
      const varName = parseVarRef(varRef, pos);
      return { kind: 'assertScreenEq', selector, varName, pos };
    }

    throw new ParseError(
      pos,
      `unexpected 'assert' form: '${tail}' (expected 'visible', 'not visible', 'visible within Ns', or 'eq $var')`
    );
  }

  /**
   * `capture <selector> as $var`
   * `capture <selector> suffix as $var`     — only valid for #prefix* selectors
   * `capture clipboard as $var`
   */
  private parseCapture(
    text: string,
    pos: SourcePos
  ): CaptureLabelStep | CaptureSuffixStep | CaptureClipboardStep {
    const rest = text.slice('capture '.length);

    // ── capture clipboard as $var ──
    if (rest.startsWith('clipboard as ')) {
      const varName = parseVarRef(rest.slice('clipboard as '.length).trim(), pos);
      return { kind: 'captureClipboard', varName, pos };
    }

    // ── capture <selector> [suffix] as $var ──
    const { selector, consumed } = parseSelector(rest, pos);
    const tail = rest.slice(consumed).trim();

    if (tail.startsWith('suffix as ')) {
      if (selector.kind !== 'idPrefix') {
        throw new ParseError(
          pos,
          `'capture ... suffix as' requires a wildcard selector (#prefix*)`
        );
      }
      const varName = parseVarRef(tail.slice('suffix as '.length).trim(), pos);
      return { kind: 'captureSuffix', selector, varName, pos };
    }
    if (tail.startsWith('as ')) {
      const varName = parseVarRef(tail.slice('as '.length).trim(), pos);
      return { kind: 'captureLabel', selector, varName, pos };
    }

    throw new ParseError(pos, `'capture' requires '... as $var' or '... suffix as $var'`);
  }

  /**
   * `snapshot screen as $var`
   * `snapshot <selector> as $var`
   */
  private parseSnapshot(text: string, pos: SourcePos): SnapshotStep {
    const rest = text.slice('snapshot '.length);

    if (rest.startsWith('screen as ')) {
      const varName = parseVarRef(rest.slice('screen as '.length).trim(), pos);
      return { kind: 'snapshot', varName, pos };
    }

    const { selector, consumed } = parseSelector(rest, pos);
    const tail = rest.slice(consumed).trim();
    if (tail.startsWith('as ')) {
      const varName = parseVarRef(tail.slice('as '.length).trim(), pos);
      return { kind: 'snapshot', selector, varName, pos };
    }

    throw new ParseError(pos, `'snapshot' requires '... as $var'`);
  }

  /**
   * `clipboard set <text or $var>`
   *
   * Writes the given text to the iOS clipboard. Supports `${var}` interpolation.
   */
  private parseClipboardSet(text: string, pos: SourcePos): SetClipboardStep {
    let content = text.slice('clipboard set '.length).trim();
    if (!content) {
      throw new ParseError(pos, `'clipboard set' requires a value (literal or $var)`);
    }
    // Normalize bare `$varName` to `${varName}` for the interpolation engine.
    // Supports both `clipboard set $invoice` and `clipboard set ${invoice}`.
    content = content.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, '${$1}');
    return { kind: 'setClipboard', text: content, pos };
  }

  /**
   * `wallet <subcommand path> [args...] [as $var]`
   *
   * Examples:
   *   wallet balance as $bal
   *   wallet send cashu 100 as $token
   *   wallet send bolt11 $invoice
   *   wallet receive bolt11 50 as $invoice
   *   wallet mints add https://21mint.me
   *   wallet npc address as $addr
   *   wallet x-cashu parse $request as $parsed
   */
  /**
   * `run <name>` — legacy, zero-arg invocation.
   * `run <name> with <arg> <arg> ...` — positional args. Each arg is a
   * quoted literal `"foo"`, a `$var` reference, or a bare kebab/number
   * token. Reuses `tokenizeWalletLine` and `WalletArg` so the grammar
   * is identical to `wallet`'s arg list.
   */
  private parseRun(text: string, pos: SourcePos): RunStep {
    const rest = text.slice('run '.length).trim();
    if (rest.length === 0) {
      throw new ParseError(pos, `'run' requires a define name`);
    }
    // Split on the first `with` keyword (space-bounded so a define
    // named `with-foo` isn't misparsed).
    const withIdx = rest.search(/\s+with(?:\s|$)/);
    const defineName = withIdx === -1 ? rest : rest.slice(0, withIdx).trim();
    if (!/^[a-z][a-z0-9-]*$/.test(defineName)) {
      throw new ParseError(
        pos,
        `run target '${defineName}' must be a kebab-case define name`
      );
    }
    const step: RunStep = { kind: 'run', defineName, pos };
    if (withIdx === -1) return step;

    const argsPart = rest.slice(withIdx).replace(/^\s+with\s*/, '').trim();
    if (argsPart.length === 0) {
      throw new ParseError(pos, `'run ${defineName} with' requires at least one argument`);
    }
    const tokens = tokenizeWalletLine(argsPart, pos);
    const args: WalletArg[] = [];
    for (const t of tokens) {
      if (t.startsWith('$')) {
        const name = t.slice(1);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
          throw new ParseError(pos, `invalid var reference '$${name}' in 'run ... with'`);
        }
        args.push({ kind: 'var', name });
      } else if (t.startsWith('"')) {
        args.push({ kind: 'literal', value: unescapeString(t.slice(1, -1)) });
      } else {
        args.push({ kind: 'literal', value: t });
      }
    }
    step.args = args;
    return step;
  }

  /**
   * `if $var <op> <rhs>` / `if not $var <op> <rhs>` — value-based block.
   * Mirrors the `assert $var <op> <rhs>` parser exactly so the two forms
   * can't diverge: same operator set, same rhs grammar, same error
   * messages. Pushes an `ifVar` frame on the block stack and returns
   * null — the body is collected until `end`.
   */
  private parseIfVar(text: string, pos: SourcePos): null {
    const negated = text.startsWith('if not ');
    const rest = negated ? text.slice('if not '.length) : text.slice('if '.length);
    const m = /^\$([a-zA-Z_][a-zA-Z0-9_]*)\s+(starts-with|contains|matches|eq|gt|cashu-amount|bolt11-amount)\s+(.+)$/.exec(
      rest.trim()
    );
    if (!m) {
      throw new ParseError(
        pos,
        `'if $var' must be 'if [not] $name <starts-with|contains|matches|eq|gt|cashu-amount|bolt11-amount> <rhs>'`
      );
    }
    const [, varName, op, rhsRaw] = m;
    const rhs = parseAssertRhs(rhsRaw.trim(), pos);
    this.stack.push({
      kind: 'ifVar',
      negated,
      varName,
      op: op as IfVarStep['op'],
      rhs,
      pos,
      body: [],
    });
    return null;
  }

  private parseWallet(text: string, pos: SourcePos): WalletStep {
    const rest = text.slice('wallet '.length).trim();
    if (rest.length === 0) {
      throw new ParseError(pos, `'wallet' requires a subcommand`);
    }

    // Split into tokens. The trailing `as $var` (if present) becomes `as`.
    const tokens = tokenizeWalletLine(rest, pos);
    let asVar: string | undefined;
    if (tokens.length >= 2 && tokens[tokens.length - 2] === 'as') {
      const last = tokens[tokens.length - 1];
      if (!last.startsWith('$')) {
        throw new ParseError(pos, `'wallet ... as' requires a $var binding`);
      }
      asVar = last.slice(1);
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(asVar)) {
        throw new ParseError(pos, `invalid var name '$${asVar}' after 'as'`);
      }
      tokens.length -= 2; // drop the `as $var` tail
    }

    // Subcommand path: leading lowercase verbs (no $/" prefix) before any
    // positional arg. We accept up to 3 path tokens (e.g. `send cashu`,
    // `mints add`, `x-cashu parse`) — anything after that is positional.
    const command: string[] = [];
    let i = 0;
    while (i < tokens.length && i < 3 && isWalletPathToken(tokens[i])) {
      command.push(tokens[i]);
      i++;
    }
    if (command.length === 0) {
      throw new ParseError(pos, `'wallet' requires a subcommand path`);
    }

    const args: WalletArg[] = [];
    for (; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.startsWith('$')) {
        const name = t.slice(1);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
          throw new ParseError(pos, `invalid var reference '$${name}' in 'wallet' args`);
        }
        args.push({ kind: 'var', name });
      } else if (t.startsWith('"')) {
        // Quoted literal — strip the surrounding quotes (already validated by tokenizer).
        args.push({ kind: 'literal', value: unescapeString(t.slice(1, -1)) });
      } else {
        args.push({ kind: 'literal', value: t });
      }
    }

    const step: WalletStep = { kind: 'wallet', command, args, pos };
    if (asVar) step.as = asVar;
    return step;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function verb(text: string): string {
  const sp = text.indexOf(' ');
  return sp === -1 ? text : text.slice(0, sp);
}

function findClosingQuote(s: string, start: number): number {
  let i = start;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"') return i;
    i++;
  }
  return -1;
}

function parseQuotedString(rest: string, pos: SourcePos): string {
  if (!rest.startsWith('"')) {
    throw new ParseError(pos, `expected a quoted string`);
  }
  const closeIdx = findClosingQuote(rest, 1);
  if (closeIdx === -1) {
    throw new ParseError(pos, `unterminated string literal`);
  }
  return unescapeString(rest.slice(1, closeIdx));
}

/**
 * Parse a `$name` token, returning just the name. Used by `as $var`,
 * `assert screen eq $var`, etc.
 */
function parseVarRef(token: string, pos: SourcePos): string {
  if (!token.startsWith('$')) {
    throw new ParseError(pos, `expected a $var reference (got '${token}')`);
  }
  const name = token.slice(1);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new ParseError(pos, `invalid variable name '$${name}'`);
  }
  return name;
}

/**
 * Parse the right-hand side of an `assert $var <op> <rhs>` statement.
 * Allowed: a quoted literal `"foo"` or another `$var`. Bare numbers are
 * coerced to literal strings — the executor handles numeric ops via
 * Number() at compare time.
 */
function parseAssertRhs(
  rhs: string,
  pos: SourcePos
): { kind: 'literal'; value: string } | { kind: 'var'; name: string } {
  if (rhs.startsWith('"')) {
    return { kind: 'literal', value: parseQuotedString(rhs, pos) };
  }
  if (rhs.startsWith('$')) {
    return { kind: 'var', name: parseVarRef(rhs, pos) };
  }
  // Bare number / unquoted literal — accept and treat as literal string.
  return { kind: 'literal', value: rhs };
}

function parseVerifiedComment(text: string, line: number): VerifiedComment {
  // `# verified: 2026-04-10 13:01:42 — iphone (iOS 26.1)`
  // Be lenient: date is required, time and device are optional.
  const body = text.replace(/^#\s*verified\s*:\s*/i, '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?(?:\s*[—-]\s*(.+))?$/.exec(body);
  if (!m) {
    // Tolerant fallback — store the whole body as device, today as date.
    const today = new Date().toISOString().slice(0, 10);
    return { date: today, device: body, line };
  }
  const out: VerifiedComment = { date: m[1], line };
  if (m[2]) out.time = m[2];
  if (m[3]) out.device = m[3];
  return out;
}

/**
 * Tokenize a `wallet` argument line, honouring quoted strings and `$var`
 * tokens. Whitespace is the separator outside of quotes.
 */
function tokenizeWalletLine(s: string, pos: SourcePos): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
    if (i >= s.length) break;

    if (s[i] === '"') {
      const close = findClosingQuote(s, i + 1);
      if (close === -1) {
        throw new ParseError(pos, `unterminated string literal in 'wallet'`);
      }
      out.push(s.slice(i, close + 1));
      i = close + 1;
      continue;
    }

    let start = i;
    while (i < s.length && s[i] !== ' ' && s[i] !== '\t') i++;
    out.push(s.slice(start, i));
  }
  return out;
}

/**
 * A wallet path token is a bare lowercase identifier (no $, no ", no leading
 * digit). Used to disambiguate the multi-word subcommand path from positional
 * arguments.
 */
function isWalletPathToken(t: string): boolean {
  if (t.startsWith('$') || t.startsWith('"')) return false;
  return /^[a-z][a-z0-9-]*$/.test(t);
}
