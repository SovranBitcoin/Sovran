import type { Fixture, Scenario, Suite } from '../schema';
import { effectiveRequirements, unsafeCocodEffects } from './plan';

export type CliCommand =
  | 'list'
  | 'validate'
  | 'dry-run'
  | 'run'
  | 'funds-status'
  | 'funds-write-off';
export interface CliOptions {
  command: CliCommand;
  suite: string;
  scenario?: string;
  tag?: string;
  lane?: string;
  shuffle: boolean;
  seed: number;
  caps?: string[];
  driver: 'fake' | 'sim';
  approveDestructiveReset: boolean;
  acceptTestFundLoss: boolean;
  requireCleanGit: boolean;
  runId?: string;
  leg?: string;
  amount?: number;
  reason?: string;
}

const COMMANDS = new Set<CliCommand>([
  'list',
  'validate',
  'dry-run',
  'run',
  'funds-status',
  'funds-write-off',
]);
const VALUE_FLAGS = new Set([
  'suite',
  'scenario',
  'tag',
  'lane',
  'seed',
  'caps',
  'driver',
  'run-id',
  'leg',
  'amount',
  'reason',
]);
const BOOLEAN_FLAGS = new Set([
  'shuffle',
  'i-approve-destructive-reset',
  'i-accept-test-fund-loss',
  'require-clean-git',
]);
const ALLOWED_BY_COMMAND: Record<CliCommand, Set<string>> = {
  validate: new Set(),
  'funds-status': new Set(),
  'funds-write-off': new Set(['run-id', 'leg', 'amount', 'reason', 'i-accept-test-fund-loss']),
  list: new Set(['suite', 'scenario', 'tag', 'lane', 'shuffle', 'seed']),
  'dry-run': new Set(['suite', 'scenario', 'tag', 'lane', 'shuffle', 'seed', 'caps']),
  run: new Set([
    'suite',
    'scenario',
    'tag',
    'lane',
    'shuffle',
    'seed',
    'caps',
    'driver',
    'i-approve-destructive-reset',
    'i-accept-test-fund-loss',
    'require-clean-git',
  ]),
};

/** Strict, side-effect-free CLI parsing. Unknown/duplicate/irrelevant flags and
 * missing values fail before any suite is loaded or device is touched. */
export function parseCliArgs(argv: string[]): CliOptions {
  const command = argv[0] as CliCommand | undefined;
  if (!command || !COMMANDS.has(command)) throw new Error(`unknown command "${command ?? ''}"`);

  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected positional argument "${arg}"`);
    const name = arg.slice(2);
    if (!VALUE_FLAGS.has(name) && !BOOLEAN_FLAGS.has(name))
      throw new Error(`unknown flag --${name}`);
    if (!ALLOWED_BY_COMMAND[command].has(name))
      throw new Error(`--${name} is not valid for ${command}`);
    if (values.has(name) || booleans.has(name)) throw new Error(`duplicate flag --${name}`);
    if (BOOLEAN_FLAGS.has(name)) {
      booleans.add(name);
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
    values.set(name, value);
  }

  const seedRaw = values.get('seed') ?? '1';
  const seed = Number(seedRaw);
  if (!Number.isSafeInteger(seed))
    throw new Error(`--seed must be a safe integer, got "${seedRaw}"`);
  const driver = values.get('driver') ?? 'fake';
  if (driver !== 'fake' && driver !== 'sim')
    throw new Error(`unknown driver "${driver}" (use fake | sim)`);
  const capsRaw = values.get('caps');
  const caps = capsRaw?.split(',').filter(Boolean);
  if (capsRaw !== undefined && (!caps?.length || caps.join(',') !== capsRaw))
    throw new Error('--caps must be a non-empty comma-separated list');

  let amount: number | undefined;
  if (command === 'funds-write-off') {
    for (const required of ['run-id', 'leg', 'amount', 'reason'] as const) {
      if (!values.get(required)) throw new Error(`funds-write-off requires --${required}`);
    }
    if (!booleans.has('i-accept-test-fund-loss')) {
      throw new Error('funds-write-off requires --i-accept-test-fund-loss');
    }
    amount = Number(values.get('amount'));
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new Error(`--amount must be a positive integer, got "${values.get('amount')}"`);
    }
  }

  return {
    command,
    suite: values.get('suite') ?? 'default',
    scenario: values.get('scenario'),
    tag: values.get('tag'),
    lane: values.get('lane'),
    shuffle: booleans.has('shuffle'),
    seed,
    caps,
    driver,
    approveDestructiveReset: booleans.has('i-approve-destructive-reset'),
    acceptTestFundLoss: booleans.has('i-accept-test-fund-loss'),
    requireCleanGit: booleans.has('require-clean-git'),
    runId: values.get('run-id'),
    leg: values.get('leg'),
    amount,
    reason: values.get('reason'),
  };
}

export interface RegistryIssue {
  suite: string;
  path: string;
  message: string;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** Cross-file suite contract. A manifest ref is an assertion about the exact
 * scenario file and safety metadata, not a second source of editable truth. */
export function validateSuiteReferences(
  suites: Suite[],
  scenarios: Map<string, Scenario>,
  scenarioFiles: Map<string, string>,
  fixtures: Map<string, Fixture>
): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const suiteNames = new Set<string>();
  for (const suite of suites) {
    if (suiteNames.has(suite.name))
      issues.push({
        suite: suite.name,
        path: 'name',
        message: `duplicate suite name "${suite.name}"`,
      });
    suiteNames.add(suite.name);
    for (const [i, ref] of suite.scenarios.entries()) {
      const path = `scenarios[${i}]`;
      const scenario = scenarios.get(ref.id);
      if (!scenario) {
        issues.push({
          suite: suite.name,
          path: `${path}.id`,
          message: `unknown scenario "${ref.id}"`,
        });
        continue;
      }
      const actualFile = scenarioFiles.get(ref.id);
      if (actualFile !== ref.file) {
        issues.push({
          suite: suite.name,
          path: `${path}.file`,
          message: `file "${ref.file}" does not identify scenario "${ref.id}" (actual: ${actualFile ?? 'missing'})`,
        });
      }
      if (ref.lane !== scenario.lane)
        issues.push({
          suite: suite.name,
          path: `${path}.lane`,
          message: `lane ${ref.lane} does not match scenario lane ${scenario.lane}`,
        });
      const effective = effectiveRequirements(scenario, fixtures);
      if (!sameSet(ref.requires, effective)) {
        issues.push({
          suite: suite.name,
          path: `${path}.requires`,
          message: `requires do not match effective scenario + fixture requirements for "${ref.id}": ${effective.join(', ') || 'none'}`,
        });
      }
      const valueEffects = unsafeCocodEffects(scenario, fixtures);
      if (['simulator', 'physical'].includes(scenario.lane) && valueEffects.length) {
        issues.push({
          suite: suite.name,
          path: `${path}.lane`,
          message: `unsafe unpinned cocod plan cannot use ${scenario.lane} lane: ${valueEffects.join(', ')}`,
        });
      }
      const endState = ref.endState ?? suite.defaultEndState;
      if (endState !== scenario.endState)
        issues.push({
          suite: suite.name,
          path: `${path}.endState`,
          message: `endState ${endState} does not match scenario endState ${scenario.endState}`,
        });
    }
  }

  const defaultSuite = suites.find((s) => s.name === 'default');
  if (!defaultSuite) {
    issues.push({ suite: 'default', path: 'name', message: 'missing required default suite' });
  } else {
    for (const [i, ref] of defaultSuite.scenarios.entries()) {
      const scenario = scenarios.get(ref.id);
      if (!scenario) continue;
      if (scenario.lane !== 'simulator') {
        issues.push({
          suite: 'default',
          path: `scenarios[${i}].lane`,
          message: `default suite must be simulator-only; "${scenario.id}" is ${scenario.lane}`,
        });
      }
      if (unsafeCocodEffects(scenario, fixtures).length) {
        issues.push({
          suite: 'default',
          path: `scenarios[${i}]`,
          message: `default suite cannot contain unsafe unpinned cocod effects`,
        });
      }
    }
  }

  const full = suites.find((s) => s.name === 'full');
  if (!full) {
    issues.push({ suite: 'full', path: 'name', message: 'missing required full suite' });
  } else {
    const covered = new Set(full.scenarios.map((s) => s.id));
    const missing = [...scenarios.keys()].filter((id) => !covered.has(id));
    if (missing.length)
      issues.push({
        suite: 'full',
        path: 'scenarios',
        message: `full suite missing scenario(s): ${missing.join(', ')}`,
      });
  }
  return issues;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  const random = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface SelectionOptions {
  suite: string;
  scenario?: string;
  tag?: string;
  lane?: string;
  shuffle?: boolean;
  seed?: number;
}

export interface SelectedScenario {
  ref: Suite['scenarios'][number];
  scenario: Scenario;
}

export type ScenarioSessionGroup = SelectedScenario[];

function sessionGroups(entries: SelectedScenario[]): ScenarioSessionGroup[] {
  const groups: ScenarioSessionGroup[] = [];
  for (const entry of entries) {
    if (entry.ref.newInstance || groups.length === 0) groups.push([]);
    groups.at(-1)!.push(entry);
  }
  return groups;
}

export function formatScenarioListLine(scenario: Scenario, fixtures: Map<string, Fixture>): string {
  const requires = effectiveRequirements(scenario, fixtures);
  return `  ${scenario.id.padEnd(42)} ${scenario.lane.padEnd(10)} [${scenario.tags.join(',')}] → ${scenario.endState}  requires: ${requires.join(', ') || '—'}`;
}

/** The ephemeral simulator driver owns both ordinary simulator scenarios and
 * funded scenarios. Funded value effects still require their independent CLI
 * authorization and recovery lifecycle; live and physical transports never
 * fall through to simctl. */
export function assertDriverLaneCompatibility(
  driver: 'fake' | 'sim',
  scenarios: readonly { id: string; lane: string }[]
): void {
  if (driver !== 'sim') return;
  const incompatible = scenarios.filter(
    (scenario) => !['simulator', 'funded'].includes(scenario.lane)
  );
  if (incompatible.length === 0) return;
  throw new Error(
    `driver "sim" can execute only simulator and funded lanes; blocked: ${incompatible.map((scenario) => `${scenario.id} (${scenario.lane})`).join(', ')}`
  );
}

/** Moving low-value test funds is a distinct authorization from creating and
 * deleting an ephemeral simulator. It is intentionally selection-sensitive so
 * ordinary simulator runs do not need the stronger acknowledgement. */
export function assertFundedSelectionAuthorized(
  scenarios: readonly { id: string; lane: string }[],
  accepted: boolean
): void {
  const funded = scenarios.filter((scenario) => scenario.lane === 'funded');
  if (funded.length === 0 || accepted) return;
  throw new Error(
    `funded scenarios require --i-accept-test-fund-loss; selected: ${funded.map((scenario) => scenario.id).join(', ')}`
  );
}

export function selectSuiteScenarios(
  suites: Suite[],
  registry: Map<string, Scenario>,
  opts: SelectionOptions
) {
  const suite = suites.find((candidate) => candidate.name === opts.suite);
  if (!suite) throw new Error(`unknown suite "${opts.suite}"`);
  if (opts.scenario && !registry.has(opts.scenario))
    throw new Error(`unknown scenario "${opts.scenario}"`);
  if (opts.scenario && !suite.scenarios.some((ref) => ref.id === opts.scenario)) {
    throw new Error(`scenario "${opts.scenario}" is not in suite "${suite.name}"`);
  }

  const entries = [...suite.scenarios]
    .sort((a, b) => a.order - b.order)
    .map((ref) => ({ ref, scenario: registry.get(ref.id) }))
    .filter((entry): entry is SelectedScenario => !!entry.scenario);
  const allSessionGroups = sessionGroups(entries);
  const matchesFilters = ({ scenario }: SelectedScenario) =>
    (!opts.tag || scenario.tags.includes(opts.tag)) && (!opts.lane || scenario.lane === opts.lane);
  let selectedSessionGroups: ScenarioSessionGroup[];
  if (opts.scenario) {
    const group = allSessionGroups.find((candidate) =>
      candidate.some(({ scenario }) => scenario.id === opts.scenario)
    );
    const targetIndex = group?.findIndex(({ scenario }) => scenario.id === opts.scenario) ?? -1;
    const target = targetIndex >= 0 ? group?.[targetIndex] : undefined;
    selectedSessionGroups =
      target && matchesFilters(target) ? [group!.slice(0, targetIndex + 1)] : [];
  } else if (opts.tag || opts.lane) {
    selectedSessionGroups = allSessionGroups.flatMap((group) => {
      const lastMatch = group.findLastIndex(matchesFilters);
      return lastMatch < 0 ? [] : [group.slice(0, lastMatch + 1)];
    });
  } else {
    selectedSessionGroups = allSessionGroups;
  }
  if (opts.shuffle) selectedSessionGroups = shuffle(selectedSessionGroups, opts.seed ?? 1);
  if (!selectedSessionGroups.length)
    throw new Error(`selection for suite "${suite.name}" selected zero scenarios`);
  const scenarios = selectedSessionGroups.flatMap((group) => group.map(({ scenario }) => scenario));
  return { suite, scenarios, sessionGroups: selectedSessionGroups };
}
