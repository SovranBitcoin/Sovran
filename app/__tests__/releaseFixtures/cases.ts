import { z } from 'zod';
import type { ReleaseFixture, SurvivingFact } from './format';
import { RELEASE_FIXTURES } from './index';
import declarations from './cases.json';

const path = z.array(z.union([z.string().min(1), z.number().int().nonnegative()])).min(1);
const fact = z.object({
  what: z.string().min(1),
  store: z.string().min(1),
  accountIndex: z.number().int().optional(),
  path,
  equals: z.json(),
});
const edit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set'), path, value: z.json() }),
  z.object({ kind: z.literal('remove'), path }),
]);
export const caseSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .refine((value) => value !== 'baseline', 'baseline is reserved'),
  epoch: z.string().regex(/^E\d+$/),
  store: z.string().min(1),
  source: z.object({
    commit: z.string().min(7),
    path: z
      .string()
      .min(1)
      .refine((value) => !value.includes('REPLACE_'), 'Complete the historical source path'),
    reason: z
      .string()
      .min(20)
      .refine((value) => !value.includes('REPLACE_'), 'Complete the historical writer evidence'),
  }),
  rows: z
    .array(
      z.object({
        storage: z.enum(['asyncStorage', 'files']),
        key: z.string().min(1),
        edits: z.array(edit).min(1),
      })
    )
    .min(1),
  replaces: z.array(z.string()),
  facts: z.array(fact).min(1),
  diskFacts: z
    .array(
      z.object({
        storage: z.enum(['asyncStorage', 'secureStore', 'files']),
        key: z.string(),
        path,
        equals: z.json(),
      })
    )
    .default([]),
});
export type CaseDefinition = z.input<typeof caseSchema>;
export type UpgradeCase = {
  id: string;
  store: string;
  fixture: ReleaseFixture;
  diskFacts: z.output<typeof caseSchema>['diskFacts'];
};
export function readPath(value: unknown, keys: readonly (string | number)[]): unknown {
  return keys.reduce<unknown>(
    (held, key) => (typeof held === 'object' && held !== null ? Reflect.get(held, key) : undefined),
    value
  );
}
function patch(value: unknown, changes: z.output<typeof caseSchema>['rows'][number]['edits']) {
  const cloned: unknown = structuredClone(value);
  for (const change of changes) {
    if (
      change.path.some((part) => ['__proto__', 'prototype', 'constructor'].includes(String(part)))
    )
      throw new Error('Unsafe fixture path');
    const parent = readPath(cloned, change.path.slice(0, -1));
    const key = change.path[change.path.length - 1];
    if (typeof parent !== 'object' || parent === null)
      throw new Error(`Fixture path has no parent: ${change.path.join('.')}`);
    if (change.kind === 'remove') {
      if (!Reflect.has(parent, key))
        throw new Error(`Fixture field does not exist: ${change.path.join('.')}`);
      Reflect.deleteProperty(parent, key);
    } else Reflect.set(parent, key, structuredClone(change.value));
  }
  return cloned;
}
export function compileCase(
  input: CaseDefinition,
  fixtures: readonly ReleaseFixture[] = RELEASE_FIXTURES
): UpgradeCase {
  const definition = caseSchema.parse(input);
  const original = fixtures.find((fixture) => fixture.epoch === definition.epoch);
  if (!original) throw new Error(`Unknown epoch ${definition.epoch}`);
  const replaced = new Set(definition.replaces);
  if (replaced.size !== definition.replaces.length) throw new Error('Duplicate replaced fact');
  for (const name of replaced) {
    const held = original.survives.facts.find((item) => item.what === name);
    if (!held || held.store !== definition.store)
      throw new Error(`Cannot replace unrelated or absent fact: ${name}`);
    if (
      !definition.facts.some(
        (fact) =>
          fact.accountIndex === held.accountIndex &&
          JSON.stringify(fact.path) === JSON.stringify(held.path)
      )
    ) {
      throw new Error(
        `A replaced fact needs a replacement assertion at its original path: ${name}`
      );
    }
    if (original.knownGaps.some((gap) => gap.what === name))
      throw new Error(`Cannot hide a known gap: ${name}`);
  }
  if (definition.facts.some((item) => item.store !== definition.store))
    throw new Error('Case facts must belong to its declared store');
  const asyncStorage = { ...original.asyncStorage };
  const files = { ...original.files };
  for (const row of definition.rows) {
    const held = row.storage === 'asyncStorage' ? asyncStorage[row.key] : files[row.key];
    if (held === undefined) throw new Error(`Fixture row does not exist: ${row.key}`);
    const decoded: unknown = typeof held === 'string' ? JSON.parse(held) : held;
    const updated = patch(decoded, row.edits);
    if (row.storage === 'files') files[row.key] = JSON.stringify(updated);
    else asyncStorage[row.key] = typeof held === 'string' ? JSON.stringify(updated) : updated;
  }
  const facts: SurvivingFact[] = [
    ...original.survives.facts.filter((item) => !replaced.has(item.what)),
    ...definition.facts,
  ];
  if (new Set(facts.map((item) => item.what)).size !== facts.length)
    throw new Error('Duplicate fact names in case');
  return {
    id: definition.id,
    store: definition.store,
    fixture: { ...original, asyncStorage, files, survives: { ...original.survives, facts } },
    diskFacts: definition.diskFacts,
  };
}

/** Declarations are data; parsing fails before any upgrade if an input is incomplete. */
export const CASE_DEFINITIONS = z.array(caseSchema).parse(declarations);
export function baselineCases(
  fixtures: readonly ReleaseFixture[] = RELEASE_FIXTURES
): UpgradeCase[] {
  return fixtures.map((fixture) => ({
    id: 'baseline',
    store: 'all stores',
    fixture,
    diskFacts: [],
  }));
}
export function declaredCases(): UpgradeCase[] {
  const ids = CASE_DEFINITIONS.map((item) => `${item.epoch}/${item.id}`);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate persistence case IDs');
  return CASE_DEFINITIONS.map((item) => compileCase(item));
}
/** Unknown filters fail instead of certifying an empty selection. */
export function selectCases(
  cases: readonly UpgradeCase[],
  filter: { epoch?: string; store?: string; case?: string; version?: string }
) {
  const selected = cases.filter(
    (item) =>
      (!filter.epoch || item.fixture.epoch === filter.epoch) &&
      (!filter.version || item.fixture.versions.includes(filter.version)) &&
      (!filter.case || item.id === filter.case) &&
      (!filter.store ||
        item.store === filter.store ||
        (item.id === 'baseline' &&
          item.fixture.survives.facts.some((f) => f.store === filter.store)))
  );
  if (!selected.length) throw new Error(`No persistence cases match ${JSON.stringify(filter)}`);
  return selected;
}
