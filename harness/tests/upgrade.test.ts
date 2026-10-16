import { expect, test } from 'bun:test';
import { inspectUpgradeEvidence } from '../src/upgrade';

const titles = ['starts, three times over, without stopping on a failure or recovery screen',
  'keeps the phrase and makes no new one',
  'opens every account with the key it had, and keeps the same account selected',
  'turns down no saved blob and sets none aside as unreadable', 'loads no store that held data as its defaults',
  'deletes nothing the fixture says must be kept', 'changes nothing on a later launch',
  'names only databases the current app opens for these accounts'];
const observation = (title: string, ancestorTitles: string[] = []) => ({ title, ancestorTitles,
  fullName: [...ancestorTitles, title].join(' '), status: 'passed', failing: false, numPassingAsserts: 1 });
function inputs() {
  return { inventory: { version: 1, sourceFingerprint: 'a'.repeat(64), expectedEpochIds: ['E1'],
    epochs: [{ id: 'E1', facts: [] as string[], knownGaps: [] as { what: string; followUp: string; why: string }[] }],
    cocoAdapters: [{ package: '@cashu/coco-expo-sqlite', version: '2.0.0' }] },
    jest: { success: true, testResults: [
      { name: '/app/releaseFixtures.test.ts', assertionResults: titles.map(title => observation(title, ['E1 (0.0.1) upgraded straight to this build'])) },
      ...['releaseFixturesCompleteness', 'releaseFixturesFrozen', 'releasedPersistedSurface', 'persistenceSurface'].map(name =>
        ({ name: `/app/${name}.test.ts`, assertionResults: [observation('checks its recorded surface')] })),
      { name: '/app/cocoDatabaseUpgrade.test.ts', assertionResults: [
        'keeps every proof with its secret, amount, mint, keyset and state',
        'keeps the spendable balance of each mint', 'does not lower a keyset counter',
      ].map(title => observation(title, ['a wallet written by @cashu/coco-expo-sqlite 2.0.0', 'opened by the shipped adapter'])) },
    ] } };
}
test('a green expected-failure preservation assertion cannot certify preservation', () => {
  const { jest, inventory } = inputs(); jest.testResults[0]!.assertionResults[0]!.failing = true;
  const result = inspectUpgradeEvidence(jest, inventory);
  expect(result.status).toBe('inconclusive'); expect(result.losses[0]).toContain('starts, three times');
});
test('complete ordinary observations satisfy only the bounded unit gate', () => {
  const { jest, inventory } = inputs(); expect(inspectUpgradeEvidence(jest, inventory)).toEqual({ status: 'pass', reasons: [], losses: [], skips: [] });
});
test('an epoch omitted from discovery cannot silently disappear', () => {
  const { jest, inventory } = inputs(); inventory.expectedEpochIds.push('E2');
  expect(inspectUpgradeEvidence(jest, inventory).reasons).toContain('Epoch inventory is incomplete or duplicated');
});
test('unemitted gap metadata remains a loss', () => {
  const { jest, inventory } = inputs(); inventory.epochs[0]!.knownGaps.push({ what: 'retired store', followUp: 'F89', why: 'No reader exists' });
  expect(inspectUpgradeEvidence(jest, inventory).losses).toEqual(['E1: retired store [F89: No reader exists]']);
});
test('empty and missing suites cannot pass', () => {
  const { jest, inventory } = inputs(); jest.testResults.pop(); jest.testResults[0]!.assertionResults = [];
  const result = inspectUpgradeEvidence(jest, inventory);
  expect(result.status).toBe('inconclusive'); expect(result.reasons).toContain('Missing suite: cocoDatabaseUpgrade.test.ts'); expect(result.reasons).toContain('No assertions: releaseFixtures.test.ts');
});
test('failed assertions override aggregate success', () => {
  const { jest, inventory } = inputs(); jest.testResults[0]!.assertionResults[0]!.status = 'failed';
  expect(inspectUpgradeEvidence(jest, inventory).status).toBe('fail');
});
test('only the exact writer skip in its expected file is allowed', () => {
  const { jest, inventory } = inputs(); const skip = observation('writes the disk this build leaves after upgrading a fixture'); skip.status = 'pending'; skip.numPassingAsserts = 0;
  jest.testResults[0]!.assertionResults.push(skip); expect(inspectUpgradeEvidence(jest, inventory).status).toBe('pass');
  skip.title = skip.fullName = 'skipped account recovery'; expect(inspectUpgradeEvidence(jest, inventory).status).toBe('inconclusive');
});
test('malformed reports never become passes', () => {
  expect(inspectUpgradeEvidence({}, {})).toEqual({ status: 'inconclusive', reasons: ['Malformed upgrade report or inventory'], losses: [], skips: [] });
});
test('a missing declared surviving fact cannot pass', () => {
  const { jest, inventory } = inputs(); inventory.epochs[0]!.facts.push('the paid provider key');
  expect(inspectUpgradeEvidence(jest, inventory).reasons).toContain('Missing ordinary evidence: E1: keeps the paid provider key');
});
test('a manual throwing guard is not mistaken for an empty suite', () => {
  const { jest, inventory } = inputs(); jest.testResults[2]!.assertionResults[0]!.numPassingAsserts = 0;
  expect(inspectUpgradeEvidence(jest, inventory).status).toBe('pass');
});
