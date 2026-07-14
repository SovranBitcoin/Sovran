import { z } from 'zod';
import { suiteSchema } from './suite';
import { scenarioSchema, fixtureSchema, type Scenario, type Fixture } from './scenario';

export type Issue = { path: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

/** JSON.parse already rejects JSONC (comments) and trailing commas. */
export function parseJson(text: string): Result<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, issues: [{ path: '', message: `invalid JSON: ${(e as Error).message}` }] };
  }
}

function zodIssues(err: z.ZodError): Issue[] {
  return err.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
}

// Literal payment material must never appear in an authored field — cocod
// produces tokens/invoices/keys at runtime. High-signal prefixes only (no prose
// false-positives). Mnemonics are exact-value only so ordinary prose cannot
// accidentally match; runtime redaction remains deliberately broader.
const SECRET_PATTERNS: [string, RegExp][] = [
  ['nsec', /nsec1[a-z0-9]{20,}/i],
  ['npub', /npub1[a-z0-9]{20,}/i],
  ['cashu-token', /cashu[AB][A-Za-z0-9_-]{20,}/],
  ['bolt11', /ln(bc|tb|bcrt)[0-9][a-z0-9]{20,}/i],
  ['mnemonic', /^(?:[a-z]{2,10}\s){11}[a-z]{2,10}$|^(?:[a-z]{2,10}\s){23}[a-z]{2,10}$/],
  ['64-hex-private-key', /\b[0-9a-f]{64}\b/i],
];

export function scanSecrets(node: unknown, path = ''): Issue[] {
  const out: Issue[] = [];
  if (typeof node === 'string') {
    for (const [kind, re] of SECRET_PATTERNS) {
      if (re.test(node))
        out.push({
          path: path || '(root)',
          message: `looks like a ${kind} secret in a non-secret field`,
        });
    }
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => out.push(...scanSecrets(v, `${path}[${i}]`)));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node))
      out.push(...scanSecrets(v, path ? `${path}.${k}` : k));
  }
  return out;
}

function validateWith<T>(schema: z.ZodType<T>, data: unknown): Result<T> {
  const secrets = scanSecrets(data);
  if (secrets.length) return { ok: false, issues: secrets };
  const parsed = schema.safeParse(data);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, issues: zodIssues(parsed.error) };
}

export const RAW_COCOD_FUNDED_MESSAGE =
  'funded scenarios must use typed counterparty steps, not raw cocod commands';

export function isRawCocodStep(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const step = node as { action?: unknown; command?: unknown; from?: unknown };
  const argv =
    step.action === 'exec' ? step.command : step.action === 'setClipboard' ? step.from : null;
  return Array.isArray(argv) && argv[0] === 'cocod';
}

type AssetBudget = NonNullable<Scenario['funds']>['assets'][number];

function assetBudgets(scenario: Scenario): Map<string, AssetBudget> {
  return new Map(
    (scenario.funds?.assets ?? []).map((asset) => [
      `${asset.mintUrl}\u0000${asset.unit}\u0000${asset.accountIndex}`,
      asset,
    ])
  );
}

function counterpartyContractIssues(
  node: unknown,
  path: string,
  assets: ReadonlyMap<string, AssetBudget>
): Issue[] {
  if (!node || typeof node !== 'object') return [];
  const step = node as Record<string, unknown>;
  if (step.action !== 'counterparty') return [];
  const recoverySweep = step.operation === 'recovery.sweep';
  if (
    typeof step.mintUrl !== 'string' ||
    (step.unit !== 'sat' && step.unit !== 'usd') ||
    typeof step.accountIndex !== 'number'
  ) {
    return [
      {
        path,
        message: recoverySweep
          ? 'counterparty asset fields must resolve to exact literals'
          : 'counterparty amount and asset fields must resolve to exact literals',
      },
    ];
  }
  const key = `${step.mintUrl}\u0000${step.unit}\u0000${step.accountIndex}`;
  const asset = assets.get(key);
  if (!asset) {
    return [{ path, message: 'counterparty operation uses an undeclared funded asset' }];
  }
  if (recoverySweep) return [];
  const amount = step.amount;
  if (typeof amount !== 'number') {
    return [
      {
        path,
        message: 'counterparty amount and asset fields must resolve to exact literals',
      },
    ];
  }
  if (amount > asset.maxPrincipal) {
    return [
      {
        path: `${path}.amount`,
        message: `counterparty amount ${amount} exceeds exact asset maxPrincipal ${asset.maxPrincipal}`,
      },
    ];
  }
  return [];
}

function directFundedScenarioIssues(scenario: Scenario): Issue[] {
  if (scenario.lane !== 'funded') return [];
  const assets = assetBudgets(scenario);
  const phases = [
    ['setup', scenario.setup],
    ['steps', scenario.steps],
    ['verify', scenario.verify],
    ['finally', scenario.finally],
  ] as const;
  return phases.flatMap(([phase, items]) =>
    items.flatMap((item, index): Issue[] => {
      const path = `${phase}.${index}`;
      if (isRawCocodStep(item)) return [{ path, message: RAW_COCOD_FUNDED_MESSAGE }];
      return counterpartyContractIssues(item, path, assets);
    })
  );
}

export const validateScenario = (data: unknown): Result<Scenario> => {
  const base = validateWith(scenarioSchema, data);
  if (!base.ok) return base;
  const issues = directFundedScenarioIssues(base.value);
  return issues.length ? { ok: false, issues } : base;
};
export const validateFixture = (data: unknown) => validateWith(fixtureSchema, data);

export function validateSuite(data: unknown): Result<z.infer<typeof suiteSchema>> {
  const base = validateWith(suiteSchema, data);
  if (!base.ok) return base;
  const issues: Issue[] = [];
  const ids = new Set<string>();
  const orders = new Set<number>();
  base.value.scenarios.forEach((s, i) => {
    if (ids.has(s.id))
      issues.push({ path: `scenarios[${i}].id`, message: `duplicate scenario id "${s.id}"` });
    if (orders.has(s.order))
      issues.push({ path: `scenarios[${i}].order`, message: `duplicate order ${s.order}` });
    ids.add(s.id);
    orders.add(s.order);
  });
  return issues.length ? { ok: false, issues } : base;
}

/** `use` references made by a scenario's setup/finally (fixture ids). */
export function referencedFixtures(scenario: z.infer<typeof scenarioSchema>): string[] {
  const refs: string[] = [];
  for (const item of [...scenario.setup, ...scenario.finally]) {
    if (item && typeof item === 'object' && 'use' in item) refs.push((item as { use: string }).use);
  }
  return refs;
}

/** Detects unknown refs + `use` cycles across the fixture registry. */
export function validateFixtureGraph(fixtures: Fixture[]): Result<true> {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const issues: Issue[] = [];
  const usesOf = (f: Fixture) =>
    f.steps
      .filter((s): s is { use: string } => !!s && typeof s === 'object' && 'use' in s)
      .map((s) => s.use);

  for (const f of fixtures) {
    for (const u of usesOf(f))
      if (!byId.has(u)) issues.push({ path: f.id, message: `unknown fixture reference "${u}"` });
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const dfs = (id: string, stack: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      issues.push({ path: id, message: `fixture dependency cycle: ${[...stack, id].join(' → ')}` });
      return;
    }
    const f = byId.get(id);
    if (!f) return;
    state.set(id, 'visiting');
    for (const u of usesOf(f)) dfs(u, [...stack, id]);
    state.set(id, 'done');
  };
  for (const f of fixtures) dfs(f.id, []);
  return issues.length ? { ok: false, issues } : { ok: true, value: true };
}

/** Cross-document funded check: a fixture cannot hide a raw value-moving argv
 * from the scenario-level typed counterparty contract. */
export function validateFundedScenarioFixtures(
  scenario: Scenario,
  fixtures: ReadonlyMap<string, Fixture>
): Issue[] {
  if (scenario.lane !== 'funded') return [];
  const issues: Issue[] = [];
  const assets = assetBudgets(scenario);
  const paramRef = /^\$\{([a-zA-Z][a-zA-Z0-9_]*)\}$/;
  const interpolateParams = (
    node: unknown,
    params: Record<string, string | number | boolean>
  ): unknown => {
    if (typeof node === 'string') {
      const match = node.match(paramRef);
      return match && match[1] in params ? params[match[1]] : node;
    }
    if (Array.isArray(node)) return node.map((item) => interpolateParams(item, params));
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node).map(([key, value]) => [key, interpolateParams(value, params)])
      );
    }
    return node;
  };
  const visit = (
    fixtureId: string,
    path: string,
    stack: string[],
    params: Record<string, string | number | boolean>
  ): void => {
    if (stack.includes(fixtureId)) return;
    const fixture = fixtures.get(fixtureId);
    if (!fixture) return;
    fixture.steps.forEach((item, index) => {
      const stepPath = `${path}(${fixtureId}).steps.${index}`;
      const expanded = interpolateParams(item, params);
      if (isRawCocodStep(expanded)) {
        issues.push({ path: stepPath, message: RAW_COCOD_FUNDED_MESSAGE });
      } else if (expanded && typeof expanded === 'object' && 'use' in expanded) {
        const nested = expanded as {
          use: string;
          with?: Record<string, string | number | boolean>;
        };
        visit(nested.use, stepPath, [...stack, fixtureId], nested.with ?? {});
      } else {
        issues.push(...counterpartyContractIssues(expanded, stepPath, assets));
      }
    });
  };
  const phases = [
    ['setup', scenario.setup],
    ['finally', scenario.finally],
  ] as const;
  for (const [phase, items] of phases) {
    items.forEach((item, index) => {
      if (item && typeof item === 'object' && 'use' in item) {
        visit(item.use, `${phase}.${index}`, [], item.with ?? {});
      }
    });
  }
  return issues;
}
