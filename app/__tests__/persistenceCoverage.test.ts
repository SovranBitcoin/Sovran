/** @jest-environment node */
import { corpusCoverage } from '../scripts/persistence/coverage';
import { fixture } from './releaseFixtures/E19-0.1.2';
import { accountKey, ACCOUNTS, zustandRow } from './releaseFixtures/format';

it('does not mistake another account’s assertion for coverage of this saved row', () => {
  const result = corpusCoverage({
    ...fixture,
    asyncStorage: {
      [accountKey('example-store', ACCOUNTS[0].pubkey)]: zustandRow(1, { amount: 17 }),
      [accountKey('example-store', ACCOUNTS[1].pubkey)]: zustandRow(1, { amount: 29 }),
    },
    survives: {
      ...fixture.survives,
      keptAsyncStorage: [],
      facts: [
        {
          what: 'account one amount',
          store: 'example-store',
          accountIndex: 1,
          path: ['amount'],
          equals: 29,
        },
      ],
    },
  });
  expect(result[0].fields).toEqual([{ path: ['amount'], evidence: 'no-direct-field-fact' }]);
  expect(result[1].fields).toEqual([{ path: ['amount'], evidence: 'named-store-fact' }]);
});
