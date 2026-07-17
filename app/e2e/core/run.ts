/**
 * The run orchestrator. Given a scenario + fixtures + a Driver, it expands the
 * plan, executes every step through the driver, emits the structured event
 * stream (which the reporters consume), captures an owner-private screenshot +
 * redacted AX snapshot after EVERY step, and always runs cleanup in a `finally`
 * — even after a product-step failure — so cleanup stays visible and partial
 * cleanup can never masquerade as complete. A capability-deferred scenario is
 * reported (◌) and short-circuits without touching the device.
 */
import type { Scenario, Fixture, Step } from '../schema';
import type { CounterpartyStep } from '../schema/steps';
import { expandScenario, type PlannedStep } from './plan';
import { interpolateDeep, type Vars } from './interpolate';
import { isSecret, redactDeep, redactString, secret, type Secret, type SecretKind } from './redact';
import type { EventBus, FundsState } from './events';
import type {
  AppDataCapturer,
  Driver,
  CommandRunner,
  ArtifactSink,
  AxNode,
  ObservedState,
  StateObservation,
} from '../drivers/driver';
import { decode as decodeEmoji } from '../../shared/lib/third-party/emoji';
import type { VideoRecorder } from '../drivers/video';

export interface RunDeps {
  driver: Driver;
  runner: CommandRunner;
  bus: EventBus;
  artifacts: ArtifactSink;
  capabilities: Set<string>;
  counterparty?: CounterpartyExecutor;
  /** Optional per-scenario screen recording over the test+verify window only —
   *  setup and cleanup stay out of frame. Best-effort evidence, never a gate. */
  video?: VideoRecorder;
  now?: () => number;
  scenarioIndex?: number;
  totalScenarios?: number;
  /** Suite-owned allocator makes artifact sequence monotonic across scenarios. */
  nextArtifactSeq?: () => number;
  finalStateTimeoutMs?: number;
  finalStatePollMs?: number;
  /** Post-launch readiness budget before the launch step's evidence frame. */
  launchSettleTimeoutMs?: number;
  launchSettlePollMs?: number;
  /** Session-owned terminal infrastructure signal. Host reconciliation remains mandatory. */
  signal?: AbortSignal;
  /** Optional post-cleanup reconciliation (funded lanes). */
  reconcile?: () => Promise<FundsState>;
  /** Optional per-frame app-state capture (zustand mirror + coco db dump).
   *  Best-effort evidence — absent on the fake/offline lane, never a gate. */
  appData?: AppDataCapturer;
}

export interface CounterpartyExecutor {
  execute(step: CounterpartyStep): Promise<{ output?: Secret }>;
}
export type RunStatus = 'passed' | 'failed' | 'deferred';

const pad = (n: number) => String(n).padStart(3, '0');

type Capture = (
  subLabel: string,
  options?: Parameters<Driver['screenshot']>[0],
  named?: string
) => Promise<void>;

function capturedSecretKind(value: string, selectorId?: string): SecretKind | undefined {
  if (selectorId?.includes('payment-info-token-data') || /^cashu[AB]/.test(value)) {
    return 'cashu-token';
  }
  if (selectorId?.includes('lightning-invoice') || /^ln(?:bc|tb|bcrt)/i.test(value)) {
    return 'bolt11';
  }
  if (/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return 'lightning-address';
  if (/^(?:bc1|tb1|bcrt1)/i.test(value)) return 'onchain-address';
  if (/^nsec1/i.test(value)) return 'nsec';
  return undefined;
}

function storeRequiredCapture(
  vars: Vars,
  name: string,
  value: string | undefined,
  source: string,
  selectorId?: string
) {
  const captured = value?.trim();
  if (!captured) throw new Error(`${source} capture "${name}" was empty`);
  const kind = capturedSecretKind(captured, selectorId);
  vars[name] = kind ? secret(kind, captured) : captured;
}

export async function observeStableState(
  driver: Driver,
  opts: { timeoutMs: number; pollMs: number; consecutive?: number }
): Promise<StateObservation> {
  const deadline = Date.now() + opts.timeoutMs;
  const required = opts.consecutive ?? 2;
  let previous: StateObservation | undefined;
  let matching = 0;
  for (;;) {
    const observation = await driver.observeState();
    if (!previous || observation.revision > previous.revision) {
      if (observation.state !== 'unknown' && observation.state === previous?.state) matching++;
      else matching = observation.state === 'unknown' ? 0 : 1;
      previous = observation;
    }
    if (matching >= required) return observation;
    if (Date.now() >= deadline) throw new Error('final state did not stabilize before timeout');
    if (opts.pollMs > 0) await new Promise((resolve) => setTimeout(resolve, opts.pollMs));
    else await Promise.resolve();
  }
}

export async function runScenario(
  scenario: Scenario,
  fixtures: Map<string, Fixture>,
  deps: RunDeps
): Promise<RunStatus> {
  const now = deps.now ?? (() => Date.now());
  const plan = expandScenario(scenario, fixtures, { capabilities: deps.capabilities });

  if (plan.availability === 'deferred') {
    deps.bus.emit({
      type: 'deferred',
      scenarioId: plan.id,
      capability: 'requires',
      reason: plan.deferredReason!,
    });
    return 'deferred';
  }

  const scenStart = now();
  deps.bus.emit({
    type: 'scenario.begin',
    id: plan.id,
    name: plan.name,
    lane: plan.lane,
    index: deps.scenarioIndex ?? 1,
    total: deps.totalScenarios ?? 1,
  });

  const vars: Vars = { __scenario: plan.id };
  const startBalances: Record<string, number> = {};
  // Units whose delta is asserted — their baseline is snapshotted at the
  // setup→behavior boundary (empty wallet exists, before the tested flow runs).
  const balanceUnits = new Set(
    plan.steps.flatMap((s) =>
      s.step.action === 'assert' && s.step.that === 'balanceDelta' ? [s.step.unit] : []
    )
  );

  const preconditions = plan.steps.filter((s) => s.phase === 'precondition');
  const behavior = plan.steps.filter((s) => s.phase === 'test' || s.phase === 'verify');
  const cleanup = plan.steps.filter((s) => s.phase === 'cleanup');
  let failed = false;
  let artifactSeq = 0;
  const nextArtifactSeq = deps.nextArtifactSeq ?? (() => ++artifactSeq);

  // Per-scenario memory of the last written app-data sidecars: an unchanged
  // snapshot re-emits the previous artifact path instead of a duplicate file.
  const lastAppData: LastAppData = {};

  const captureFor =
    (ps: PlannedStep, enabled = true): Capture =>
    async (subLabel, options, named) => {
      if (!enabled) return;
      const seq = nextArtifactSeq();
      const base = named
        ? `${plan.id}/named/${named}-${pad(seq)}`
        : `${plan.id}/${pad(seq)}-${ps.id}-${subLabel}`;
      await captureEvidence(deps, base, ps.id, seq, options, lastAppData);
    };

  const executeSteps = async (
    steps: PlannedStep[],
    stopOnFailure: boolean,
    captureEnabled = true
  ): Promise<boolean> => {
    let ok = true;
    let phase: PlannedStep['phase'] | undefined;
    let phaseStart = now();
    let phaseOk = true;
    let activeFixtures: PlannedStep['fixturePath'] = [];
    const fixtureStarts = new Map<number, number>();
    const fixtureOutcomes = new Map<number, boolean>();

    const closeFixturesFrom = (index: number) => {
      for (let i = activeFixtures.length - 1; i >= index; i--) {
        const fixture = activeFixtures[i];
        deps.bus.emit({
          type: 'fixture.end',
          id: fixture.id,
          invocation: fixture.invocation,
          ok: fixtureOutcomes.get(fixture.invocation) ?? true,
          durationMs: now() - (fixtureStarts.get(fixture.invocation) ?? now()),
        });
        fixtureStarts.delete(fixture.invocation);
        fixtureOutcomes.delete(fixture.invocation);
      }
      activeFixtures = activeFixtures.slice(0, index);
    };

    const transitionFixtures = (next: PlannedStep['fixturePath']) => {
      let common = 0;
      while (
        common < activeFixtures.length &&
        common < next.length &&
        activeFixtures[common].invocation === next[common].invocation
      ) {
        common++;
      }
      closeFixturesFrom(common);
      for (let i = common; i < next.length; i++) {
        const fixture = next[i];
        fixtureStarts.set(fixture.invocation, now());
        fixtureOutcomes.set(fixture.invocation, true);
        deps.bus.emit({ type: 'fixture.begin', id: fixture.id, invocation: fixture.invocation });
        activeFixtures.push(fixture);
      }
    };

    const closePhase = () => {
      closeFixturesFrom(0);
      if (phase)
        deps.bus.emit({ type: 'phase.end', phase, ok: phaseOk, durationMs: now() - phaseStart });
      phase = undefined;
    };

    try {
      for (const ps of steps) {
        if (ps.phase !== phase) {
          closePhase();
          phase = ps.phase;
          phaseStart = now();
          phaseOk = true;
          deps.bus.emit({ type: 'phase.begin', phase });
        }
        transitionFixtures(ps.fixturePath);
        const stepOk = await execStep(
          ps,
          deps,
          vars,
          startBalances,
          now,
          captureFor(ps, captureEnabled)
        );
        if (!stepOk) {
          ok = false;
          phaseOk = false;
          for (const fixture of ps.fixturePath) fixtureOutcomes.set(fixture.invocation, false);
          if (stopOnFailure) break;
        }
      }
    } finally {
      closePhase();
    }
    return ok;
  };

  let videoPath: string | null = null;
  try {
    if (!(await executeSteps(preconditions, true))) failed = true;
    if (!failed) {
      for (const unit of balanceUnits) {
        try {
          startBalances[unit] = await deps.driver.balance(unit);
        } catch (error) {
          failed = true;
          deps.bus.emit({
            type: 'baseline.failure',
            unit,
            error: redactString(error instanceof Error ? error.message : String(error)),
          });
          break;
        }
      }
    }
    // Recording brackets exactly the behavior window: the first and last video
    // frames match the scenario's first and last authored screenshots.
    if (!failed && deps.video) videoPath = await deps.video.start(plan.id);
    if (!failed && !(await executeSteps(behavior, true))) failed = true;
  } catch {
    failed = true;
  } finally {
    if (videoPath && deps.video) {
      if (await deps.video.stop()) {
        deps.bus.emit({
          type: 'artifact',
          artifactSeq: nextArtifactSeq(),
          stepId: 'VIDEO',
          kind: 'video',
          path: videoPath,
        });
      }
    }
    if (cleanup.length) {
      deps.bus.emit({ type: 'cleanup.begin' });
      const cStart = now();
      const infrastructureUnavailable = deps.signal?.aborted === true;
      const runnableCleanup = infrastructureUnavailable
        ? cleanup.filter(
            ({ step }) => step.action === 'counterparty' && step.operation === 'recovery.sweep'
          )
        : cleanup;
      const skippedCleanup = cleanup.length - runnableCleanup.length;
      if (skippedCleanup > 0) {
        deps.bus.emit({
          type: 'cleanup.skipped',
          count: skippedCleanup,
          reason: 'simulator infrastructure unavailable',
        });
      }
      const cleanupOk = await executeSteps(runnableCleanup, false, !infrastructureUnavailable);
      deps.bus.emit({ type: 'cleanup.end', ok: cleanupOk, durationMs: now() - cStart });
      if (!cleanupOk) failed = true; // failed cleanup fails the run
    }

    if (deps.reconcile) {
      deps.bus.emit({ type: 'reconciliation.begin' });
      let state: FundsState = 'n/a';
      try {
        state = await deps.reconcile();
      } catch (e) {
        state = 'quarantined';
        deps.bus.emit({
          type: 'quarantine',
          runId: plan.id,
          reason: redactString((e as Error).message),
        });
        failed = true;
      }
      deps.bus.emit({ type: 'reconciliation.end', ok: state === 'reconciled', state });
      if (state !== 'reconciled') failed = true;
    }

    if (deps.signal?.aborted) {
      deps.bus.emit({
        type: 'final-state',
        expected: plan.endState,
        actual: 'unknown',
        ok: false,
        skipped: true,
        error: 'simulator infrastructure unavailable',
      });
      failed = true;
    } else {
      // Final proof comes after every wallet-mutating cleanup/reconciliation
      // attempt. Even quarantine/failure still settles, observes, and captures the
      // resulting product state so an earlier screenshot cannot masquerade as the
      // post-sweep wallet/history state.
      let finalObservation: StateObservation | undefined;
      let actualState: ObservedState = 'unknown';
      let finalStateError: string | undefined;
      try {
        finalObservation = await observeStableState(deps.driver, {
          timeoutMs: deps.finalStateTimeoutMs ?? 3000,
          pollMs: deps.finalStatePollMs ?? 100,
        });
        actualState = finalObservation.state;
      } catch (error) {
        actualState = 'unknown';
        finalStateError = redactString((error as Error).message);
      }
      let finalEvidenceOk = true;
      try {
        const seq = nextArtifactSeq();
        const postScreenshotObservation = await captureFinalEvidence(
          deps,
          `${plan.id}/${pad(seq)}-FINAL-final-state`,
          seq,
          finalObservation,
          plan.endState as ObservedState,
          {
            timeoutMs: deps.finalStateTimeoutMs ?? 3000,
            pollMs: deps.finalStatePollMs ?? 100,
          },
          lastAppData
        );
        finalObservation = postScreenshotObservation;
        actualState = postScreenshotObservation.state;
      } catch (error) {
        finalEvidenceOk = false;
        const message = `final-state evidence failed: ${redactString((error as Error).message)}`;
        finalStateError = finalStateError ? `${finalStateError}; ${message}` : message;
      }
      const finalStateOk = !finalStateError && actualState === plan.endState && finalEvidenceOk;
      deps.bus.emit({
        type: 'final-state',
        expected: plan.endState,
        actual: actualState,
        revision: finalObservation?.revision,
        ok: finalStateOk,
        error: finalStateError,
      });
      if (!finalStateOk) failed = true;
    }
  }

  deps.bus.emit({ type: 'scenario.end', id: plan.id, ok: !failed, durationMs: now() - scenStart });
  return failed ? 'failed' : 'passed';
}

async function execStep(
  ps: PlannedStep,
  deps: RunDeps,
  vars: Vars,
  startBalances: Record<string, number>,
  now: () => number,
  evidence: Capture
): Promise<boolean> {
  const assertion = ps.step.action === 'assert';
  if (assertion)
    deps.bus.emit({ type: 'assertion.begin', index: ps.index, stepId: ps.id, label: ps.label });
  else
    deps.bus.emit({
      type: 'step.begin',
      index: ps.index,
      stepId: ps.id,
      kind: ps.action,
      label: ps.label,
    });
  const t0 = now();
  let ok = true;
  let error: string | undefined;
  try {
    const outcome = await dispatch(
      interpolateDeep(ps.step, vars),
      deps,
      vars,
      startBalances,
      evidence,
      ps.index
    );
    if (outcome === 'skipped') {
      const reason = 'optional' in ps.step ? ps.step.optional?.reason : undefined;
      deps.bus.emit({ type: 'skip', index: ps.index, reason: reason ?? 'optional control absent' });
    }
  } catch (e) {
    ok = false;
    error = redactString((e as Error).message);
  }

  // A screenshot step already captured named screenshot + AX evidence with its
  // declared options. Never follow it with duplicate automatic evidence.
  if (ps.step.action !== 'screenshot') {
    try {
      await evidence(ps.action);
    } catch (e) {
      ok = false;
      const evidenceError = `evidence capture failed: ${redactString((e as Error).message)}`;
      error = error ? `${error}; ${evidenceError}` : evidenceError;
    }
  }

  if (assertion) {
    deps.bus.emit({
      type: 'assertion.end',
      index: ps.index,
      stepId: ps.id,
      label: ps.label,
      ok,
      durationMs: now() - t0,
      error,
    });
  } else {
    deps.bus.emit({
      type: 'step.end',
      index: ps.index,
      stepId: ps.id,
      kind: ps.action,
      label: ps.label,
      ok,
      durationMs: now() - t0,
      error,
    });
  }
  return ok;
}

/**
 * Owner-private bitmap + redacted AX snapshot for one point in a step. Called
 * after every step AND after every `tapUntil` sub-action, so nested heroui menu / FWO-sheet
 * taps each leave evidence. Any missing evidence fails the owning step.
 */
/**
 * A (re)launch returns before the JS runtime is ready: the bundle may still be
 * downloading and a transient dev RedBox can occupy the screen, so evidence
 * taken immediately photographs boot noise instead of the app. Wait until the
 * AX tree answers with content (the transport itself is down mid-boot, hence
 * the catch). Timing out is NOT a failure — the next step's waitFor owns real
 * readiness; this only keeps the launch frame honest.
 */
async function settleAfterLaunch(
  driver: Driver,
  timeoutMs: number,
  pollMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const nodes = await driver.axSnapshot();
      if (nodes.length > 0) return;
    } catch {
      // AX transport not up yet — keep polling until the deadline.
    }
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

type LastAppData = Partial<Record<'store' | 'db', { json: string; path: string }>>;

/**
 * Best-effort app-data sidecars (zustand mirror + coco db dump) beside a
 * frame's screenshot/AX pair. Unlike screenshot/AX evidence this can NEVER
 * fail the owning step — any problem degrades to a lifecycle warning and a
 * missing sidecar. Payloads are written raw (no redaction) by policy: run
 * dirs are local-only and hold test-wallet material.
 */
async function captureAppDataEvidence(
  deps: RunDeps,
  base: string,
  stepId: string,
  artifactSeq: number,
  last: LastAppData
): Promise<void> {
  if (!deps.appData) return;
  try {
    const result = await deps.appData.capture();
    for (const kind of ['store', 'db'] as const) {
      const json = result[kind];
      if (!json) continue;
      const prev = last[kind];
      if (prev && prev.json === json) {
        deps.bus.emit({ type: 'artifact', artifactSeq, stepId, kind, path: prev.path });
        continue;
      }
      const path = deps.artifacts.write(`${base}.${kind}.json`, kind, json);
      last[kind] = { json, path };
      deps.bus.emit({ type: 'artifact', artifactSeq, stepId, kind, path });
    }
  } catch (error) {
    deps.bus.emit({
      type: 'lifecycle',
      message: `app-data capture failed: ${redactString((error as Error).message)}`,
    });
  }
}

async function captureEvidence(
  deps: RunDeps,
  base: string,
  stepId: string,
  artifactSeq: number,
  options?: Parameters<Driver['screenshot']>[0],
  lastAppData?: LastAppData
): Promise<void> {
  const screenshot = await deps.driver.screenshot(options);
  const axSnapshot = JSON.stringify(redactDeep(await deps.driver.axSnapshot()));
  const shotPath = deps.artifacts.write(`${base}.png`, 'screenshot', screenshot);
  const axPath = deps.artifacts.write(`${base}.ax.json`, 'ax', axSnapshot);
  deps.bus.emit({ type: 'artifact', artifactSeq, stepId, kind: 'screenshot', path: shotPath });
  deps.bus.emit({ type: 'artifact', artifactSeq, stepId, kind: 'ax', path: axPath });
  if (lastAppData) await captureAppDataEvidence(deps, base, stepId, artifactSeq, lastAppData);
}

async function captureFinalEvidence(
  deps: RunDeps,
  base: string,
  artifactSeq: number,
  beforeScreenshot: StateObservation | undefined,
  expectedState: ObservedState,
  opts: { timeoutMs: number; pollMs: number },
  lastAppData?: LastAppData
): Promise<StateObservation> {
  const screenshot = await deps.driver.screenshot({ stable: true });
  const deadline = Date.now() + opts.timeoutMs;
  let observation: StateObservation;
  for (;;) {
    observation = await deps.driver.observeState();
    if (!beforeScreenshot || observation.revision > beforeScreenshot.revision) break;
    if (Date.now() >= deadline)
      throw new Error('no fresh accessibility revision after stable final screenshot');
    if (opts.pollMs > 0) await new Promise((resolve) => setTimeout(resolve, opts.pollMs));
    else await Promise.resolve();
  }
  if (observation.state !== expectedState) {
    throw new Error(
      `post-screenshot final state changed: expected ${expectedState}, got ${observation.state}`
    );
  }

  const axSnapshot = JSON.stringify(
    redactDeep({ revision: observation.revision, nodes: observation.ax })
  );
  const shotPath = deps.artifacts.write(`${base}.png`, 'screenshot', screenshot);
  const axPath = deps.artifacts.write(`${base}.ax.json`, 'ax', axSnapshot);
  deps.bus.emit({
    type: 'artifact',
    artifactSeq,
    stepId: 'FINAL',
    kind: 'screenshot',
    path: shotPath,
  });
  deps.bus.emit({ type: 'artifact', artifactSeq, stepId: 'FINAL', kind: 'ax', path: axPath });
  if (lastAppData) await captureAppDataEvidence(deps, base, 'FINAL', artifactSeq, lastAppData);
  return observation;
}

async function dispatch(
  step: Step,
  deps: RunDeps,
  vars: Vars,
  startBalances: Record<string, number>,
  evidence: Capture,
  stepIndex: number
): Promise<'ok' | 'skipped'> {
  const d = deps.driver;
  switch (step.action) {
    case 'launch':
      await d.launch(step.reset);
      await settleAfterLaunch(
        d,
        deps.launchSettleTimeoutMs ?? 15_000,
        deps.launchSettlePollMs ?? 250
      );
      return 'ok';
    case 'goHome':
      await d.home();
      return 'ok';
    case 'waitFor':
      if (step.optional && !(await d.find(step.selector))) return 'skipped';
      {
        const node = await d.waitFor(step.selector, step.state, step.timeoutMs ?? 30000);
        if ('idPrefix' in step.selector && step.selector.captureSuffixAs) {
          const id = node.id;
          if (!id?.startsWith(step.selector.idPrefix))
            throw new Error(
              `prefix capture matched a node without expected id prefix "${step.selector.idPrefix}"`
            );
          const suffix = id.slice(step.selector.idPrefix.length);
          if (!suffix.trim())
            throw new Error(`empty id suffix for prefix capture "${step.selector.idPrefix}"`);
          vars[step.selector.captureSuffixAs] = suffix.trim();
        }
      }
      return 'ok';
    case 'tap':
      if (step.optional && !(await d.find(step.selector))) return 'skipped';
      await d.tap(step.selector);
      return 'ok';
    case 'tapAt':
      await d.tapAt(step.x, step.y);
      return 'ok';
    case 'swipe':
      await d.swipe(step.dir);
      return 'ok';
    case 'drag':
      await d.drag(step.selector, step.from, step.to, step.durationMs);
      return 'ok';
    case 'input':
      await d.input(
        step.selector,
        isSecret(step.value as unknown) ? (step.value as unknown as Secret).reveal() : step.value
      );
      return 'ok';
    case 'delay':
      await new Promise((r) => setTimeout(r, step.ms));
      return 'ok';
    case 'tapUntil': {
      for (let attempt = 0; attempt < step.attempts; attempt++) {
        deps.bus.emit({
          type: 'retry',
          index: stepIndex,
          attempt: attempt + 1,
          max: step.attempts,
        });
        let sub = 0;
        for (const item of step.sequence) {
          if ('tap' in item) await d.tap(item.tap);
          else if ('tapAt' in item) await d.tapAt(item.tapAt.x, item.tapAt.y);
          else await new Promise((r) => setTimeout(r, item.delayMs));
          // Evidence after each sub-action so nested menu/sheet taps are captured.
          await evidence(`tapUntil-a${attempt}-s${sub++}`);
        }
        // Poll for the target within settleMs before re-running the sequence, so
        // a slow-rendering screen (a mint quote invoice) is awaited, not re-tapped.
        const settleDeadline = Date.now() + (step.settleMs ?? 2000);
        while (Date.now() < settleDeadline) {
          if (await d.find(step.until)) return 'ok';
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      throw new Error(`tapUntil: target never appeared after ${step.attempts} attempts`);
    }
    case 'exec': {
      const res = await deps.runner.run(step.command, step.timeoutMs ?? 60000);
      if (res.code !== 0) throw new Error(`command failed (${res.code}): ${step.command[0]} …`);
      if (step.captureAs) storeRequiredCapture(vars, step.captureAs, res.stdout, 'command output');
      return 'ok';
    }
    case 'setClipboard': {
      const res = await deps.runner.run(step.from, step.timeoutMs ?? 60000);
      if (res.code !== 0) throw new Error(`clipboard command failed (${res.code})`);
      await d.clipboardSet(res.stdout.trim());
      return 'ok';
    }
    case 'setPaymentRequestClipboard':
      await d.clipboardSet(step.request);
      return 'ok';
    case 'counterparty': {
      if (!deps.counterparty) throw new Error('typed counterparty runtime is not configured');
      const result = await deps.counterparty.execute(step);
      if ('captureAs' in step) {
        if (!result.output || !isSecret(result.output)) {
          throw new Error(`${step.operation} did not return its required secret output`);
        }
        vars[step.captureAs] = result.output;
      } else if (result.output) {
        throw new Error(`${step.operation} returned an unexpected output`);
      }
      if ('setClipboard' in step && step.setClipboard) {
        if (!result.output) throw new Error(`${step.operation} has no output for clipboard`);
        await d.clipboardSet(result.output.reveal());
      }
      return 'ok';
    }
    case 'capture': {
      if (step.fromClipboard) {
        storeRequiredCapture(vars, step.as, await d.clipboardGet(), 'clipboard');
        return 'ok';
      }
      const node = await d.find(step.fromSelector!);
      if (!node) throw new Error(`capture failed — selector not found`);
      storeRequiredCapture(
        vars,
        step.as,
        node[step.attribute],
        `AX ${step.attribute}`,
        'id' in step.fromSelector! ? step.fromSelector.id : undefined
      );
      return 'ok';
    }
    case 'screenshot':
      await evidence(
        `named-${step.name}`,
        { delayMs: step.delayMs, mask: step.mask, stable: step.stable, tolerance: step.tolerance },
        step.name
      );
      return 'ok';
    case 'assert':
      return assertStep(step, d, startBalances, vars);
  }
}

async function assertStep(
  step: Extract<Step, { action: 'assert' }>,
  d: Driver,
  startBalances: Record<string, number>,
  vars: Vars
): Promise<'ok'> {
  switch (step.that) {
    case 'visible':
    case 'notVisible': {
      const deadline = Date.now() + (step.timeoutMs ?? 0);
      for (;;) {
        const node = await d.find(step.selector);
        if (step.that === 'visible' && node) return 'ok';
        if (step.that === 'notVisible' && !node) return 'ok';
        if (Date.now() >= deadline) {
          throw new Error(
            step.that === 'visible'
              ? 'expected visible, not found'
              : 'expected not visible, but present'
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    case 'ax': {
      const node = await d.find(step.selector);
      if (!node) throw new Error('assert ax: element not found');
      matchAx(step, node);
      return 'ok';
    }
    case 'balanceDelta': {
      const cur = await d.balance(step.unit);
      const actual = cur - (startBalances[step.unit] ?? 0);
      const env = step.feeEnvelopeSats ?? 0;
      if (Math.abs(actual - step.delta) > env)
        throw new Error(`balanceDelta ${step.unit}: expected ${step.delta}±${env}, got ${actual}`);
      return 'ok';
    }
    case 'tx': {
      const checkOnce = async (): Promise<void> => {
        const tx = await d.transaction(step.txRef);
        if (!tx) throw new Error(`assert tx: no transaction "${step.txRef}"`);
        const fields = {
          direction: step.direction,
          amount: step.amount,
          unit: step.unit,
          mintHost: step.mintHost,
          status: step.status,
          source: step.source,
        };
        for (const [k, v] of Object.entries(fields)) {
          if (v !== undefined && tx[k] !== v)
            throw new Error(`assert tx.${k}: expected ${v}, got ${tx[k]}`);
        }
      };
      // With timeoutMs, poll: transient op states (ISSUED right after a mint
      // quote pays) settle into their terminal value moments later.
      const deadline = Date.now() + (step.timeoutMs ?? 0);
      for (;;) {
        try {
          await checkOnce();
          return 'ok';
        } catch (error) {
          if (Date.now() >= deadline) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    case 'emojiClipboardDecodesTo': {
      const expected = vars[step.variable];
      if (expected === undefined) {
        throw new Error(`emoji assertion references unknown capture "${step.variable}"`);
      }
      const expectedRaw = isSecret(expected) ? expected.reveal() : String(expected);
      const decoded = decodeEmoji(await d.clipboardGet());
      if (decoded !== expectedRaw) {
        throw new Error('emoji clipboard did not decode to the captured payment value');
      }
      return 'ok';
    }
  }
}

function matchAx(step: Extract<Step, { action: 'assert'; that: 'ax' }>, node: AxNode) {
  if (step.role !== undefined && node.role !== step.role)
    throw new Error(`assert ax.role: expected ${step.role}, got ${node.role}`);
  // Exact interpolation intentionally preserves Secret wrappers. Reveal only
  // for this in-memory equality check; errors and events remain value-free.
  const expectedLabel = isSecret(step.label) ? step.label.reveal() : step.label;
  const expectedValue = isSecret(step.value) ? step.value.reveal() : step.value;
  if (expectedLabel !== undefined && node.label !== expectedLabel)
    throw new Error(`assert ax.label mismatch`);
  if (expectedValue !== undefined && node.value !== expectedValue)
    throw new Error(`assert ax.value mismatch`);
  if (step.state)
    for (const [k, v] of Object.entries(step.state))
      if (node.state?.[k] !== v) throw new Error(`assert ax.state.${k}: expected ${v}`);
}
