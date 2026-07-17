import { describe, expect, it } from 'bun:test';
import { EventBus, type RunnerEvent } from './events';
import { observeStableState, runScenario, type RunDeps } from './run';
import {
  FakeDriver,
  FakeCommandRunner,
  MemoryArtifactSink,
  type FakeConfig,
} from '../drivers/driver';
import type { Fixture, Scenario } from '../schema';
import type { CounterpartyStep } from '../schema/steps';
import { Secret, secret } from './redact';
import { encode as encodeEmoji } from '../../shared/lib/third-party/emoji';

const PUBLIC_PAYMENT_REQUEST =
  'creqAp2F0gaNhdGRwb3N0YWF4G2h0dHBzOi8vZTJlLmludmFsaWQvcGF5bWVudGFn92FpeBxzb3ZyYW4tZTJlLWRlbGl2ZXJ5LXJvbGxiYWNrYWEYHmF1Y3NhdGFtgXgZaHR0cHM6Ly9taW50LnNvdnJhbi5tb25leWFkdUUyRSBkZWxpdmVyeSByb2xsYmFja2Fz9Q==';

const sc = (steps: unknown[], over: Record<string, unknown> = {}): Scenario =>
  ({
    version: 1,
    id: 't.x',
    name: 'x',
    description: 'y',
    lane: 'simulator',
    tags: [],
    requires: [],
    setup: [],
    steps,
    verify: [],
    finally: [],
    endState: 'wallet',
    ...over,
  }) as unknown as Scenario;

function harness(cfg: FakeConfig = {}, caps: string[] = []) {
  const events: RunnerEvent[] = [];
  const bus = new EventBus(
    (() => {
      let t = 0;
      return () => (t += 10);
    })()
  );
  bus.subscribe((e) => events.push(e));
  const driver = new FakeDriver(cfg);
  const artifacts = new MemoryArtifactSink();
  const deps: RunDeps = {
    driver,
    runner: new FakeCommandRunner(),
    bus,
    artifacts,
    capabilities: new Set(caps),
    finalStateTimeoutMs: 100,
    finalStatePollMs: 0,
    launchSettleTimeoutMs: 0,
    launchSettlePollMs: 0,
  };
  return { events, bus, driver, artifacts, deps };
}
const types = (evs: RunnerEvent[]) => evs.map((e) => e.type);

describe('runScenario', () => {
  it('polls a tx assert with timeoutMs until a transient status settles', async () => {
    const cfg: FakeConfig = {
      currentState: 'wallet',
      txs: { 'q-1': { direction: 'in', amount: 125, status: 'ISSUED' } },
    };
    const { deps } = harness(cfg);
    setTimeout(() => {
      cfg.txs!['q-1'] = { direction: 'in', amount: 125, status: 'finalized' };
    }, 350);
    const result = await runScenario(
      sc([
        {
          action: 'assert',
          that: 'tx',
          txRef: 'q-1',
          direction: 'in',
          amount: 125,
          status: 'finalized',
          timeoutMs: 5_000,
        },
      ]),
      new Map(),
      deps
    );
    expect(result).toBe('passed');
  });

  it('fails a tx assert immediately without timeoutMs when the status is transient', async () => {
    const { deps } = harness({
      currentState: 'wallet',
      txs: { 'q-1': { direction: 'in', amount: 125, status: 'ISSUED' } },
    });
    const result = await runScenario(
      sc([{ action: 'assert', that: 'tx', txRef: 'q-1', status: 'finalized' }]),
      new Map(),
      deps
    );
    expect(result).toBe('failed');
  });

  it('waits for AX readiness after launch before capturing the launch frame', async () => {
    const { deps, driver } = harness({
      present: { 'label:No History': { label: 'No History' } },
    });
    deps.launchSettleTimeoutMs = 5_000;
    deps.launchSettlePollMs = 1;
    // Boot sequence: transport down, then an empty tree, then real content.
    const real = driver.axSnapshot.bind(driver);
    let polls = 0;
    driver.axSnapshot = async () => {
      polls += 1;
      if (polls === 1) throw new Error('simulator evidence transport unavailable');
      if (polls === 2) return [];
      return real();
    };
    const result = await runScenario(sc([{ action: 'launch', reset: 'none' }]), new Map(), deps);
    expect(result).toBe('passed');
    // 2 boot polls + 1 readiness hit, then the evidence capture reuses the tree.
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it('does not fail the launch step when AX readiness never arrives in budget', async () => {
    const { deps, driver } = harness({ present: {} });
    deps.launchSettleTimeoutMs = 5;
    deps.launchSettlePollMs = 1;
    driver.axSnapshot = async () => [];
    const result = await runScenario(sc([{ action: 'launch', reset: 'none' }]), new Map(), deps);
    // The launch step itself passes; only the mandatory final-state proof
    // governs the scenario outcome (state stays 'wallet' via observeState).
    expect(result).toBe('passed');
  });

  it('sets a validated public payment request directly at the device clipboard boundary', async () => {
    const { deps, driver } = harness({ currentState: 'wallet' });
    const runner = deps.runner as FakeCommandRunner;
    expect(
      await runScenario(
        sc([{ action: 'setPaymentRequestClipboard', request: PUBLIC_PAYMENT_REQUEST }]),
        new Map(),
        deps
      )
    ).toBe('passed');
    expect(driver.clipboard).toBe(PUBLIC_PAYMENT_REQUEST);
    expect(driver.calls).toContain('clipboardSet');
    expect(runner.calls).toEqual([]);
  });

  it('runs a passing scenario and evidences every step (screenshot + AX)', async () => {
    const { events, driver, artifacts, deps } = harness({
      present: {
        'label:Welcome': { label: 'Welcome' },
        'label:Get Started': { label: 'Get Started', role: 'button' },
      },
    });
    const status = await runScenario(
      sc([
        { action: 'launch', reset: 'erase' },
        { action: 'waitFor', selector: { label: 'Welcome' } },
        { action: 'tap', selector: { label: 'Get Started' } },
        { action: 'assert', that: 'ax', selector: { label: 'Get Started' }, role: 'button' },
      ]),
      new Map(),
      deps
    );
    expect(status).toBe('passed');
    expect(driver.calls).toContain('launch:erase');
    expect(driver.calls).toContain('tap:label:Get Started');
    expect(types(events)).toContain('scenario.begin');
    expect(events.filter((e) => e.type === 'step.end' && e.ok).length).toBe(3);
    expect(events.filter((e) => e.type === 'assertion.end' && e.ok).length).toBe(1);
    expect(events.filter((e) => e.type === 'artifact').length).toBe(10); // 2 per step × 4 + final state
    expect(
      events
        .filter((e) => e.type === 'artifact')
        .map((e) => (e.type === 'artifact' ? e.artifactSeq : 0))
    ).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(artifacts.written.filter((w) => w.kind === 'ax').length).toBe(5);
    expect(artifacts.written.some((w) => w.rel.includes('FINAL-final-state'))).toBe(true);
    expect(events.at(-1)?.type).toBe('scenario.end');
  });

  it('keeps typed counterparty outputs secret while handing raw bytes only to the device boundary', async () => {
    const token = 'cashu' + 'B' + 'o' + 'a'.repeat(30);
    const { deps, driver } = harness({ currentState: 'wallet' });
    const calls: CounterpartyStep[] = [];
    deps.counterparty = {
      execute: async (step) => {
        calls.push(step);
        if (step.operation === 'cashu.create') return { output: secret('cashu-token', token) };
        if (step.operation !== 'cashu.redeem') throw new Error('unexpected operation');
        expect(step.token).toBeInstanceOf(Secret);
        expect((step.token as unknown as Secret).reveal()).toBe(token);
        return {};
      },
    };
    const asset = {
      mintUrl: 'https://mint.sovran.money',
      unit: 'sat',
      accountIndex: 0,
    } as const;
    const status = await runScenario(
      sc(
        [
          {
            action: 'counterparty',
            operation: 'cashu.create',
            ...asset,
            amount: 40,
            captureAs: 'token',
            setClipboard: true,
          },
          {
            action: 'counterparty',
            operation: 'cashu.redeem',
            ...asset,
            amount: 40,
            token: '${token}',
          },
        ],
        {
          lane: 'funded',
          funds: { assets: [{ ...asset, maxPrincipal: 40 }] },
        }
      ),
      new Map(),
      deps
    );
    expect(status).toBe('passed');
    expect(calls).toHaveLength(2);
    expect(driver.clipboard).toBe(token);
  });

  it('captures the asset-free npc.address output and mirrors it to the clipboard', async () => {
    const address = 'cocod@npubx.cash';
    const { deps, driver } = harness({ currentState: 'wallet' });
    deps.counterparty = {
      execute: async (step) => {
        if (step.operation !== 'npc.address') throw new Error('unexpected operation');
        return { output: secret('lightning-address', address) };
      },
    };
    const asset = {
      mintUrl: 'https://mint.sovran.money',
      unit: 'sat',
      accountIndex: 0,
    } as const;
    const status = await runScenario(
      sc(
        [
          {
            action: 'counterparty',
            operation: 'npc.address',
            captureAs: 'addr',
            setClipboard: true,
          },
        ],
        {
          lane: 'funded',
          funds: { assets: [{ ...asset, maxPrincipal: 40 }] },
        }
      ),
      new Map(),
      deps
    );
    expect(status).toBe('passed');
    expect(driver.clipboard).toBe(address);
  });

  it('proves an emoji clipboard payload decodes to the captured token without logging either value', async () => {
    const token = 'cashu' + 'B' + 'o' + 'a'.repeat(30);
    const { deps, driver } = harness({
      currentState: 'wallet',
      present: {
        'id:payment-info-token-data': { id: 'payment-info-token-data', label: token },
      },
    });
    driver.clipboard = encodeEmoji('😁', token);
    expect(
      await runScenario(
        sc([
          {
            action: 'capture',
            as: 'rawToken',
            fromSelector: { id: 'payment-info-token-data' },
            attribute: 'label',
          },
          { action: 'assert', that: 'emojiClipboardDecodesTo', variable: 'rawToken' },
        ]),
        new Map(),
        deps
      )
    ).toBe('passed');
  });

  it('emits PRECONDITION fixture provenance, TEST START, VERIFY, and CLEANUP ids', async () => {
    const fixture: Fixture = {
      version: 1,
      id: 'given.wallet.onboarded',
      params: [],
      requires: [],
      steps: [{ action: 'goHome' }],
    };
    const { events, deps } = harness({
      present: { 'label:Done': { label: 'Done' } },
      currentState: 'wallet',
    });
    const status = await runScenario(
      sc([{ action: 'tap', selector: { label: 'Go' }, optional: { reason: 'not material' } }], {
        setup: [{ use: fixture.id }],
        verify: [{ action: 'assert', that: 'visible', selector: { label: 'Done' } }],
        finally: [{ action: 'goHome' }],
      }),
      new Map([[fixture.id, fixture]]),
      deps
    );
    expect(status).toBe('passed');
    expect(events.some((e) => e.type === 'fixture.begin' && e.id === fixture.id)).toBe(true);
    expect(events.some((e) => e.type === 'phase.begin' && e.phase === 'test')).toBe(true);
    expect(events.some((e) => e.type === 'phase.begin' && e.phase === 'verify')).toBe(true);
    expect(events.some((e) => e.type === 'step.end' && e.stepId === 'P01')).toBe(true);
    expect(events.some((e) => e.type === 'assertion.end' && e.stepId === 'V01')).toBe(true);
    expect(events.some((e) => e.type === 'step.end' && e.stepId === 'C01')).toBe(true);
    expect(
      events
        .filter((e) => e.type === 'phase.begin')
        .map((e) => (e.type === 'phase.begin' ? e.phase : ''))
    ).toEqual(['precondition', 'test', 'verify', 'cleanup']);
    expect(events.some((e) => e.type === 'phase.end' && e.phase === 'verify' && e.ok)).toBe(true);
    expect(events.some((e) => e.type === 'fixture.end' && e.id === fixture.id && e.ok)).toBe(true);
  });

  it('fails closed when automatic evidence cannot be captured', async () => {
    const { events, deps } = harness({ failScreenshot: true, currentState: 'wallet' });
    expect(await runScenario(sc([{ action: 'goHome' }]), new Map(), deps)).toBe('failed');
    expect(
      events.some((e) => e.type === 'step.end' && !e.ok && e.error?.includes('evidence'))
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === 'final-state' && !e.ok && e.error?.includes('final-state evidence')
      )
    ).toBe(true);
  });

  it('enforces the observable final state', async () => {
    const { events, deps } = harness({ currentState: 'onboarding' });
    expect(await runScenario(sc([{ action: 'goHome' }]), new Map(), deps)).toBe('failed');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'final-state',
        expected: 'wallet',
        actual: 'onboarding',
        ok: false,
      })
    );
  });

  it('passes screenshot delay, mask, stability, and tolerance to the driver', async () => {
    const { driver, artifacts, deps } = harness({ currentState: 'wallet' });
    expect(
      await runScenario(
        sc([
          {
            action: 'screenshot',
            name: 'masked',
            delayMs: 10,
            mask: ['profile-avatar'],
            stable: true,
            tolerance: 0.01,
          },
        ]),
        new Map(),
        deps
      )
    ).toBe('passed');
    expect(driver.screenshotOptions).toContainEqual({
      delayMs: 10,
      mask: ['profile-avatar'],
      stable: true,
      tolerance: 0.01,
    });
    expect(artifacts.written).toHaveLength(4); // named + final-state screenshot/AX; no duplicate
  });

  it('keeps cleanup running (and visible) after a product-step failure, and fails the run', async () => {
    const { events, driver, deps } = harness({ failWaitFor: ['label:Never'] });
    const status = await runScenario(
      sc([{ action: 'waitFor', selector: { label: 'Never' } }], {
        finally: [{ action: 'goHome' }],
      }),
      new Map(),
      deps
    );
    expect(status).toBe('failed');
    expect(driver.calls).toContain('home'); // cleanup executed despite the failure
    expect(types(events)).toContain('cleanup.begin');
    const failed = events.find((e) => e.type === 'step.end' && !e.ok);
    expect(failed).toBeDefined();
    expect((failed as Extract<RunnerEvent, { type: 'step.end' }>).error).toContain('timed out');
    expect(events.find((e) => e.type === 'scenario.end' && !e.ok)).toBeDefined();
    expect(events.some((e) => e.type === 'phase.end' && !e.ok)).toBe(true);
    expect(events.some((e) => e.type === 'cleanup.end' && e.ok)).toBe(true);
  });

  it('stops device cleanup after terminal simulator loss but still reconciles host funds', async () => {
    const { events, driver, deps } = harness({ currentState: 'wallet' });
    const abort = new AbortController();
    const transportError = new Error('owned serve-sim exited unexpectedly');
    let screenshots = 0;
    driver.screenshot = async () => {
      if (screenshots++ === 0) {
        abort.abort(transportError);
        throw transportError;
      }
      throw new Error('device evidence must stop after terminal transport loss');
    };
    let sweeps = 0;
    let reconciliations = 0;
    deps.signal = abort.signal;
    deps.counterparty = {
      execute: async (step) => {
        expect(step.operation).toBe('recovery.sweep');
        sweeps++;
        return {};
      },
    };
    deps.reconcile = async () => {
      reconciliations++;
      return 'reconciled';
    };

    const status = await runScenario(
      sc([{ action: 'goHome' }], {
        lane: 'funded',
        finally: [
          {
            action: 'counterparty',
            operation: 'recovery.sweep',
            mintUrl: 'https://mint.sovran.money',
            unit: 'sat',
            accountIndex: 0,
          },
          { action: 'goHome' },
          { action: 'waitFor', selector: { label: '₿ 0' }, timeoutMs: 45000 },
        ],
      }),
      new Map(),
      deps
    );

    expect(status).toBe('failed');
    expect(sweeps).toBe(1);
    expect(reconciliations).toBe(1);
    expect(driver.calls.filter((call) => call === 'home')).toHaveLength(1);
    expect(screenshots).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'cleanup.skipped',
        count: 2,
        reason: 'simulator infrastructure unavailable',
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'final-state', ok: false, skipped: true })
    );
  });

  it('marks a failing prerequisite fixture and phase explicitly failed', async () => {
    const fixture: Fixture = {
      version: 1,
      id: 'given.missing-control',
      params: [],
      requires: [],
      steps: [{ action: 'waitFor', selector: { label: 'Missing' } }],
    };
    const { events, deps } = harness({ currentState: 'wallet' });
    const status = await runScenario(
      sc([{ action: 'goHome' }], { setup: [{ use: fixture.id }] }),
      new Map([[fixture.id, fixture]]),
      deps
    );
    expect(status).toBe('failed');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'fixture.end', id: fixture.id, ok: false })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'phase.end', phase: 'precondition', ok: false })
    );
  });

  it('defers (no device touch) when a required capability is missing', async () => {
    const { events, driver, deps } = harness({}, []);
    const status = await runScenario(
      sc([{ action: 'goHome' }], { requires: ['unit.usd'] }),
      new Map(),
      deps
    );
    expect(status).toBe('deferred');
    expect(types(events)).toEqual(['deferred']);
    expect(driver.calls).toEqual([]);
  });

  it('asserts a balance delta against the start snapshot', async () => {
    const pass = harness({ balances: { sat: 150 } });
    expect(
      await runScenario(
        sc([{ action: 'assert', that: 'balanceDelta', unit: 'sat', delta: 0 }]),
        new Map(),
        pass.deps
      )
    ).toBe('passed');
    const fail = harness({ balances: { sat: 150 } });
    expect(
      await runScenario(
        sc([{ action: 'assert', that: 'balanceDelta', unit: 'sat', delta: 100 }]),
        new Map(),
        fail.deps
      )
    ).toBe('failed');
  });

  it('emits a causal redacted event when a balance baseline cannot be read', async () => {
    const { events, driver, deps } = harness({ currentState: 'wallet' });
    const token = 'cashu' + 'B' + 'o' + 'a'.repeat(30);
    driver.balance = async () => {
      throw new Error(`baseline backend exposed ${token}`);
    };
    expect(
      await runScenario(
        sc([{ action: 'assert', that: 'balanceDelta', unit: 'sat', delta: 1 }]),
        new Map(),
        deps
      )
    ).toBe('failed');
    const failure = events.find((event) => event.type === 'baseline.failure');
    expect(failure).toMatchObject({ type: 'baseline.failure', unit: 'sat' });
    expect(failure && 'error' in failure ? failure.error : '').not.toContain(token);
  });

  it('fails on an AX mismatch', async () => {
    const { deps } = harness({ present: { 'label:Go': { label: 'Go', role: 'button' } } });
    expect(
      await runScenario(
        sc([{ action: 'assert', that: 'ax', selector: { label: 'Go' }, role: 'link' }]),
        new Map(),
        deps
      )
    ).toBe('failed');
  });

  it('skips (not fails) an explicitly optional control that is absent', async () => {
    const { events, deps } = harness({});
    const status = await runScenario(
      sc([{ action: 'tap', selector: { label: 'Maybe' }, optional: { reason: 'may not render' } }]),
      new Map(),
      deps
    );
    expect(status).toBe('passed');
    expect(types(events)).toContain('skip');
  });

  it('polls notVisible until the element disappears within its timeout', async () => {
    const present: Record<string, { label: string }> = {
      'label:Gone soon': { label: 'Gone soon' },
    };
    const { deps } = harness({ present, currentState: 'wallet' });
    setTimeout(() => delete present['label:Gone soon'], 10);
    expect(
      await runScenario(
        sc([
          {
            action: 'assert',
            that: 'notVisible',
            selector: { label: 'Gone soon' },
            timeoutMs: 100,
          },
        ]),
        new Map(),
        deps
      )
    ).toBe('passed');
  });

  it('emits each bounded tapUntil attempt', async () => {
    const { events, deps } = harness({
      present: { 'label:Done': { label: 'Done' } },
      currentState: 'wallet',
    });
    expect(
      await runScenario(
        sc([
          {
            action: 'tapUntil',
            sequence: [{ tap: { label: 'Open' } }],
            until: { label: 'Done' },
            attempts: 3,
          },
        ]),
        new Map(),
        deps
      )
    ).toBe('passed');
    expect(events).toContainEqual(expect.objectContaining({ type: 'retry', attempt: 1, max: 3 }));
  });

  it('requires a stable bounded final-state observation before passing', async () => {
    const { events, driver, artifacts, deps } = harness({
      observedStates: ['onboarding', 'wallet', 'wallet'],
    });
    deps.finalStatePollMs = 1;
    deps.finalStateTimeoutMs = 100;
    expect(await runScenario(sc([{ action: 'goHome' }]), new Map(), deps)).toBe('passed');
    expect(driver.calls.filter((call) => call === 'observeState')).toHaveLength(4);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'final-state', actual: 'wallet', ok: true })
    );
    expect(driver.screenshotOptions.at(-1)).toEqual({ stable: true });
    expect(artifacts.written.some((entry) => entry.rel.includes('FINAL-final-state'))).toBe(true);
  });

  it('writes final AX from the exact fresh observation instead of rereading a racing cache', async () => {
    const { events, driver, artifacts, deps } = harness({
      currentState: 'wallet',
      present: { 'id:wallet-send': { id: 'wallet-send' } },
    });
    driver.axSnapshot = async () => {
      throw new Error('later AX cache read must not happen');
    };
    expect(await runScenario(sc([]), new Map(), deps)).toBe('passed');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'final-state', actual: 'wallet', revision: 3, ok: true })
    );
    expect(artifacts.written.some((entry) => entry.kind === 'ax')).toBe(true);
  });

  it('fails when the fresh post-screenshot AX frame changes the final state', async () => {
    const { events, deps } = harness({
      observedStates: ['wallet', 'wallet', 'onboarding'],
      observedStateRevisions: [1, 2, 3],
    });
    expect(await runScenario(sc([]), new Map(), deps)).toBe('failed');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'final-state',
        ok: false,
        error: expect.stringMatching(/post-screenshot.*expected wallet.*onboarding/i),
      })
    );
  });

  it('captures a unique dynamic id suffix for later interpolated steps', async () => {
    const { deps } = harness({
      present: { 'id:send-token-id-tx-123': { id: 'send-token-id-tx-123' } },
    });
    const runner = new FakeCommandRunner();
    deps.runner = runner;
    expect(
      await runScenario(
        sc([
          {
            action: 'waitFor',
            selector: { idPrefix: 'send-token-id-', captureSuffixAs: 'sendTx' },
          },
          { action: 'exec', command: ['cocod', 'history', '${sendTx}'] },
        ]),
        new Map(),
        deps
      )
    ).toBe('passed');
    expect(runner.calls).toContainEqual(['cocod', 'history', 'tx-123']);
  });

  it('fails an empty dynamic-id suffix instead of capturing an unusable value', async () => {
    const { events, deps } = harness({
      present: { 'id:send-token-id-': { id: 'send-token-id-' } },
    });
    expect(
      await runScenario(
        sc([
          {
            action: 'waitFor',
            selector: { idPrefix: 'send-token-id-', captureSuffixAs: 'sendTx' },
          },
        ]),
        new Map(),
        deps
      )
    ).toBe('failed');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'step.end',
        ok: false,
        error: expect.stringMatching(/empty/),
      })
    );
  });

  it('fails the empty-before capture instead of allowing empty identity equality', async () => {
    const { events, deps } = harness({
      present: { 'id:identity-before': { id: 'identity-before' } },
    });
    expect(
      await runScenario(
        sc([
          {
            action: 'capture',
            as: 'identityBefore',
            fromSelector: { id: 'identity-before' },
            attribute: 'label',
          },
        ]),
        new Map(),
        deps
      )
    ).toBe('failed');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'step.end',
        ok: false,
        error: expect.stringMatching(/empty/),
      })
    );
  });

  it('compares a captured sensitive AX label without exposing it to events', async () => {
    const address = 'test-identity@npubx.cash';
    const { events, deps } = harness({
      currentState: 'wallet',
      present: {
        'id:payment-info-address-data': { id: 'payment-info-address-data', label: address },
      },
    });

    expect(
      await runScenario(
        sc([
          {
            action: 'capture',
            as: 'identityBefore',
            fromSelector: { id: 'payment-info-address-data' },
            attribute: 'label',
          },
          {
            action: 'assert',
            that: 'ax',
            selector: { id: 'payment-info-address-data' },
            label: '${identityBefore}',
          },
        ]),
        new Map(),
        deps
      )
    ).toBe('passed');
    expect(JSON.stringify(events)).not.toContain(address);
  });

  it('compares a captured profile name without exposing it to events', async () => {
    const profileName = 'bright-badger';
    const { events, deps } = harness({
      currentState: 'wallet',
      present: {
        'id:drawer-profile-name': { id: 'drawer-profile-name', label: profileName },
      },
    });

    expect(
      await runScenario(
        sc([
          {
            action: 'capture',
            as: 'profileNameBefore',
            fromSelector: { id: 'drawer-profile-name' },
            attribute: 'label',
          },
          {
            action: 'assert',
            that: 'ax',
            selector: { id: 'drawer-profile-name' },
            label: '${profileNameBefore}',
          },
        ]),
        new Map(),
        deps
      )
    ).toBe('passed');
    expect(JSON.stringify(events)).not.toContain(profileName);
  });

  it('fails whitespace-only clipboard and command captures', async () => {
    const clipboardHarness = harness();
    clipboardHarness.driver.clipboard = ' \n ';
    expect(
      await runScenario(
        sc([{ action: 'capture', as: 'identityAfter', fromClipboard: true }]),
        new Map(),
        clipboardHarness.deps
      )
    ).toBe('failed');

    const commandHarness = harness();
    commandHarness.deps.runner = new FakeCommandRunner({ 'cocod status': '   ' });
    expect(
      await runScenario(
        sc([{ action: 'exec', command: ['cocod', 'status'], captureAs: 'status' }]),
        new Map(),
        commandHarness.deps
      )
    ).toBe('failed');
  });

  it('reconciles before final observation and evidence, even when reconciliation fails', async () => {
    const { events, driver, artifacts, deps } = harness({ currentState: 'wallet' });
    let reconciliationAttempted = false;
    deps.reconcile = async () => {
      reconciliationAttempted = true;
      throw new Error('sweep failed');
    };
    const observeState = driver.observeState.bind(driver);
    driver.observeState = async () => {
      expect(reconciliationAttempted).toBe(true);
      return observeState();
    };
    const screenshot = driver.screenshot.bind(driver);
    driver.screenshot = async (options) => {
      expect(reconciliationAttempted).toBe(true);
      return screenshot(options);
    };

    expect(await runScenario(sc([]), new Map(), deps)).toBe('failed');
    const quarantineIndex = events.findIndex((event) => event.type === 'quarantine');
    const finalStateIndex = events.findIndex((event) => event.type === 'final-state');
    expect(quarantineIndex).toBeGreaterThanOrEqual(0);
    expect(finalStateIndex).toBeGreaterThan(quarantineIndex);
    expect(artifacts.written.some((entry) => entry.rel.includes('FINAL-final-state'))).toBe(true);
  });

  it('times out rather than accepting a stable unknown final state', async () => {
    await expect(
      observeStableState(new FakeDriver({ currentState: 'unknown' }), {
        timeoutMs: 5,
        pollMs: 1,
      })
    ).rejects.toThrow(/did not stabilize/);
  });

  it('does not stabilize by polling the same AX revision twice', async () => {
    await expect(
      observeStableState(
        new FakeDriver({
          currentState: 'wallet',
          observedStateRevisions: [7],
        }),
        { timeoutMs: 5, pollMs: 1 }
      )
    ).rejects.toThrow(/did not stabilize/);
  });

  it('cannot recover a passing outcome after initial state stabilization times out', async () => {
    const { events, deps } = harness({
      currentState: 'wallet',
      observedStateRevisions: [7],
    });
    deps.finalStateTimeoutMs = 5;
    deps.finalStatePollMs = 1;
    expect(await runScenario(sc([]), new Map(), deps)).toBe('failed');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'final-state',
        ok: false,
        error: expect.stringMatching(/did not stabilize/),
      })
    );
  });
});

describe('runScenario video recording', () => {
  const recordedScenario = () =>
    sc([{ action: 'tap', selector: { id: 'mid' } }], {
      setup: [{ action: 'launch', reset: 'none' }],
      verify: [{ action: 'waitFor', selector: { id: 'end' }, timeoutMs: 10 }],
      finally: [{ action: 'tap', selector: { id: 'cleanup' } }],
    });
  const recorderHarness = (over: Partial<{ startPath: string | null; stopOk: boolean }> = {}) => {
    const h = harness({
      currentState: 'wallet',
      present: { 'id:end': { id: 'end', label: 'end' } },
    });
    const startedWith: string[] = [];
    h.deps.video = {
      start: async (scenarioId: string) => {
        h.driver.calls.push('video:start');
        startedWith.push(scenarioId);
        return over.startPath === undefined ? `/abs/run/${scenarioId}/video.mp4` : over.startPath;
      },
      stop: async () => {
        h.driver.calls.push('video:stop');
        return over.stopOk ?? true;
      },
      dispose: async () => {},
    };
    return { ...h, startedWith };
  };
  const videoArtifacts = (events: RunnerEvent[]) =>
    events.filter((e) => e.type === 'artifact' && e.kind === 'video');

  it('brackets exactly the behavior window: after setup, before cleanup', async () => {
    const { deps, driver, events, startedWith } = recorderHarness();
    expect(await runScenario(recordedScenario(), new Map(), deps)).toBe('passed');
    expect(startedWith).toEqual(['t.x']);
    const calls = driver.calls;
    expect(calls.indexOf('video:start')).toBeGreaterThan(calls.indexOf('launch:none'));
    expect(calls.indexOf('video:start')).toBeLessThan(calls.indexOf('tap:id:mid'));
    expect(calls.indexOf('video:stop')).toBeGreaterThan(calls.indexOf('waitFor:id:end'));
    expect(calls.indexOf('video:stop')).toBeLessThan(calls.indexOf('tap:id:cleanup'));
    expect(videoArtifacts(events)).toEqual([
      expect.objectContaining({ stepId: 'VIDEO', path: '/abs/run/t.x/video.mp4' }),
    ]);
  });

  it('still stops and emits the video when a behavior step fails', async () => {
    const { deps, driver, events } = recorderHarness();
    const scenario = sc([{ action: 'waitFor', selector: { id: 'gone' }, timeoutMs: 10 }], {
      setup: [{ action: 'launch', reset: 'none' }],
      finally: [{ action: 'tap', selector: { id: 'cleanup' } }],
    });
    expect(await runScenario(scenario, new Map(), deps)).toBe('failed');
    expect(driver.calls.indexOf('video:stop')).toBeGreaterThan(driver.calls.indexOf('video:start'));
    expect(driver.calls.indexOf('video:stop')).toBeLessThan(driver.calls.indexOf('tap:id:cleanup'));
    expect(videoArtifacts(events)).toHaveLength(1);
  });

  it('never records when setup already failed', async () => {
    const { deps, driver } = recorderHarness();
    const scenario = sc([{ action: 'tap', selector: { id: 'mid' } }], {
      setup: [{ action: 'waitFor', selector: { id: 'missing' }, timeoutMs: 10 }],
    });
    expect(await runScenario(scenario, new Map(), deps)).toBe('failed');
    expect(driver.calls).not.toContain('video:start');
    expect(driver.calls).not.toContain('video:stop');
  });

  it('a recorder that cannot start degrades to no video without failing the run', async () => {
    const { deps, driver, events } = recorderHarness({ startPath: null });
    expect(await runScenario(recordedScenario(), new Map(), deps)).toBe('passed');
    expect(driver.calls).toContain('video:start');
    expect(driver.calls).not.toContain('video:stop');
    expect(videoArtifacts(events)).toHaveLength(0);
  });

  it('an unfinalized recording is dropped, not reported as an artifact', async () => {
    const { deps, events } = recorderHarness({ stopOk: false });
    expect(await runScenario(recordedScenario(), new Map(), deps)).toBe('passed');
    expect(videoArtifacts(events)).toHaveLength(0);
  });
});

describe('app-data evidence', () => {
  const appDataScenario = () =>
    sc([{ action: 'tap', selector: { id: 'mid' } }], {
      setup: [{ action: 'launch', reset: 'none' }],
    });

  const appDataHarness = (results: { store: string | null; db: string | null }[]) => {
    const base = harness({ permissive: true, currentState: 'wallet' });
    let call = 0;
    const captures: number[] = [];
    base.deps.appData = {
      capture: async () => {
        captures.push(++call);
        return results[Math.min(call - 1, results.length - 1)];
      },
    };
    return { ...base, captures };
  };

  const appDataArtifacts = (events: RunnerEvent[], kind: 'store' | 'db') =>
    events.filter((e) => e.type === 'artifact' && e.kind === kind) as Extract<
      RunnerEvent,
      { type: 'artifact' }
    >[];

  it('writes store/db sidecars beside every frame including FINAL', async () => {
    const { deps, events, artifacts } = appDataHarness([
      { store: '{"stores":{"a":1}}', db: '{"dbs":{}}' },
    ]);
    expect(await runScenario(appDataScenario(), new Map(), deps)).toBe('passed');
    const store = appDataArtifacts(events, 'store');
    const db = appDataArtifacts(events, 'db');
    // launch frame + tap frame + FINAL frame
    expect(store).toHaveLength(3);
    expect(db).toHaveLength(3);
    expect(store.map((e) => e.stepId)).toContain('FINAL');
    // identical payloads dedup to one written file per kind
    expect(artifacts.written.filter((w) => w.kind === 'store')).toHaveLength(1);
    expect(artifacts.written.filter((w) => w.kind === 'db')).toHaveLength(1);
    const uniquePaths = new Set(store.map((e) => e.path));
    expect(uniquePaths.size).toBe(1);
  });

  it('writes a new sidecar when the payload changes', async () => {
    const { deps, events, artifacts } = appDataHarness([
      { store: '{"stores":{"a":1}}', db: '{"dbs":{"n":1}}' },
      { store: '{"stores":{"a":2}}', db: '{"dbs":{"n":1}}' },
    ]);
    expect(await runScenario(appDataScenario(), new Map(), deps)).toBe('passed');
    expect(artifacts.written.filter((w) => w.kind === 'store')).toHaveLength(2);
    expect(artifacts.written.filter((w) => w.kind === 'db')).toHaveLength(1);
    expect(new Set(appDataArtifacts(events, 'store').map((e) => e.path)).size).toBe(2);
  });

  it('null capture results yield no sidecars and never fail the step', async () => {
    const { deps, events } = appDataHarness([{ store: null, db: null }]);
    expect(await runScenario(appDataScenario(), new Map(), deps)).toBe('passed');
    expect(appDataArtifacts(events, 'store')).toHaveLength(0);
    expect(appDataArtifacts(events, 'db')).toHaveLength(0);
  });

  it('a throwing capturer degrades to a lifecycle warning, step still passes', async () => {
    const base = harness({ permissive: true, currentState: 'wallet' });
    base.deps.appData = {
      capture: async () => {
        throw new Error('capturer exploded');
      },
    };
    expect(await runScenario(appDataScenario(), new Map(), base.deps)).toBe('passed');
    const warnings = base.events.filter(
      (e) => e.type === 'lifecycle' && e.message.includes('app-data capture failed')
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('absent capturer is a strict no-op', async () => {
    const { deps, events, artifacts } = harness({ permissive: true, currentState: 'wallet' });
    expect(await runScenario(appDataScenario(), new Map(), deps)).toBe('passed');
    expect(appDataArtifacts(events, 'store')).toHaveLength(0);
    expect(artifacts.written.every((w) => w.kind !== 'store' && w.kind !== 'db')).toBe(true);
  });

  it('named screenshot frames get sidecars under named/', async () => {
    // Distinct payload per frame so the named frame writes its own sidecar
    // instead of dedup-pointing at the launch frame's file.
    const { deps, events } = appDataHarness([
      { store: '{"stores":{"n":1}}', db: null },
      { store: '{"stores":{"n":2}}', db: null },
      { store: '{"stores":{"n":3}}', db: null },
    ]);
    const scenario = sc([{ action: 'screenshot', name: 'wallet-home' }], {
      setup: [{ action: 'launch', reset: 'none' }],
    });
    expect(await runScenario(scenario, new Map(), deps)).toBe('passed');
    const named = appDataArtifacts(events, 'store').filter((e) => e.path.includes('/named/'));
    expect(named).toHaveLength(1);
    expect(named[0].path).toMatch(/named\/wallet-home-\d+\.store\.json$/);
  });
});

describe('tapUntil untilValue', () => {
  const toggleScenario = () =>
    sc([
      {
        action: 'tapUntil',
        sequence: [{ tap: { id: 'toggle' } }],
        until: { id: 'toggle' },
        untilValue: '1',
        attempts: 3,
        settleMs: 400,
      },
    ]);

  it('passes once the target value appears, without extra taps', async () => {
    const cfg: FakeConfig = {
      currentState: 'wallet',
      present: { 'id:toggle': { id: 'toggle', value: '0' } },
    };
    const { deps, driver } = harness(cfg);
    // first tap lands: flip the value shortly after
    setTimeout(() => {
      cfg.present!['id:toggle'] = { id: 'toggle', value: '1' };
    }, 150);
    expect(await runScenario(toggleScenario(), new Map(), deps)).toBe('passed');
    expect(driver.calls.filter((c) => c === 'tap:id:toggle')).toHaveLength(1);
  });

  it('re-taps while the value stays wrong and fails after attempts', async () => {
    const cfg: FakeConfig = {
      currentState: 'wallet',
      present: { 'id:toggle': { id: 'toggle', value: '0' } },
    };
    const { deps, driver } = harness(cfg);
    expect(await runScenario(toggleScenario(), new Map(), deps)).toBe('failed');
    expect(driver.calls.filter((c) => c === 'tap:id:toggle')).toHaveLength(3);
  });

  it('presence alone still satisfies an until without untilValue', async () => {
    const { deps } = harness({
      currentState: 'wallet',
      present: { 'id:toggle': { id: 'toggle', value: '0' } },
    });
    const scenario = sc([
      {
        action: 'tapUntil',
        sequence: [{ tap: { id: 'toggle' } }],
        until: { id: 'toggle' },
        attempts: 2,
        settleMs: 200,
      },
    ]);
    expect(await runScenario(scenario, new Map(), deps)).toBe('passed');
  });
});

describe('tapUntil retry with a vanished selector', () => {
  it('skips the absent re-tap and passes once until appears', async () => {
    const cfg: FakeConfig = {
      currentState: 'wallet',
      present: { 'id:close': { id: 'close' } },
    };
    const { deps, driver } = harness(cfg);
    // First tap lands: the close control vanishes, the destination renders late.
    setTimeout(() => {
      delete cfg.present!['id:close'];
    }, 100);
    setTimeout(() => {
      cfg.present!['id:dest'] = { id: 'dest' };
    }, 900);
    const scenario = sc([
      {
        action: 'tapUntil',
        sequence: [{ tap: { id: 'close' } }],
        until: { id: 'dest' },
        attempts: 4,
        settleMs: 500,
      },
    ]);
    expect(await runScenario(scenario, new Map(), deps)).toBe('passed');
    expect(driver.calls.filter((c) => c === 'tap:id:close')).toHaveLength(1);
  });

  it('still fails loudly when the FIRST attempt has no selector', async () => {
    const { deps } = harness({ currentState: 'wallet', present: {} });
    const scenario = sc([
      {
        action: 'tapUntil',
        sequence: [{ tap: { id: 'missing' } }],
        until: { id: 'dest' },
        attempts: 3,
        settleMs: 100,
      },
    ]);
    expect(await runScenario(scenario, new Map(), deps)).toBe('failed');
  });
});

describe('tapUntil swipe item', () => {
  it('runs swipes inside the retry sequence', async () => {
    const cfg: FakeConfig = {
      currentState: 'wallet',
      present: { 'id:card': { id: 'card' } },
    };
    const { deps, driver } = harness(cfg);
    setTimeout(() => {
      cfg.present!['id:dest'] = { id: 'dest' };
    }, 100);
    const scenario = sc([
      {
        action: 'tapUntil',
        sequence: [{ tap: { id: 'card' } }, { swipe: { dir: 'up' } }, { swipe: { dir: 'down' } }],
        until: { id: 'dest' },
        attempts: 3,
        settleMs: 500,
      },
    ]);
    expect(await runScenario(scenario, new Map(), deps)).toBe('passed');
    expect(driver.calls).toContain('swipe:up');
    expect(driver.calls).toContain('swipe:down');
  });
});
