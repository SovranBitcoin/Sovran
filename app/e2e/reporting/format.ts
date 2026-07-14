/**
 * Pure rendering helpers shared by every reporter. No I/O, no cursor math here —
 * just event → text. Status is carried by a distinct glyph per outcome, never by
 * colour alone. ASCII fallbacks are provided for `unicode:false` terminals.
 */
import type { RunnerEvent } from '../core/events';

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
export const SPINNER_ASCII = ['|', '/', '-', '\\'] as const;

const UNICODE = {
  scenario: '▶',
  phase: '▸',
  phaseDone: '▣',
  pass: '✓',
  fail: '✗',
  warn: '⚠',
  retry: '↺',
  skip: '⏭',
  deferred: '◌',
  cleanup: '♻',
  detail: '→',
  nested: '╰',
  timing: '⏱',
  block: '█',
  empty: '░',
} as const;
const ASCII = {
  scenario: '>',
  phase: '-',
  phaseDone: '=',
  pass: 'PASS',
  fail: 'FAIL',
  warn: 'WARN',
  retry: 'RETRY',
  skip: 'SKIP',
  deferred: 'DEFER',
  cleanup: 'CLEAN',
  detail: '->',
  nested: 'L',
  timing: 't',
  block: '#',
  empty: '.',
} as const;

export type Glyphs = typeof UNICODE;
export const glyphs = (unicode: boolean): Glyphs =>
  unicode ? UNICODE : (ASCII as unknown as Glyphs);

export const fmtDuration = (ms: number): string =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
const pad = (n: number) => ' '.repeat(Math.max(0, n));
const phaseLabel = (
  phase: Extract<RunnerEvent, { type: 'phase.begin' }>['phase'],
  completed = false
) => {
  switch (phase) {
    case 'precondition':
      return 'PRECONDITION';
    case 'test':
      return completed ? 'TEST' : 'TEST START';
    case 'verify':
      return 'VERIFY';
    case 'cleanup':
      return 'CLEANUP';
  }
};

/** The append-only scrollback line for an event, or null if the event only
 *  updates the live area / carries no visible line. Multi-line for failures. */
export function lineFor(e: RunnerEvent, unicode = true): string | null {
  const g = glyphs(unicode);
  switch (e.type) {
    case 'run.begin':
      return e.proof === 'orchestration-smoke'
        ? `${g.warn} orchestration smoke — not product proof`
        : null;
    case 'scenario.begin':
      return `${g.scenario} scenario ${e.id}`;
    case 'lifecycle':
      return `${pad(2)}${g.detail} ${e.message}`;
    case 'fixture.begin':
      return `${pad(2)}${g.phase} fixture ${e.id} #${e.invocation}`;
    case 'fixture.end':
      return `${pad(2)}${e.ok ? g.pass : g.fail} fixture ${e.id} #${e.invocation}${pad(4)}${fmtDuration(e.durationMs)}`;
    case 'phase.begin':
      return `${pad(2)}${g.phase} ${phaseLabel(e.phase)}`;
    case 'phase.end':
      return `${pad(2)}${e.ok ? g.pass : g.fail} ${phaseLabel(e.phase, true)}${pad(4)}${fmtDuration(e.durationMs)}`;
    case 'step.end': {
      const head = `${pad(4)}${e.ok ? g.pass : g.fail} [${e.stepId}] ${e.label}${pad(4)}${fmtDuration(e.durationMs)}`;
      return e.ok || !e.error ? head : `${head}\n${pad(8)}${g.nested} ${e.error}`;
    }
    case 'assertion.end': {
      const head = `${pad(4)}${e.ok ? g.pass : g.fail} [${e.stepId}] ${e.label}${pad(4)}${fmtDuration(e.durationMs)}`;
      return e.ok || !e.error ? head : `${head}\n${pad(8)}${g.nested} ${e.error}`;
    }
    case 'retry':
      return `${pad(4)}${g.retry} [#${String(e.index).padStart(2, '0')}] attempt ${e.attempt}/${e.max}`;
    case 'baseline.failure':
      return `${pad(4)}${g.fail} balance baseline ${e.unit} — ${e.error}`;
    case 'skip':
      return `${pad(4)}${g.skip} optional step skipped: ${e.reason}`;
    case 'deferred':
      return `${pad(2)}${g.deferred} deferred ${e.capability} — ${e.reason}`;
    case 'artifact':
      return `${pad(8)}${g.detail} ${e.kind}: ${e.path}`;
    case 'cleanup.begin':
      return `${pad(2)}${g.cleanup} cleanup`;
    case 'cleanup.skipped':
      return `${pad(4)}${g.skip} skipped ${e.count} device cleanup step(s) — ${e.reason}`;
    case 'cleanup.end':
      return `${pad(2)}${e.ok ? g.pass : g.fail} cleanup ${e.ok ? 'complete' : 'failed'}${pad(4)}${fmtDuration(e.durationMs)}`;
    case 'sweep-leg.end':
      return `${pad(4)}${e.ok ? g.pass : g.fail} sweep ${e.mintHost} ${e.recoveredSat} ${e.unit}`;
    case 'reconciliation.end':
      return `${pad(4)}${e.ok ? g.pass : g.fail} reconcile ${e.state}`;
    case 'quarantine':
      return `${pad(4)}${g.warn} quarantined: ${e.reason}`;
    case 'final-state':
      return `${pad(4)}${e.skipped ? g.skip : e.ok ? g.pass : g.fail} final state ${e.skipped ? 'skipped' : e.actual}${e.error ? ` — ${e.error}` : ''}`;
    case 'scenario.end':
      return `${e.ok ? g.pass : g.fail} scenario ${e.id}${pad(4)}${fmtDuration(e.durationMs)}`;
    case 'run.end': {
      const bar = '─'.repeat(48);
      const total = e.passed + e.failed + e.skipped + e.deferred;
      return `${bar}\n  ${total} scenario(s) · ${g.pass} ${e.passed}  ${g.fail} ${e.failed}  scenario-skipped ${e.skipped}  ${g.deferred} ${e.deferred}  ${g.timing} ${fmtDuration(e.durationMs)}  funds: ${e.funds}  proof: ${e.proof}\n${bar}`;
    }
    default:
      return null;
  }
}

export function progressBar(done: number, total: number, width = 20, unicode = true): string {
  const g = glyphs(unicode);
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  return g.block.repeat(filled) + g.empty.repeat(Math.max(0, width - filled));
}

export function spinnerFrame(tick: number, unicode = true): string {
  const frames = unicode ? SPINNER : SPINNER_ASCII;
  return frames[tick % frames.length];
}

/** The sticky footer string (progress + live tally + current step). */
export function footer(
  s: {
    done: number;
    total: number;
    passed: number;
    failed: number;
    optionalSkipped: number;
    deferred: number;
    elapsedMs: number;
    current?: string;
    tick: number;
  },
  width = 80,
  unicode = true
): string {
  const g = glyphs(unicode);
  const bar = progressBar(s.done, s.total, 20, unicode);
  const spin = s.current ? `${spinnerFrame(s.tick, unicode)} ${s.current}` : 'done';
  const line = `${bar} ${s.done}/${s.total} ${g.pass}${s.passed} ${g.fail}${s.failed} optional:${s.optionalSkipped} ${g.deferred}${s.deferred} ${g.timing}${fmtDuration(s.elapsedMs)}  ${spin}`;
  return line.length > width ? line.slice(0, width - 1) + '…' : line;
}
