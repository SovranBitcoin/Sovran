/**
 * Discover + validate every suite/scenario/fixture JSON into typed registries.
 * Collects issues rather than throwing, so `validate` can report them all and
 * `list`/`dry-run` can operate on the valid subset.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateScenario,
  validateFixture,
  validateSuite,
  validateFixtureGraph,
  validateFundedScenarioFixtures,
  referencedFixtures,
  checkCompact,
  parseJson,
  type Scenario,
  type Fixture,
  type Suite,
  type Issue,
} from '../schema';
import { validateSuiteReferences } from './selection';

export interface Loaded {
  scenarios: Map<string, Scenario>;
  scenarioFiles: Map<string, string>;
  fixtures: Map<string, Fixture>;
  suites: Suite[];
  issues: { file: string; issue: Issue }[];
}

export function loadE2E(e2eDir: string): Loaded {
  const out: Loaded = {
    scenarios: new Map(),
    scenarioFiles: new Map(),
    fixtures: new Map(),
    suites: [],
    issues: [],
  };
  const add = (file: string, issues: Issue[]) =>
    issues.forEach((issue) => out.issues.push({ file, issue }));

  const each = (dir: string, fn: (file: string, raw: string, parsed: unknown) => void) => {
    const abs = join(e2eDir, dir);
    if (!existsSync(abs)) return;
    for (const f of readdirSync(abs)
      .filter((x) => x.endsWith('.json'))
      .sort()) {
      const raw = readFileSync(join(abs, f), 'utf8');
      const parsed = parseJson(raw);
      if (!parsed.ok) return add(`${dir}/${f}`, parsed.issues);
      if (!checkCompact(raw).ok)
        add(`${dir}/${f}`, [{ path: '(format)', message: 'not compact — run e2e:validate:fix' }]);
      fn(`${dir}/${f}`, raw, parsed.value);
    }
  };

  each('fixtures', (file, _raw, parsed) => {
    const r = validateFixture(parsed);
    if (!r.ok) return add(file, r.issues);
    if (out.fixtures.has(r.value.id)) {
      add(file, [{ path: 'id', message: `duplicate fixture id "${r.value.id}"` }]);
      return;
    }
    out.fixtures.set(r.value.id, r.value);
  });
  each('scenarios', (file, _raw, parsed) => {
    const r = validateScenario(parsed);
    if (!r.ok) return add(file, r.issues);
    if (!r.value.verify.length) {
      add(file, [
        {
          path: 'verify',
          message: 'canonical scenario must author a non-empty verify section',
        },
      ]);
    }
    if (out.scenarios.has(r.value.id)) {
      add(file, [{ path: 'id', message: `duplicate scenario id "${r.value.id}"` }]);
      return;
    }
    out.scenarios.set(r.value.id, r.value);
    out.scenarioFiles.set(r.value.id, file);
  });
  each('suites', (file, _raw, parsed) => {
    const r = validateSuite(parsed);
    if (!r.ok) return add(file, r.issues);
    out.suites.push(r.value);
  });

  const graph = validateFixtureGraph([...out.fixtures.values()]);
  if (!graph.ok) add('fixtures (graph)', graph.issues);
  for (const [id, s] of out.scenarios) {
    for (const u of referencedFixtures(s)) {
      if (!out.fixtures.has(u))
        add(`scenarios/${id}`, [{ path: 'use', message: `unknown fixture "${u}"` }]);
    }
    add(
      out.scenarioFiles.get(id) ?? `scenarios/${id}`,
      validateFundedScenarioFixtures(s, out.fixtures)
    );
  }
  for (const issue of validateSuiteReferences(
    out.suites,
    out.scenarios,
    out.scenarioFiles,
    out.fixtures
  )) {
    add(`suites/${issue.suite}`, [{ path: issue.path, message: issue.message }]);
  }
  return out;
}
