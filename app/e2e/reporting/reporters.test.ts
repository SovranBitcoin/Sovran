import { describe, expect, it } from 'bun:test';
import { EventBus, type EmitInput } from '../core/events';
import { secret } from '../core/redact';
import {
  arraySink,
  arrayTerm,
  JsonlReporter,
  PlainReporter,
  StreamTerm,
  TtyReporter,
} from './reporters';
import { footer, lineFor, glyphs } from './format';

const CASHU = 'cashu' + 'B' + 'o' + 'a'.repeat(30);

/** Drives one scenario that fails mid-behavior, then cleans up + reconciles. */
function drive(bus: EventBus) {
  const evs: EmitInput[] = [
    { type: 'run.begin', runId: 'r1', proof: 'product-run', totalScenarios: 1 },
    {
      type: 'scenario.begin',
      id: 'send.lightning.sat',
      name: 'Send',
      lane: 'funded',
      index: 0,
      total: 1,
    },
    { type: 'phase.begin', phase: 'precondition' },
    { type: 'fixture.begin', id: 'given.wallet.funded', invocation: 1 },
    { type: 'step.begin', index: 1, stepId: 'P01', kind: 'exec', label: 'fund 100 sat' },
    {
      type: 'step.end',
      index: 1,
      stepId: 'P01',
      kind: 'exec',
      label: 'fund 100 sat',
      ok: true,
      durationMs: 412,
      detail: { token: secret('cashu-token', CASHU) },
    },
    { type: 'fixture.end', id: 'given.wallet.funded', invocation: 1, ok: true, durationMs: 500 },
    { type: 'phase.end', phase: 'precondition', ok: true, durationMs: 6200 },
    { type: 'phase.begin', phase: 'test' },
    { type: 'step.begin', index: 2, stepId: 'T01', kind: 'tap', label: 'confirm payment' },
    { type: 'retry', index: 2, attempt: 1, max: 2 },
    {
      type: 'step.end',
      index: 2,
      stepId: 'T01',
      kind: 'tap',
      label: 'confirm payment',
      ok: false,
      durationMs: 30000,
      error: 'timed out after 30s',
    },
    { type: 'cleanup.begin' },
    { type: 'cleanup.end', ok: true, durationMs: 100 },
    {
      type: 'sweep-leg.end',
      mintHost: 'mint.sovran.money',
      unit: 'sat',
      ok: true,
      recoveredSat: 60,
    },
    { type: 'reconciliation.end', ok: true, state: 'reconciled' },
    {
      type: 'scenario.end',
      id: 'send.lightning.sat',
      ok: false,
      durationMs: 40000,
      funds: 'reconciled',
    },
    {
      type: 'run.end',
      runId: 'r1',
      passed: 0,
      failed: 1,
      skipped: 0,
      deferred: 0,
      durationMs: 41000,
      funds: 'reconciled',
      proof: 'product-run',
    },
  ];
  for (const e of evs) bus.emit(e);
  return evs.length;
}

const clock = () => {
  let t = 0;
  return () => (t += 100);
};

describe('JsonlReporter', () => {
  it('emits one redacted JSON line per event', () => {
    const bus = new EventBus(clock());
    const sink = arraySink();
    bus.subscribe(new JsonlReporter(sink).on);
    const n = drive(bus);
    expect(sink.lines).toHaveLength(n);
    for (const l of sink.lines) expect(() => JSON.parse(l)).not.toThrow();
    const all = sink.lines.join('');
    expect(all).not.toContain(CASHU);
    expect(all).toContain('"secret":true');
    expect(all).toContain('"seq":0');
    expect(all).toContain('"proof":"product-run"');
  });
});

describe('PlainReporter', () => {
  const render = (unicode = true) => {
    const bus = new EventBus(clock());
    const sink = arraySink();
    bus.subscribe(new PlainReporter(sink, unicode).on);
    drive(bus);
    return sink.lines.join('');
  };
  it('shows the failed step with a nested error and keeps cleanup visible after failure', () => {
    const out = render();
    expect(out).toContain('✗ [T01] confirm payment');
    expect(out).toContain('TEST START');
    expect(out).toContain('╰ timed out after 30s');
    const failAt = out.indexOf('[T01] confirm payment');
    const cleanupAt = out.indexOf('♻ cleanup');
    expect(cleanupAt).toBeGreaterThan(failAt);
    expect(out).toContain('sweep mint.sovran.money 60 sat');
    expect(out).toContain('funds: reconciled');
    expect(out).toContain('✓ fixture given.wallet.funded');
    expect(out).toContain('✓ PRECONDITION');
    expect(out).toContain('✓ cleanup complete');
    expect(out).toContain('✗ scenario send.lightning.sat');
  });
  it('never leaks a secret', () => {
    expect(render()).not.toContain(CASHU);
  });
  it('falls back to ASCII glyphs when unicode is off', () => {
    const out = render(false);
    expect(out).toContain('FAIL [T01]');
    expect(out).not.toContain('✗');
  });
});

describe('TtyReporter', () => {
  it('appends completed lines (append-only), animates one live footer, ends on run.end', () => {
    const bus = new EventBus(clock());
    const term = arrayTerm();
    bus.subscribe(new TtyReporter(term, { width: 100 }).on);
    drive(bus);
    // append-only: the failure line and the later cleanup line both survive in order
    const joined = term.appends.join('\n');
    expect(joined).toContain('✗ [T01] confirm payment');
    expect(joined.indexOf('♻ cleanup')).toBeGreaterThan(joined.indexOf('[T01] confirm payment'));
    expect(term.ended).toBe(true);
    expect(term.lastLive.length).toBeGreaterThan(0); // a single live footer is maintained
  });

  it('counts deferred scenarios as completed outcomes in progress and summary', () => {
    const bus = new EventBus(clock());
    const term = arrayTerm();
    bus.subscribe(new TtyReporter(term, { width: 120 }).on);
    bus.emit({ type: 'run.begin', runId: 'r', proof: 'product-run', totalScenarios: 2 });
    bus.emit({
      type: 'deferred',
      scenarioId: 'blocked.case',
      capability: 'requires',
      reason: 'not available',
    });
    bus.emit({
      type: 'scenario.begin',
      id: 'ready.case',
      name: 'Ready',
      lane: 'simulator',
      index: 2,
      total: 2,
    });
    bus.emit({ type: 'scenario.end', id: 'ready.case', ok: true, durationMs: 10 });
    bus.emit({
      type: 'run.end',
      runId: 'r',
      passed: 1,
      failed: 0,
      skipped: 0,
      deferred: 1,
      durationMs: 20,
      funds: 'n/a',
      proof: 'product-run',
    });
    expect(term.lastLive).toContain('2/2');
    expect(term.appends.join('\n')).toContain('2 scenario(s)');
  });

  it('keeps a single cursor-controlled live line beneath append-only output', () => {
    const sink = arraySink();
    const term = new StreamTerm(sink);
    term.live('working');
    term.append('completed');
    term.live('done');
    term.end();
    const output = sink.lines.join('');
    expect(output).toContain('\u001b[2K');
    expect(output).toContain('completed\n');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('counts optional step skips separately from scenario outcomes', () => {
    const bus = new EventBus(clock());
    const term = arrayTerm();
    bus.subscribe(new TtyReporter(term, { width: 140 }).on);
    bus.emit({ type: 'run.begin', runId: 'r', proof: 'product-run', totalScenarios: 1 });
    bus.emit({ type: 'scenario.begin', id: 's', name: 'S', lane: 'simulator', index: 1, total: 1 });
    bus.emit({ type: 'skip', index: 1, reason: 'optional banner absent' });
    bus.emit({ type: 'scenario.end', id: 's', ok: true, durationMs: 1 });
    bus.emit({
      type: 'run.end',
      runId: 'r',
      passed: 1,
      failed: 0,
      skipped: 0,
      deferred: 0,
      durationMs: 2,
      funds: 'n/a',
      proof: 'product-run',
    });
    expect(term.lastLive).toContain('1/1');
    expect(term.lastLive).toContain('optional:1');
    expect(term.appends.join('\n')).toContain('optional step skipped');
    expect(term.appends.join('\n')).toContain('1 scenario(s)');
  });
});

describe('format helpers', () => {
  it('truncates a wide footer to the terminal width', () => {
    const f = footer(
      {
        done: 1,
        total: 2,
        passed: 1,
        failed: 0,
        optionalSkipped: 0,
        deferred: 0,
        elapsedMs: 3000,
        current: 'a very long current step label that overflows',
        tick: 3,
      },
      20
    );
    expect(f.length).toBeLessThanOrEqual(20);
    expect(f.endsWith('…')).toBe(true);
  });
  it('run.end summary reports correct tallies', () => {
    const line = lineFor({
      type: 'run.end',
      seq: 9,
      t: 1,
      runId: 'r',
      passed: 3,
      failed: 1,
      skipped: 2,
      deferred: 1,
      durationMs: 12000,
      funds: 'reconciled',
      proof: 'orchestration-smoke',
    });
    expect(line).toContain(`${glyphs(true).pass} 3`);
    expect(line).toContain(`${glyphs(true).fail} 1`);
    expect(line).toContain('scenario-skipped 2');
    expect(line).toContain('funds: reconciled');
    expect(line).toContain('proof: orchestration-smoke');
  });

  it('labels fake orchestration as smoke rather than product proof', () => {
    const line = lineFor({
      type: 'run.begin',
      seq: 1,
      t: 1,
      runId: 'smoke',
      proof: 'orchestration-smoke',
      totalScenarios: 1,
    });
    expect(line).toMatch(/smoke.*not product proof/i);
  });

  it('summarizes terminal device cleanup once and renders lifecycle through the reporter', () => {
    expect(
      lineFor({
        type: 'cleanup.skipped',
        seq: 1,
        t: 1,
        count: 3,
        reason: 'simulator infrastructure unavailable',
      })
    ).toBe('    ⏭ skipped 3 device cleanup step(s) — simulator infrastructure unavailable');
    expect(
      lineFor({
        type: 'lifecycle',
        seq: 2,
        t: 2,
        message: 'created fresh ephemeral simulator',
      })
    ).toBe('  → created fresh ephemeral simulator');
  });
});
