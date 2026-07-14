import { describe, expect, it } from 'bun:test';
import { interpolate, interpolateDeep } from './interpolate';
import { expandScenario, formatDryRunPlan, unsafeCocodEffects } from './plan';
import type { Scenario, Fixture } from '../schema';

const CASHU = 'cashu' + 'B' + 'o' + 'a'.repeat(30);
const PUBLIC_PAYMENT_REQUEST =
  'creqAp2F0gaNhdGRwb3N0YWF4G2h0dHBzOi8vZTJlLmludmFsaWQvcGF5bWVudGFn92FpeBxzb3ZyYW4tZTJlLWRlbGl2ZXJ5LXJvbGxiYWNrYWEYHmF1Y3NhdGFtgXgZaHR0cHM6Ly9taW50LnNvdnJhbi5tb25leWFkdUUyRSBkZWxpdmVyeSByb2xsYmFja2Fz9Q==';

const sc = (over: Partial<Scenario> = {}): Scenario =>
  ({
    version: 1,
    id: 'onboarding.fresh',
    name: 'Fresh onboarding',
    description: 'x',
    lane: 'simulator',
    tags: ['onboarding'],
    requires: ['fresh-install'],
    setup: [{ use: 'flow.fresh-install' }],
    steps: [
      { action: 'waitFor', selector: { label: 'Welcome to Sovran' } },
      { action: 'screenshot', name: 'welcome' },
    ],
    verify: [],
    finally: [],
    endState: 'wallet',
    ...over,
  }) as unknown as Scenario;

const fresh: Fixture = {
  version: 1,
  id: 'flow.fresh-install',
  params: [],
  requires: ['fresh-install'],
  steps: [{ action: 'goHome' }],
} as unknown as Fixture;
const fund: Fixture = {
  version: 1,
  id: 'flow.fund',
  params: ['amount'],
  requires: ['cocod.receive.bolt11'],
  steps: [{ action: 'exec', command: ['cocod', 'receive', 'bolt11', '${amount}'] }],
} as unknown as Fixture;
const reg = new Map<string, Fixture>([
  [fresh.id, fresh],
  [fund.id, fund],
]);

describe('interpolate', () => {
  it('substitutes params and fails closed on unknowns', () => {
    expect(interpolate('amount ${n}', { n: 40 })).toBe('amount 40');
    expect(() => interpolate('${x}', {})).toThrow(/unknown parameter/);
  });
  it('preserves the type of an exact fixture parameter reference', () => {
    expect(interpolateDeep<unknown>('${amount}', { amount: 40 })).toBe(40);
    expect(interpolateDeep('amount-${amount}', { amount: 40 })).toBe('amount-40');
  });
});

describe('expandScenario', () => {
  it('preserves fixture provenance and assigns semantic phase ids', () => {
    const p = expandScenario(sc(), reg, { capabilities: new Set(['fresh-install']) });
    expect(p.availability).toBe('ready');
    expect(p.steps[0]).toMatchObject({
      phase: 'precondition',
      id: 'P01',
      index: 1,
      action: 'goHome',
    });
    expect(p.steps[0].fixturePath.map((f) => f.id)).toEqual(['flow.fresh-install']);
    expect(p.steps.find((s) => s.action === 'screenshot')).toMatchObject({
      phase: 'test',
      id: 'T02',
    });
    expect(p.steps.map((s) => s.index)).toEqual([1, 2, 3]); // sequential across phases
    expect(p.steps.map((s) => s.id)).toEqual(['P01', 'T01', 'T02']);
    expect(p.endState).toBe('wallet');
  });

  it('keeps product actions in TEST and enters VERIFY only through the authored section', () => {
    const p = expandScenario(
      sc({
        steps: [
          { action: 'tap', selector: { label: 'Go' } },
          { action: 'assert', that: 'visible', selector: { label: 'Done' } },
          { action: 'goHome' },
        ] as never,
        verify: [
          { action: 'assert', that: 'visible', selector: { label: 'Final wallet' } },
        ] as never,
      }),
      reg,
      { capabilities: new Set(['fresh-install']) }
    );
    expect(p.steps.map((s) => [s.phase, s.id])).toEqual([
      ['precondition', 'P01'],
      ['test', 'T01'],
      ['test', 'T02'],
      ['test', 'T03'],
      ['verify', 'V01'],
    ]);
    const dryRun = formatDryRunPlan(p);
    expect(dryRun).toContain('✓ plan-ready');
    expect(dryRun).toContain('execution: dry-run only');
    expect(dryRun.indexOf('[T03] goHome')).toBeLessThan(dryRun.indexOf('▸ VERIFY'));
    expect(dryRun).not.toMatch(/✓ ready\b/);
  });

  it('forces an authored deferredReason to defer without touching capabilities', () => {
    const p = expandScenario(sc({ deferredReason: 'needs a controlled mint fixture' }), reg, {
      capabilities: new Set(['fresh-install']),
    });
    expect(p.availability).toBe('deferred');
    expect(p.deferredReason).toBe('needs a controlled mint fixture');
  });

  it('allows funded plans when capabilities exist and keeps live plans deferred', () => {
    const p = expandScenario(sc({ lane: 'funded', funds: { assets: [] } }), reg, {
      capabilities: new Set(['fresh-install']),
    });
    expect(p.availability).toBe('ready');
    const live = expandScenario(sc({ lane: 'live' }), reg, {
      capabilities: new Set(['fresh-install']),
    });
    expect(live.availability).toBe('deferred');
    expect(live.deferredReason).toContain('live execution is deferred');
  });

  it('visibly defers every physical-lane plan', () => {
    const p = expandScenario(sc({ lane: 'physical' }), reg, {
      capabilities: new Set(['fresh-install']),
    });
    expect(p.availability).toBe('deferred');
    expect(p.deferredReason).toMatch(/physical execution.*disabled|physical.*deferred/i);
  });

  it('preserves dynamic-id suffix capture in the authored plan', () => {
    const p = expandScenario(
      sc({
        steps: [
          {
            action: 'waitFor',
            selector: { idPrefix: 'send-token-id-', captureSuffixAs: 'sendTx' },
          },
        ],
      }),
      reg,
      { capabilities: new Set(['fresh-install']) }
    );
    expect(p.steps.at(-1)?.label).toContain('#send-token-id-*→sendTx');
  });

  it('defers when a required capability (from the scenario or a fixture) is unavailable', () => {
    const usd = sc({ id: 'x.usd', requires: ['unit.usd'] });
    const p = expandScenario(usd, reg, { capabilities: new Set(['fresh-install']) });
    expect(p.availability).toBe('deferred');
    expect(p.deferredReason).toContain('unit.usd');
    expect(
      expandScenario(usd, reg, { capabilities: new Set(['fresh-install', 'unit.usd']) })
        .availability
    ).toBe('ready');
  });

  it('bubbles fixture requires up into the capability decision', () => {
    const s = sc({
      id: 's.fund',
      requires: [],
      setup: [{ use: 'flow.fund', with: { amount: 40 } }] as never,
    });
    expect(expandScenario(s, reg, { capabilities: new Set() }).availability).toBe('deferred');
    expect(
      expandScenario(s, reg, { capabilities: new Set(['cocod.receive.bolt11']) }).availability
    ).toBe('ready');
  });

  it('interpolates fixture params into the plan', () => {
    const s = sc({
      id: 's.fund2',
      requires: ['cocod.receive.bolt11'],
      setup: [{ use: 'flow.fund', with: { amount: 40 } }] as never,
    });
    const execStep = expandScenario(s, reg, {
      capabilities: new Set(['cocod.receive.bolt11']),
    }).steps.find((x) => x.action === 'exec');
    expect(execStep?.label).toContain('40');
  });

  it('throws on a missing fixture param', () => {
    const s = sc({ id: 's.bad', setup: [{ use: 'flow.fund' }] as never });
    expect(() => expandScenario(s, reg, { capabilities: new Set() })).toThrow(/missing param/);
  });

  it('redacts secret material in step labels', () => {
    const s = sc({
      id: 's.exec',
      setup: [],
      requires: [],
      steps: [{ action: 'exec', command: ['cocod', 'receive', 'cashu', CASHU] }] as never,
    });
    const label = expandScenario(s, new Map(), { capabilities: new Set() }).steps[0].label;
    expect(label).not.toContain(CASHU);
    expect(label).toContain('redacted');
  });

  it('never renders the encoded public payment request in plan or dry-run labels', () => {
    const p = expandScenario(
      sc({
        setup: [],
        requires: [],
        steps: [{ action: 'setPaymentRequestClipboard', request: PUBLIC_PAYMENT_REQUEST }] as never,
      }),
      new Map(),
      { capabilities: new Set() }
    );
    expect(p.steps[0]?.label).toBe('setPaymentRequestClipboard ← public NUT-18 request');
    expect(p.steps[0]?.label).not.toContain(PUBLIC_PAYMENT_REQUEST);
    expect(formatDryRunPlan(p)).not.toContain(PUBLIC_PAYMENT_REQUEST);
  });

  it('treats every unpinned cocod argv, including read-looking prefixes and trailing args, as unsafe', () => {
    const unsafe = sc({
      setup: [],
      steps: [
        { action: 'exec', command: ['cocod', 'mints', 'add', 'https://mint.example'] },
        { action: 'exec', command: ['cocod', 'x-cashu', 'anything'] },
      ] as never,
    });
    const readLooking = sc({
      setup: [],
      steps: [
        { action: 'exec', command: ['cocod', 'status'] },
        { action: 'exec', command: ['cocod', 'status', '--wallet', 'other'] },
        { action: 'exec', command: ['cocod', 'mints', 'list', '--refresh'] },
      ] as never,
    });
    expect(unsafeCocodEffects(unsafe, reg)).toEqual(['cocod mints add', 'cocod x-cashu anything']);
    expect(unsafeCocodEffects(readLooking, reg)).toEqual([
      'cocod status',
      'cocod status --wallet',
      'cocod mints list',
    ]);
  });
});
