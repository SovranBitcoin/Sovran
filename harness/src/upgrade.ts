import { z } from 'zod';

const epochId = z.string().regex(/^E[1-9][0-9]*$/);
export const upgradeInventorySchema = z.object({
  version: z.literal(1), sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedEpochIds: z.array(epochId).min(1),
  epochs: z.array(z.object({ id: epochId, facts: z.array(z.string().min(1)), knownGaps: z.array(z.object({
    what: z.string().min(1), followUp: z.string().min(1), why: z.string().min(1),
  })) })).min(1),
  cocoAdapters: z.array(z.object({ package: z.string().min(1), version: z.string().min(1) })).min(1),
});
const assertion = z.object({
  fullName: z.string().min(1), title: z.string().min(1), ancestorTitles: z.array(z.string()),
  status: z.enum(['passed', 'failed', 'pending', 'todo', 'disabled', 'skipped']),
  failing: z.boolean(), numPassingAsserts: z.number().int().nonnegative(),
});
const report = z.object({ success: z.boolean(), testResults: z.array(z.object({
  name: z.string().min(1), assertionResults: z.array(assertion),
})) });
const suites = ['releaseFixtures.test.ts', 'releaseFixturesCompleteness.test.ts',
  'releaseFixturesFrozen.test.ts', 'releasedPersistedSurface.test.ts',
  'persistenceSurface.test.ts', 'cocoDatabaseUpgrade.test.ts'];
const writerSkips = new Map([
  ['writes the disk this build leaves after upgrading a fixture', 'releaseFixtures.test.ts'],
  ['writes the skeleton of a fixture for this build', 'releaseFixturesCompleteness.test.ts'],
]);
const epochChecks = ['starts, three times over, without stopping on a failure or recovery screen',
  'keeps the phrase and makes no new one',
  'opens every account with the key it had, and keeps the same account selected',
  'turns down no saved blob and sets none aside as unreadable',
  'loads no store that held data as its defaults',
  'deletes nothing the fixture says must be kept', 'changes nothing on a later launch',
  'names only databases the current app opens for these accounts'];
const cocoChecks = ['keeps every proof with its secret, amount, mint, keyset and state',
  'keeps the spendable balance of each mint', 'does not lower a keyset counter'];
type Inspection = { status: 'pass' | 'fail' | 'inconclusive'; reasons: string[];
  losses: string[]; skips: string[]; accepted: string[] };

/** A pass means the enumerated unit evidence is complete, never every install is safe.
 * A gap whose followUp is exactly `accepted` is an owner-accepted loss: it is listed in
 * `accepted` instead of `losses`, and when it names a surviving fact the loss must still
 * reproduce as the passing expected failure releaseFixtures.test.ts emits for it.
 * Caller must bind this inventory and report to its own before/after fingerprint. */
export function inspectUpgradeEvidence(jest: unknown, inventory: unknown): Inspection {
  const result: Inspection = { status: 'inconclusive', reasons: [], losses: [], skips: [], accepted: [] };
  const parsed = report.safeParse(jest), discovered = upgradeInventorySchema.safeParse(inventory);
  if (!parsed.success || !discovered.success) {
    result.reasons.push('Malformed upgrade report or inventory'); return result;
  }
  const data = parsed.data, expected = discovered.data;
  let failed = !data.success;
  if (failed) result.reasons.push('Jest reported unsuccessful execution');
  const files = new Map<string, z.infer<typeof assertion>[]>();
  const expectedFailures: z.infer<typeof assertion>[] = [];
  for (const suite of data.testResults) {
    const name = suite.name.replaceAll('\\', '/').split('/').at(-1) ?? '';
    if (files.has(name)) result.reasons.push(`Duplicate suite: ${name}`);
    files.set(name, suite.assertionResults);
    if (!suite.assertionResults.length) result.reasons.push(`No assertions: ${name}`);
    const seen = new Set<string>();
    for (const test of suite.assertionResults) {
      if (seen.has(test.fullName)) result.reasons.push(`Duplicate assertion: ${test.fullName}`);
      seen.add(test.fullName);
      if (test.status === 'failed') { failed = true; result.reasons.push(`Failed: ${test.fullName}`); }
      else if (test.status !== 'passed') {
        result.skips.push(test.fullName);
        if (writerSkips.get(test.fullName) !== name) result.reasons.push(`Unexpected skip: ${test.fullName}`);
      } else if (test.failing) expectedFailures.push(test);
    }
  }
  for (const name of suites) if (!files.has(name)) result.reasons.push(`Missing suite: ${name}`);
  const epochIds = expected.epochs.map(epoch => epoch.id);
  if (new Set(expected.expectedEpochIds).size !== expected.expectedEpochIds.length ||
      new Set(epochIds).size !== epochIds.length ||
      expected.expectedEpochIds.some(id => !epochIds.includes(id)) ||
      epochIds.some(id => !expected.expectedEpochIds.includes(id))) result.reasons.push('Epoch inventory is incomplete or duplicated');
  const release = files.get('releaseFixtures.test.ts') ?? [];
  const ordinaryPass = (test: z.infer<typeof assertion>) => test.status === 'passed' && !test.failing && test.numPassingAsserts > 0;
  const claimed = new Set<z.infer<typeof assertion>>(), gapLosses: string[] = [];
  for (const epoch of expected.epochs) {
    const inEpoch = (test: z.infer<typeof assertion>) => test.ancestorTitles.some(ancestor => ancestor.startsWith(`${epoch.id} (`));
    const acceptedFacts = new Set<string>();
    for (const gap of epoch.knownGaps) {
      const loss = `${epoch.id}: ${gap.what} [${gap.followUp}: ${gap.why}]`;
      if (gap.followUp !== 'accepted') { gapLosses.push(loss); continue; }
      // The exact title releaseFixtures.test.ts gives the it.failing check of an accepted gap.
      const title = `keeps ${gap.what} [known gap accepted: ${gap.why}]`;
      const proof = release.find(test => inEpoch(test) && test.title === title && test.status === 'passed' && test.failing);
      if (proof) claimed.add(proof);
      if (epoch.facts.includes(gap.what)) {
        acceptedFacts.add(gap.what);
        if (!proof) {
          gapLosses.push(loss); result.reasons.push(`Missing expected-failure evidence: ${epoch.id}: ${title}`); continue;
        }
      }
      result.accepted.push(proof ? `${loss} reproduced by ${proof.fullName}` : loss);
    }
    for (const title of [...epochChecks, ...epoch.facts.filter(what => !acceptedFacts.has(what)).map(what => `keeps ${what}`)]) if (!release.some(test =>
      inEpoch(test) && test.title === title && ordinaryPass(test))) result.reasons.push(`Missing ordinary evidence: ${epoch.id}: ${title}`);
  }
  result.losses.push(...expectedFailures.filter(test => !claimed.has(test)).map(test => test.fullName), ...gapLosses);
  const coco = files.get('cocoDatabaseUpgrade.test.ts') ?? [];
  for (const adapter of expected.cocoAdapters) for (const title of cocoChecks) if (!coco.some(test =>
    test.ancestorTitles.includes(`a wallet written by ${adapter.package} ${adapter.version}`) &&
    test.title === title && ordinaryPass(test))) result.reasons.push(`Missing Coco evidence: ${adapter.package}@${adapter.version}: ${title}`);
  if (result.losses.length) result.reasons.push('Known losses or expected failures remain');
  result.status = failed ? 'fail' : result.reasons.length ? 'inconclusive' : 'pass';
  return result;
}

/** The harness:upgrade receipt summary; a pass names how many owner-accepted losses it carries. */
export function upgradeReceiptSummary(inspected: Inspection): string {
  if (inspected.status !== 'pass') return inspected.reasons.join('\n');
  const count = inspected.accepted.length;
  return `Recorded historical fixture checks passed${count ? ` with ${count} owner-accepted loss${count === 1 ? '' : 'es'}` : ''}; this is bounded unit evidence`;
}

/** Discover metadata only from the existing fixture index and Coco manifest.
 * Invoke in a NEW Bun process for each snapshot (module imports are cached); no application runtime imports.
 * The controller must still compare this fingerprint to the test execution. */
export async function inventory(root: string): Promise<z.infer<typeof upgradeInventorySchema>> {
  const { readFile } = await import('node:fs/promises');
  const { join, resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const directory = resolve(root);
  const gitModule = await import(pathToFileURL(join(directory, 'app/e2e/core/git.ts')).href);
  const fingerprint = z.function({ input: [z.string()], output: z.string().optional() })
    .parse(gitModule.captureSourceFingerprint);
  const before = fingerprint(directory);
  const metadata: unknown = await import(pathToFileURL(join(directory, 'app/__tests__/releaseFixtures/index.ts')).href);
  const fixtures = z.object({ RELEASE_FIXTURES: z.array(z.object({
    epoch: epochId, knownGaps: upgradeInventorySchema.shape.epochs.element.shape.knownGaps,
    survives: z.object({ facts: z.array(z.object({ what: z.string().min(1) })) }),
  })).min(1) }).parse(metadata).RELEASE_FIXTURES;
  const map = await readFile(join(directory, 'docs/architecture/persistence/persistence-map.md'), 'utf8');
  const section = map.split('## Epochs')[1]?.split(/\n## /)[0] ?? '';
  const expectedEpochIds = [...section.matchAll(/^\| (E[1-9][0-9]*) \|/gm)].map(match => match[1]);
  const cocoAdapters: unknown = JSON.parse(await readFile(join(directory, 'app/__tests__/cocoDatabases/manifest.json'), 'utf8'));
  if (!before || fingerprint(directory) !== before) throw new Error('Source unavailable or changed during upgrade inventory discovery');
  return upgradeInventorySchema.parse({ version: 1, sourceFingerprint: before, expectedEpochIds,
    epochs: fixtures.map(fixture => ({ id: fixture.epoch,
      facts: fixture.survives.facts.map(fact => fact.what), knownGaps: fixture.knownGaps })), cocoAdapters });
}
