/**
 * The scenario planner. Pure + offline: it expands a scenario's setup fixtures
 * (params interpolated, nested `use` resolved cycle-safely), behavior steps, and
 * `finally` cleanup into a provenance-preserving semantic plan; decides ready-vs-deferred from
 * the available capability set; and reports the end state — everything `dry-run`
 * needs, with no simulator or secret involved (step labels are redacted).
 */
import type { Scenario, Fixture, Step } from '../schema';
import type { Selector } from '../schema/selectors';
import { interpolateDeep, type Vars } from './interpolate';
import { redactString } from './redact';

export type Phase = 'precondition' | 'test' | 'verify' | 'cleanup';
type Availability = 'ready' | 'deferred';

interface FixtureFrame {
  id: string;
  /** Distinguishes repeated invocations of the same fixture in one scenario. */
  invocation: number;
}

export interface PlannedStep {
  phase: Phase;
  /** Human-facing semantic id, numbered independently within each phase. */
  id: string;
  /** Global step order. Artifact captures have a separate monotonic sequence. */
  index: number;
  action: string;
  label: string;
  step: Step;
  fixturePath: FixtureFrame[];
}
interface PlannedScenario {
  id: string;
  name: string;
  lane: string;
  requires: string[];
  endState: string;
  availability: Availability;
  deferredReason?: string;
  steps: PlannedStep[];
}

const DRY_RUN_EXECUTION =
  'dry-run only — no simulator, counterparty, physical transport, or value effect is executed';

/** Human dry-run rendering is pure/testable and distinguishes semantic plan
 * readiness from actual product execution. */
export function formatDryRunPlan(plan: PlannedScenario): string {
  const status = plan.availability === 'ready' ? '✓ plan-ready' : '◌ plan-deferred';
  const lines = [`▶ ${plan.id}  [${plan.lane}]  ${status}`, `   execution: ${DRY_RUN_EXECUTION}`];
  if (plan.deferredReason) lines.push(`   ◌ ${plan.deferredReason}`);
  lines.push(`   requires: ${plan.requires.join(', ') || '—'}`);
  let phase: Phase | undefined;
  for (const step of plan.steps) {
    if (step.phase !== phase) {
      phase = step.phase;
      lines.push(`   ▸ ${phase === 'test' ? 'TEST START' : phase.toUpperCase()}`);
    }
    const fixture = step.fixturePath.length
      ? `  (${step.fixturePath.map((frame) => frame.id).join(' → ')})`
      : '';
    lines.push(`     [${step.id}] ${step.label}${fixture}`);
  }
  lines.push(`   endState: ${plan.endState}`);
  return lines.join('\n');
}

function selectorLabel(s: Selector): string {
  if ('id' in s) return `#${s.id}`;
  if ('idPrefix' in s)
    return `#${s.idPrefix}*${s.matchIndex === undefined ? '' : `[${s.matchIndex}]`}${s.captureSuffixAs ? `→${s.captureSuffixAs}` : ''}`;
  return `"${s.label}"`;
}

export function labelForStep(step: Step): string {
  switch (step.action) {
    case 'waitFor':
      return `waitFor ${selectorLabel(step.selector)}${step.state ? ` ${step.state}` : ''}${step.optional ? ' (optional)' : ''}`;
    case 'tap':
      return `tap ${selectorLabel(step.selector)}${step.optional ? ' (optional)' : ''}`;
    case 'tapAt':
      return `tapAt ${step.x},${step.y}`;
    case 'swipe':
      return `swipe ${step.dir}`;
    case 'drag':
      return `drag ${selectorLabel(step.selector)} ${step.from.x},${step.from.y}→${step.to.x},${step.to.y}`;
    case 'input':
      return `input ${selectorLabel(step.selector)} = ${redactString(step.value)}`;
    case 'typeText':
      return `typeText${step.focus ? ` @${step.focus.x},${step.focus.y}` : ''} = ${redactString(step.value)}`;
    case 'goHome':
      return 'goHome';
    case 'launch':
      return `launch ${step.reset}`;
    case 'tapUntil':
      return `tapUntil ${selectorLabel(step.until)} (≤${step.attempts})`;
    case 'delay':
      return `delay ${step.ms}ms (${step.reason})`;
    case 'exec':
      return `exec ${redactString(step.command.join(' '))}${step.captureAs ? ` → ${step.captureAs}` : ''}`;
    case 'permission':
      return `permission ${step.mode} ${step.service}`;
    case 'location':
      return `location ${step.mode}${step.mode === 'set' ? ` ${step.latitude},${step.longitude}` : ''}`;
    case 'openUrl':
      return `openUrl ${redactString(step.url)}`;
    case 'setClipboard':
      return `setClipboard ← ${redactString(step.from.join(' '))}`;
    case 'setLiteralClipboard':
      return step.text
        ? `setLiteralClipboard "${step.text}" (non-payload literal)`
        : 'setLiteralClipboard ← empty (clear)';
    case 'setPaymentRequestClipboard':
      return 'setPaymentRequestClipboard ← public NUT-18 request';
    case 'mintFaults':
      return step.rules.length
        ? `mintFaults ${step.rules.map((rule) => `${rule.id}:${rule.response.mode}`).join(', ')}`
        : 'mintFaults clear';
    case 'network':
      return step.mode === 'airplane' ? 'network airplane (real offline)' : 'network online';
    case 'counterparty':
      return 'mintUrl' in step
        ? `counterparty ${step.operation}${'amount' in step ? ` ${step.amount}` : ''} ${step.unit} @ ${redactString(step.mintUrl)}${'captureAs' in step ? ` → ${step.captureAs}` : ''}`
        : `counterparty ${step.operation}${'captureAs' in step ? ` → ${step.captureAs}` : ''}`;
    case 'capture':
      return `capture ${step.as} ← ${step.fromClipboard ? 'clipboard' : `${selectorLabel(step.fromSelector!)}.${step.attribute}`}`;
    case 'screenshot':
      return `screenshot ${step.name}${step.mask?.length ? ` (mask ${step.mask.length})` : ''}`;
    case 'assert':
      return step.that === 'balanceDelta'
        ? `assert balanceDelta ${step.delta} ${step.unit}`
        : step.that === 'tx'
          ? `assert tx ${step.txRef}`
          : step.that === 'ax'
            ? `assert ax ${selectorLabel(step.selector)}`
            : step.that === 'emojiClipboardDecodesTo'
              ? `assert emoji clipboard decodes to $${step.variable}`
              : step.that === 'mintFaultIntercepted'
                ? `assert mintFaultIntercepted ${step.ruleId} ≥${step.minCount}`
                : `assert ${step.that} ${selectorLabel(step.selector)}`;
  }
}

type PhaseItem = Step | { use: string; with?: Vars };
const isUse = (i: PhaseItem): i is { use: string; with?: Vars } =>
  !!i && typeof i === 'object' && 'use' in i;

interface ResolvedStep {
  step: Step;
  fixturePath: FixtureFrame[];
}

interface ResolveState {
  nextInvocation: number;
}

/** Resolve a phase's items into concrete steps, expanding fixtures cycle-safely. */
function resolvePhase(
  items: PhaseItem[],
  fixtures: Map<string, Fixture>,
  state: ResolveState,
  stack: string[] = [],
  fixturePath: FixtureFrame[] = []
): ResolvedStep[] {
  const out: ResolvedStep[] = [];
  for (const item of items) {
    if (!isUse(item)) {
      out.push({ step: item, fixturePath: [...fixturePath] });
      continue;
    }
    if (stack.includes(item.use))
      throw new Error(`fixture cycle at plan time: ${[...stack, item.use].join(' → ')}`);
    const fx = fixtures.get(item.use);
    if (!fx) throw new Error(`unknown fixture "${item.use}"`);
    const vars: Vars = item.with ?? {};
    for (const p of fx.params)
      if (!(p in vars)) throw new Error(`fixture "${fx.id}" missing param "${p}"`);
    const interpolated = interpolateDeep(fx.steps, vars, false) as PhaseItem[];
    const frame: FixtureFrame = { id: fx.id, invocation: state.nextInvocation++ };
    out.push(
      ...resolvePhase(interpolated, fixtures, state, [...stack, item.use], [...fixturePath, frame])
    );
  }
  return out;
}

function fixtureRequires(
  items: PhaseItem[],
  fixtures: Map<string, Fixture>,
  seen = new Set<string>()
): string[] {
  const reqs: string[] = [];
  for (const item of items) {
    if (!isUse(item) || seen.has(item.use)) continue;
    seen.add(item.use);
    const fx = fixtures.get(item.use);
    if (!fx) continue;
    reqs.push(...fx.requires, ...fixtureRequires(fx.steps as PhaseItem[], fixtures, seen));
  }
  return reqs;
}

export function effectiveRequirements(
  scenario: Scenario,
  fixtures: Map<string, Fixture>
): string[] {
  return [
    ...new Set([
      ...scenario.requires,
      ...fixtureRequires([...scenario.setup, ...scenario.finally] as PhaseItem[], fixtures),
    ]),
  ];
}

function planSteps(
  items: PhaseItem[],
  fixtures: Map<string, Fixture>,
  stack: string[] = []
): Step[] {
  const steps: Step[] = [];
  for (const item of items) {
    if (!isUse(item)) {
      steps.push(item);
      continue;
    }
    if (stack.includes(item.use)) continue;
    const fixture = fixtures.get(item.use);
    if (fixture)
      steps.push(...planSteps(fixture.steps as PhaseItem[], fixtures, [...stack, item.use]));
  }
  return steps;
}

/** cocod currently has no pinned binary/version/argv contract. Prefix-based
 * guesses about read-only subcommands are therefore not a safety boundary:
 * every cocod invocation is unsafe in simulator, physical, and default plans. */
export function unsafeCocodEffects(scenario: Scenario, fixtures: Map<string, Fixture>): string[] {
  const steps = [
    ...planSteps(scenario.setup as PhaseItem[], fixtures),
    ...scenario.steps,
    ...scenario.verify,
    ...planSteps(scenario.finally as PhaseItem[], fixtures),
  ];
  return steps.flatMap((step) => {
    const command =
      step.action === 'exec'
        ? step.command
        : step.action === 'setClipboard'
          ? step.from
          : undefined;
    if (command?.[0] !== 'cocod') return [];
    return [command.slice(0, 3).join(' ')];
  });
}

export function expandScenario(
  scenario: Scenario,
  fixtures: Map<string, Fixture>,
  opts: { capabilities: Set<string> }
): PlannedScenario {
  const requires = effectiveRequirements(scenario, fixtures);
  const missing = requires.filter((c) => !opts.capabilities.has(c));
  const physicalBlocked = scenario.lane === 'physical';
  const liveBlocked = scenario.lane === 'live';
  const laneBlocked = physicalBlocked || liveBlocked;
  const resolveState: ResolveState = { nextInvocation: 1 };

  const phases: [Phase, ResolvedStep[]][] = [
    ['precondition', resolvePhase(scenario.setup as PhaseItem[], fixtures, resolveState)],
    ['test', scenario.steps.map((step) => ({ step, fixturePath: [] }))],
    ['verify', scenario.verify.map((step) => ({ step, fixturePath: [] }))],
    ['cleanup', resolvePhase(scenario.finally as PhaseItem[], fixtures, resolveState)],
  ];
  let index = 0;
  const phaseIndex: Record<Phase, number> = { precondition: 0, test: 0, verify: 0, cleanup: 0 };
  const prefix: Record<Phase, string> = { precondition: 'P', test: 'T', verify: 'V', cleanup: 'C' };
  const steps: PlannedStep[] = [];
  for (const [phase, phaseSteps] of phases) {
    for (const resolved of phaseSteps) {
      const phaseNumber = ++phaseIndex[phase];
      steps.push({
        phase,
        id: `${prefix[phase]}${String(phaseNumber).padStart(2, '0')}`,
        index: ++index,
        action: resolved.step.action,
        label: labelForStep(resolved.step),
        step: resolved.step,
        fixturePath: resolved.fixturePath,
      });
    }
  }

  return {
    id: scenario.id,
    name: scenario.name,
    lane: scenario.lane,
    requires,
    endState: scenario.endState,
    availability: scenario.deferredReason || laneBlocked || missing.length ? 'deferred' : 'ready',
    deferredReason:
      scenario.deferredReason ??
      (physicalBlocked
        ? 'physical execution is deferred because no physical driver is implemented'
        : liveBlocked
          ? 'live execution is deferred because no isolated live-service driver is implemented'
          : missing.length
            ? `missing capability: ${missing.join(', ')}`
            : undefined),
    steps,
  };
}
