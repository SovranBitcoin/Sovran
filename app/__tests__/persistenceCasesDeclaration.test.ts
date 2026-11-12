/** @jest-environment node */
import { baselineCases, CASE_DEFINITIONS, compileCase, selectCases } from './releaseFixtures/cases';
import { RELEASE_FIXTURES } from './releaseFixtures';

it('includes every frozen historical install without losing identity, byte-retention or known-gap assertions', () => {
  expect(baselineCases().map((item) => item.fixture)).toEqual(RELEASE_FIXTURES);
  expect(baselineCases()).toHaveLength(20);
});
it('clones only declared rows and preserves unrelated facts and the frozen original', () => {
  const definition = CASE_DEFINITIONS[0];
  const before = JSON.stringify(RELEASE_FIXTURES);
  const result = compileCase(definition);
  expect(result.fixture.asyncStorage['wallet-lifecycle']).toMatchObject({
    state: { restoreStatus: 'pending' },
  });
  expect(result.fixture.survives.accounts).toEqual(RELEASE_FIXTURES[18].survives.accounts);
  expect(result.fixture.survives.facts.filter((f) => f.store !== 'wallet-lifecycle')).toEqual(
    RELEASE_FIXTURES[18].survives.facts.filter((f) => f.store !== 'wallet-lifecycle')
  );
  expect(JSON.stringify(RELEASE_FIXTURES)).toBe(before);
});
it('refuses to hide unrelated facts, use unknown paths, or accidentally run no tests', () => {
  const declaration = CASE_DEFINITIONS[0];
  expect(() => compileCase({ ...declaration, replaces: ['absent'] })).toThrow(
    'unrelated or absent'
  );
  expect(() =>
    compileCase({
      ...declaration,
      rows: [
        {
          storage: 'asyncStorage',
          key: 'wallet-lifecycle',
          edits: [{ kind: 'remove', path: ['state', 'absent'] }],
        },
      ],
    })
  ).toThrow('does not exist');
  expect(() => selectCases(baselineCases(), { version: '9.9.9' })).toThrow('No persistence cases');
});
