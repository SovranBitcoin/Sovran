// The newest fixture seeds mint rows under the key the stores look them up by
// (`normalizeMintUrlKey`), so the upgrade suite reads the rows it seeded.
import { fixture } from './releaseFixtures/E20-0.1.4';
import { normalizeMintUrlKey } from '@/shared/lib/url';

jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return { log: sink, cashuLog: sink, storeLog: sink };
});

it('keys the mint rows 0.1.4 added by normalized mint URL', () => {
  const keyed = fixture.survives.facts.filter(
    (fact) =>
      (fact.store === 'mint-history-store' || fact.path.includes('auditObservations')) &&
      fact.path[0] === 'byMintUrl'
  );
  expect(keyed.length).toBeGreaterThanOrEqual(2);
  for (const fact of keyed) {
    const key = String(fact.path[1]);
    expect(key).toBe(normalizeMintUrlKey(key));
  }
});
