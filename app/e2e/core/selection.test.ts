import { describe, expect, it } from 'bun:test';
import type { Fixture, Scenario, Suite } from '../schema';
import {
  assertDriverLaneCompatibility,
  assertFundedSelectionAuthorized,
  parseCliArgs,
  selectSuiteScenarios,
  validateSuiteReferences,
  formatScenarioListLine,
} from './selection';

const scenario = (id: string, over: Partial<Scenario> = {}): Scenario => {
  const value: Scenario = {
    version: 1,
    id,
    name: id,
    description: id,
    lane: 'simulator',
    tags: ['smoke'],
    requires: ['fresh-install'],
    setup: [],
    steps: [{ action: 'goHome' }],
    verify: [],
    finally: [],
    endState: 'wallet',
    ...over,
  };
  return value;
};
const ref = (
  id: string,
  file: string,
  order: number,
  over: Partial<Suite['scenarios'][number]> = {}
) => ({
  id,
  file,
  order,
  newInstance: true,
  lane: 'simulator' as const,
  requires: ['fresh-install' as const],
  endState: 'wallet' as const,
  ...over,
});
const suite = (name: string, refs: ReturnType<typeof ref>[]): Suite => {
  const value: Suite = {
    version: 1,
    name,
    defaultEndState: 'wallet',
    scenarios: refs,
  };
  return value;
};

describe('parseCliArgs', () => {
  it('rejects unknown flags, missing values, and unknown commands', () => {
    expect(() => parseCliArgs(['wat'])).toThrow(/unknown command/);
    expect(() => parseCliArgs(['list', '--wat'])).toThrow(/unknown flag/);
    expect(() => parseCliArgs(['list', '--suite'])).toThrow(/requires a value/);
  });

  it('parses a strict suite selection', () => {
    expect(parseCliArgs(['dry-run', '--suite', 'full', '--scenario', 'a.one'])).toMatchObject({
      command: 'dry-run',
      suite: 'full',
      scenario: 'a.one',
    });
  });

  it('keeps simulator destruction and test-fund loss as separate approvals', () => {
    expect(parseCliArgs(['run', '--i-approve-destructive-reset']).approveDestructiveReset).toBe(
      true
    );
    expect(parseCliArgs(['run', '--i-accept-test-fund-loss']).acceptTestFundLoss).toBe(true);
    expect(
      parseCliArgs(['run', '--i-approve-destructive-reset', '--i-accept-test-fund-loss'])
    ).toMatchObject({ approveDestructiveReset: true, acceptTestFundLoss: true });
    expect(() => parseCliArgs(['run', '--i-approve-funded-run'])).toThrow(/unknown flag/);
  });

  it('records by default and honors --no-record only on run', () => {
    expect(parseCliArgs(['run']).noRecord).toBe(false);
    expect(parseCliArgs(['run', '--no-record']).noRecord).toBe(true);
    expect(() => parseCliArgs(['list', '--no-record'])).toThrow(/not valid/);
    expect(() => parseCliArgs(['dry-run', '--no-record'])).toThrow(/not valid/);
  });

  it('accepts the read-only funds-status command without selection flags', () => {
    expect(parseCliArgs(['funds-status']).command).toBe('funds-status');
    expect(() => parseCliArgs(['funds-status', '--suite', 'full'])).toThrow(/not valid/);
  });

  it('parses funds-write-off only with a full operator declaration', () => {
    const full = [
      'funds-write-off',
      '--run-id',
      '2026-07-13T20-19-19-915Z-e7ecbc02',
      '--leg',
      'asset-01',
      '--amount',
      '33',
      '--reason',
      'stranded paid quote',
      '--i-accept-test-fund-loss',
    ];
    expect(parseCliArgs(full)).toMatchObject({
      command: 'funds-write-off',
      runId: '2026-07-13T20-19-19-915Z-e7ecbc02',
      leg: 'asset-01',
      amount: 33,
      reason: 'stranded paid quote',
      acceptTestFundLoss: true,
    });
    expect(() => parseCliArgs(full.slice(0, -1))).toThrow(/i-accept-test-fund-loss/);
    expect(() => parseCliArgs(full.filter((arg, i) => !(arg === '--leg' || full[i - 1] === '--leg')))).toThrow(
      /requires --leg/
    );
    expect(() =>
      parseCliArgs(full.map((arg) => (arg === '33' ? '0' : arg)))
    ).toThrow(/positive integer/);
    expect(() => parseCliArgs(['funds-write-off', '--suite', 'full'])).toThrow(/not valid/);
  });
});

describe('suite registry', () => {
  const one = scenario('a.one');
  const two = scenario('b.two');
  const scenarios = new Map([
    [one.id, one],
    [two.id, two],
  ]);
  const files = new Map([
    [one.id, 'scenarios/a.json'],
    [two.id, 'scenarios/b.json'],
  ]);
  const fixtures = new Map<string, Fixture>();

  it('validates ref file and metadata and requires full suite coverage', () => {
    expect(
      validateSuiteReferences(
        [suite('full', [ref('a.one', 'scenarios/b.json', 10)])],
        scenarios,
        files,
        fixtures
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/file.*does not identify/) }),
        expect.objectContaining({ message: expect.stringMatching(/missing.*b.two/) }),
      ])
    );
  });

  it('compares suite requirements with scenario plus nested fixture requirements', () => {
    const nested: Fixture = {
      version: 1,
      id: 'flow.needs-usd',
      params: [],
      requires: ['unit.usd'],
      steps: [{ action: 'goHome' }],
    };
    const withFixture = scenario('fixture.case', { setup: [{ use: nested.id }] });
    const registry = new Map([[withFixture.id, withFixture]]);
    const scenarioFiles = new Map([[withFixture.id, 'scenarios/fixture.json']]);
    const refs = [ref(withFixture.id, 'scenarios/fixture.json', 10)];
    const issues = validateSuiteReferences(
      [suite('default', refs), suite('full', refs)],
      registry,
      scenarioFiles,
      new Map([[nested.id, nested]])
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ message: expect.stringMatching(/effective.*unit\.usd/) })
    );
  });

  it('lists effective nested fixture requirements instead of direct scenario requirements', () => {
    const nested: Fixture = {
      version: 1,
      id: 'flow.sweep-usd',
      params: [],
      requires: ['unit.usd'],
      steps: [{ action: 'goHome' }],
    };
    const withCleanup = scenario('list.effective', { finally: [{ use: nested.id }] });
    const line = formatScenarioListLine(withCleanup, new Map([[nested.id, nested]]));
    expect(line).toContain('requires: fresh-install, unit.usd');
  });

  it('requires default to be simulator-only and rejects unsafe cocod plans disguised as simulator', () => {
    const move: Fixture = {
      version: 1,
      id: 'flow.move-value',
      params: [],
      requires: ['cocod.send.cashu'],
      steps: [{ action: 'exec', command: ['cocod', 'send', 'cashu', '10'] }],
    };
    const hidden = scenario('hidden.value', {
      lane: 'simulator',
      requires: ['fresh-install'],
      setup: [{ use: move.id }],
    });
    const funded = scenario('funded.case', { lane: 'funded' });
    const registry = new Map([
      [hidden.id, hidden],
      [funded.id, funded],
    ]);
    const scenarioFiles = new Map([
      [hidden.id, 'scenarios/hidden.json'],
      [funded.id, 'scenarios/funded.json'],
    ]);
    const hiddenRef = ref(hidden.id, 'scenarios/hidden.json', 10, {
      requires: ['fresh-install', 'cocod.send.cashu'],
    });
    const fundedRef = ref(funded.id, 'scenarios/funded.json', 20, { lane: 'funded' });
    const issues = validateSuiteReferences(
      [suite('default', [hiddenRef, fundedRef]), suite('full', [hiddenRef, fundedRef])],
      registry,
      scenarioFiles,
      new Map([[move.id, move]])
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/default.*simulator-only/) }),
        expect.objectContaining({ message: expect.stringMatching(/unsafe.*cocod.*simulator/) }),
      ])
    );
  });

  it('rejects unsafe unpinned cocod plans in the physical lane too', () => {
    const physical = scenario('physical.value', {
      lane: 'physical',
      steps: [{ action: 'exec', command: ['cocod', 'send', 'cashu', '10'] }],
    });
    const registry = new Map([[physical.id, physical]]);
    const scenarioFiles = new Map([[physical.id, 'scenarios/physical.json']]);
    const physicalRef = ref(physical.id, 'scenarios/physical.json', 10, { lane: 'physical' });
    const issues = validateSuiteReferences(
      [suite('default', []), suite('full', [physicalRef])],
      registry,
      scenarioFiles,
      new Map()
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ message: expect.stringMatching(/unsafe.*cocod.*physical/) })
    );
  });

  it('lets the ephemeral simulator driver accept simulator and funded lanes only', () => {
    expect(() =>
      assertDriverLaneCompatibility('sim', [{ id: 'safe', lane: 'simulator' }])
    ).not.toThrow();
    expect(() =>
      assertDriverLaneCompatibility('sim', [{ id: 'funded', lane: 'funded' }])
    ).not.toThrow();
    expect(() =>
      assertDriverLaneCompatibility('sim', [{ id: 'nfc.receive', lane: 'physical' }])
    ).toThrow(/sim.*physical/i);
    expect(() => assertDriverLaneCompatibility('sim', [{ id: 'live', lane: 'live' }])).toThrow(
      /only simulator.*funded.*live/i
    );
  });

  it('requires explicit fund-loss acceptance only when a funded scenario is selected', () => {
    expect(() =>
      assertFundedSelectionAuthorized([{ id: 'safe', lane: 'simulator' }], false)
    ).not.toThrow();
    expect(() =>
      assertFundedSelectionAuthorized([{ id: 'funded', lane: 'funded' }], false)
    ).toThrow(/--i-accept-test-fund-loss/);
    expect(() =>
      assertFundedSelectionAuthorized([{ id: 'funded', lane: 'funded' }], true)
    ).not.toThrow();
  });

  it('selects only the named suite in manifest order', () => {
    const suites = [
      suite('default', [ref('a.one', 'scenarios/a.json', 20)]),
      suite('full', [ref('b.two', 'scenarios/b.json', 20), ref('a.one', 'scenarios/a.json', 10)]),
    ];
    expect(
      selectSuiteScenarios(suites, scenarios, { suite: 'full' }).scenarios.map((s) => s.id)
    ).toEqual(['a.one', 'b.two']);
  });

  it('preserves ordered simulator session groups with their manifest refs', () => {
    const selected = selectSuiteScenarios(
      [
        suite('full', [
          ref('b.two', 'scenarios/b.json', 20, { newInstance: false }),
          ref('a.one', 'scenarios/a.json', 10),
        ]),
      ],
      scenarios,
      { suite: 'full' }
    );
    expect(
      selected.sessionGroups.map((group) =>
        group.map(({ ref: manifestRef, scenario: selectedScenario }) => ({
          id: selectedScenario.id,
          newInstance: manifestRef.newInstance,
        }))
      )
    ).toEqual([
      [
        { id: 'a.one', newInstance: true },
        { id: 'b.two', newInstance: false },
      ],
    ]);
  });

  it('includes the preceding session-group prefix when selecting a reuse scenario', () => {
    const selected = selectSuiteScenarios(
      [
        suite('full', [
          ref('a.one', 'scenarios/a.json', 10),
          ref('b.two', 'scenarios/b.json', 20, { newInstance: false }),
        ]),
      ],
      scenarios,
      { suite: 'full', scenario: 'b.two' }
    );
    expect(selected.scenarios.map(({ id }) => id)).toEqual(['a.one', 'b.two']);
    expect(selected.sessionGroups).toHaveLength(1);
  });

  it('shuffles whole session groups without reordering their scenarios', () => {
    const three = scenario('c.three');
    const four = scenario('d.four');
    const selected = selectSuiteScenarios(
      [
        suite('full', [
          ref('a.one', 'scenarios/a.json', 10),
          ref('b.two', 'scenarios/b.json', 20, { newInstance: false }),
          ref('c.three', 'scenarios/c.json', 30),
          ref('d.four', 'scenarios/d.json', 40, { newInstance: false }),
        ]),
      ],
      new Map([...scenarios, [three.id, three], [four.id, four]]),
      { suite: 'full', shuffle: true, seed: 1 }
    );
    expect(
      selected.sessionGroups
        .map((group) => group.map(({ scenario: selectedScenario }) => selectedScenario.id))
        .sort(([left], [right]) => left!.localeCompare(right!))
    ).toEqual([
      ['a.one', 'b.two'],
      ['c.three', 'd.four'],
    ]);
  });

  it('fails unknown suite/scenario and zero-result filters', () => {
    const suites = [suite('default', [ref('a.one', 'scenarios/a.json', 10)])];
    expect(() => selectSuiteScenarios(suites, scenarios, { suite: 'missing' })).toThrow(
      /unknown suite/
    );
    expect(() =>
      selectSuiteScenarios(suites, scenarios, { suite: 'default', scenario: 'b.two' })
    ).toThrow(/not in suite/);
    expect(() =>
      selectSuiteScenarios(suites, scenarios, { suite: 'default', tag: 'absent' })
    ).toThrow(/selected zero/);
  });
});
