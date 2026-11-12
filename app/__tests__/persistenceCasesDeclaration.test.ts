/** @jest-environment node */
import { baselineCases, CASE_DEFINITIONS, compileCase, selectCases } from './releaseFixtures/cases';
import { RELEASE_FIXTURES } from './releaseFixtures';

it('includes every frozen historical install without losing identity, byte-retention or known-gap assertions', () => {
  expect(baselineCases().map((item) => item.fixture)).toEqual(RELEASE_FIXTURES);
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

it('can select a retired store whose only assertion is retaining its historical bytes', () => {
  const selected = selectCases(baselineCases(), { store: 'persist:SOVRAN' });
  expect(selected.map((item) => item.fixture.epoch)).toContain('E1');
});

it('rejects a preserve declaration that changes one account but asserts another', () => {
  const fixture = RELEASE_FIXTURES[18];
  const account0 = fixture.survives.accounts.find((account) => account.accountIndex === 0);
  const account1 = fixture.survives.accounts.find((account) => account.accountIndex === 1);
  if (!account0 || !account1) throw new Error('The fixture needs both derived accounts');
  const input = {
    id: 'wrong-account',
    epoch: 'E19',
    store: 'example-store',
    source: {
      commit: 'd9ad12c4b',
      path: 'historical-writer.ts',
      reason: 'Counterexample for cross-account preservation assertions.',
    },
    storageKey: `example-store:profile:${account0.pubkey}`,
    currentKey: `example-store:profile:${account1.pubkey}`,
    accountIndex: 1,
    preserve: { amount: 29 },
  };
  const raw = {
    ...fixture,
    asyncStorage: {
      [input.storageKey]: { version: 1, state: { amount: 17 } },
      [input.currentKey]: { version: 1, state: { amount: 29 } },
    },
  };
  expect(() => compileCase(input, [raw])).toThrow('does not belong');
});
