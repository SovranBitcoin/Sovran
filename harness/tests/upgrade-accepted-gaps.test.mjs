import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import module from 'node:module';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The repository's primary checkout, when its bun.lock is byte-identical to this checkout's own. */
function lockedInstall() {
  const [top, common] = execFileSync('git', ['-C', dirname(fileURLToPath(import.meta.url)), 'rev-parse',
    '--path-format=absolute', '--show-toplevel', '--git-common-dir'], { encoding: 'utf8' }).trim().split('\n');
  const primary = dirname(common);
  if (primary === top) return null;
  if (!readFileSync(join(primary, 'bun.lock')).equals(readFileSync(join(top, 'bun.lock'))))
    throw new Error(`${primary}/bun.lock differs from ${top}/bun.lock; its packages are not this checkout's`);
  return { top, primary };
}
// The regression baseline is a bare worktree of the base with only this file copied in, so it has
// no node_modules. There (Node only; Bun has no hooks) a package this checkout cannot find resolves
// from the primary checkout's install, as if this file sat there, and only while both lock the same
// dependencies: the base's own environment, never a candidate's.
let install;
module.registerHooks?.({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || /^([./#]|[a-z][a-z0-9+.-]*:)/i.test(specifier) ||
      !context.parentURL?.startsWith('file:')) throw error;
    install ??= lockedInstall();
    const path = install && relative(install.top, fileURLToPath(context.parentURL));
    if (!install || isAbsolute(path) || path.startsWith('..')) throw error;
    process.stderr.write(`Resolving ${specifier} from ${install.primary}, whose bun.lock matches this checkout\n`);
    return nextResolve(specifier, { ...context, parentURL: pathToFileURL(join(install.primary, path)).href });
  }
} });
// A namespace object, so a build without the new export fails by assertion, not by linking.
const upgrade = await import('../src/upgrade.ts');

const epochTitles = ['starts, three times over, without stopping on a failure or recovery screen',
  'keeps the phrase and makes no new one',
  'opens every account with the key it had, and keeps the same account selected',
  'turns down no saved blob and sets none aside as unreadable', 'loads no store that held data as its defaults',
  'deletes nothing the fixture says must be kept', 'changes nothing on a later launch',
  'names only databases the current app opens for these accounts'];
const E1 = 'E1 (0.0.1) upgraded straight to this build';
const theme = 'the wallpaper theme', why = 'theme store v2 starts from the default look';
const observation = (title, ancestorTitles = [], fields = {}) => ({ title, ancestorTitles,
  fullName: [...ancestorTitles, title].join(' '), status: 'passed', failing: false, numPassingAsserts: 1, ...fields });
/** The it.failing check releaseFixtures.test.ts emits for a fact with a known gap. */
const expectedFailure = (followUp, reason = why, ancestor = E1, fields = {}) =>
  observation(`keeps ${theme} [known gap ${followUp}: ${reason}]`, [ancestor], { failing: true, ...fields });

/** A complete, ordinary E1 report and inventory, as upgrade.test.ts builds them. */
function inputs() {
  return { inventory: { version: 1, sourceFingerprint: 'a'.repeat(64), expectedEpochIds: ['E1'],
    epochs: [{ id: 'E1', facts: [], knownGaps: [] }],
    cocoAdapters: [{ package: '@cashu/coco-expo-sqlite', version: '2.0.0' }] },
  jest: { success: true, testResults: [
    { name: '/app/releaseFixtures.test.ts', assertionResults: epochTitles.map(title => observation(title, [E1])) },
    ...['releaseFixturesCompleteness', 'releaseFixturesFrozen', 'releasedPersistedSurface', 'persistenceSurface'].map(name =>
      ({ name: `/app/${name}.test.ts`, assertionResults: [observation('checks its recorded surface')] })),
    { name: '/app/cocoDatabaseUpgrade.test.ts', assertionResults: [
      'keeps every proof with its secret, amount, mint, keyset and state',
      'keeps the spendable balance of each mint', 'does not lower a keyset counter',
    ].map(title => observation(title, ['a wallet written by @cashu/coco-expo-sqlite 2.0.0', 'opened by the shipped adapter'])) },
  ] } };
}
/** E1 keeps the wallpaper theme as a fact whose loss the owner accepted. */
function acceptedFact(proof) {
  const { jest, inventory } = inputs();
  inventory.epochs[0].facts.push(theme);
  inventory.epochs[0].knownGaps.push({ what: theme, followUp: 'accepted', why });
  if (proof) jest.testResults[0].assertionResults.push(proof);
  return { jest, inventory };
}
const accepted = result => result.accepted ?? [];

describe('the upgrade gate and owner-accepted gaps', () => {
  test('an owner-accepted gap whose loss still reproduces passes and is disclosed', () => {
    for (const numPassingAsserts of [1, 0]) {
      const proof = expectedFailure('accepted', why, E1, { numPassingAsserts });
      const { jest, inventory } = acceptedFact(proof);
      const result = upgrade.inspectUpgradeEvidence(jest, inventory);
      assert.equal(result.status, 'pass', result.reasons.join('\n'));
      assert.deepEqual(result.reasons, []);
      assert.deepEqual(result.losses, []);
      assert.deepEqual(result.accepted, [`E1: ${theme} [accepted: ${why}] reproduced by ${proof.fullName}`]);
    }
  });

  test('an accepted gap that names a store rather than a fact passes and is disclosed', () => {
    const { jest, inventory } = inputs();
    inventory.epochs[0].knownGaps.push({ what: 'theme-store', followUp: 'accepted', why: 'version 2 drops the old shape' });
    const result = upgrade.inspectUpgradeEvidence(jest, inventory);
    assert.equal(result.status, 'pass', result.reasons.join('\n'));
    assert.deepEqual(result.losses, []);
    assert.deepEqual(result.accepted, ['E1: theme-store [accepted: version 2 drops the old shape]']);
  });

  test('a gap with any other follow-up still blocks', () => {
    for (const followUp of ['F89', 'Accepted', 'accepted ', ' accepted', 'decision pending']) {
      const store = inputs();
      store.inventory.epochs[0].knownGaps.push({ what: 'theme-store', followUp, why });
      const storeResult = upgrade.inspectUpgradeEvidence(store.jest, store.inventory);
      assert.equal(storeResult.status, 'inconclusive', followUp);
      assert.ok(storeResult.losses.includes(`E1: theme-store [${followUp}: ${why}]`), followUp);
      assert.deepEqual(accepted(storeResult), [], followUp);

      const fact = acceptedFact(expectedFailure(followUp));
      fact.inventory.epochs[0].knownGaps[0].followUp = followUp;
      const factResult = upgrade.inspectUpgradeEvidence(fact.jest, fact.inventory);
      assert.equal(factResult.status, 'inconclusive', followUp);
      assert.ok(factResult.losses.includes(`E1: ${theme} [${followUp}: ${why}]`), followUp);
      assert.ok(factResult.reasons.includes(`Missing ordinary evidence: E1: keeps ${theme}`), followUp);
      assert.deepEqual(accepted(factResult), [], followUp);
    }
  });

  test('an accepted fact without its passing expected-failure assertion stays inconclusive', () => {
    const variants = {
      missing: undefined,
      skipped: expectedFailure('accepted', why, E1, { status: 'pending', numPassingAsserts: 0 }),
      'passing ordinarily': expectedFailure('accepted', why, E1, { failing: false }),
      'under another epoch': expectedFailure('accepted', why, 'E10 (0.1.0) upgraded straight to this build'),
      'with another reason': expectedFailure('accepted', 'some other reason'),
    };
    for (const [variant, proof] of Object.entries(variants)) {
      const { jest, inventory } = acceptedFact(proof);
      const result = upgrade.inspectUpgradeEvidence(jest, inventory);
      assert.equal(result.status, 'inconclusive', variant);
      assert.ok(result.losses.includes(`E1: ${theme} [accepted: ${why}]`), variant);
      assert.deepEqual(accepted(result), [], variant);
    }
    const failed = acceptedFact(expectedFailure('accepted', why, E1, { status: 'failed', numPassingAsserts: 0 }));
    const result = upgrade.inspectUpgradeEvidence(failed.jest, failed.inventory);
    assert.equal(result.status, 'fail');
    assert.deepEqual(accepted(result), []);
  });

  test('an expected-failure assertion for a fact with no accepted gap remains a loss', () => {
    const unclaimed = expectedFailure('accepted');
    const bare = inputs();
    bare.jest.testResults[0].assertionResults.push(unclaimed);
    const otherReason = acceptedFact(unclaimed);
    otherReason.inventory.epochs[0].knownGaps[0].why = 'some other reason';
    const otherEpoch = inputs();
    otherEpoch.jest.testResults[0].assertionResults.push(unclaimed);
    otherEpoch.inventory.expectedEpochIds.push('E10');
    otherEpoch.inventory.epochs.push({ id: 'E10', facts: [], knownGaps: [{ what: theme, followUp: 'accepted', why }] });
    for (const [variant, { jest, inventory }] of Object.entries({ bare, otherReason, otherEpoch })) {
      const result = upgrade.inspectUpgradeEvidence(jest, inventory);
      assert.equal(result.status, 'inconclusive', variant);
      assert.ok(result.losses.includes(unclaimed.fullName), variant);
      assert.ok(!accepted(result).some(entry => entry.includes(unclaimed.fullName)), variant);
    }
  });

  test('the controller summary names how many accepted losses the pass carries', () => {
    assert.equal(typeof upgrade.upgradeReceiptSummary, 'function', 'upgrade.ts exports the receipt summary');
    const two = acceptedFact(expectedFailure('accepted'));
    two.inventory.epochs[0].knownGaps.push({ what: 'theme-store', followUp: 'accepted', why: 'version 2 drops the old shape' });
    const carried = upgrade.inspectUpgradeEvidence(two.jest, two.inventory);
    assert.equal(carried.status, 'pass', carried.reasons.join('\n'));
    assert.equal(upgrade.upgradeReceiptSummary(carried),
      'Recorded historical fixture checks passed with 2 owner-accepted losses; this is bounded unit evidence');
    const one = inputs();
    one.inventory.epochs[0].knownGaps.push({ what: 'theme-store', followUp: 'accepted', why: 'version 2 drops the old shape' });
    assert.equal(upgrade.upgradeReceiptSummary(upgrade.inspectUpgradeEvidence(one.jest, one.inventory)),
      'Recorded historical fixture checks passed with 1 owner-accepted loss; this is bounded unit evidence');
    const clean = inputs();
    assert.equal(upgrade.upgradeReceiptSummary(upgrade.inspectUpgradeEvidence(clean.jest, clean.inventory)),
      'Recorded historical fixture checks passed; this is bounded unit evidence');
    const blocked = acceptedFact();
    const blockedResult = upgrade.inspectUpgradeEvidence(blocked.jest, blocked.inventory);
    assert.equal(upgrade.upgradeReceiptSummary(blockedResult), blockedResult.reasons.join('\n'));
    assert.match(upgrade.upgradeReceiptSummary(blockedResult), /Known losses or expected failures remain/);
  });
});
