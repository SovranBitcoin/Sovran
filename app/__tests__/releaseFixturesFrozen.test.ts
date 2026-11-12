/**
 * @jest-environment node
 */

/**
 * A released fixture is the disk of a release that is on people's phones. If a
 * change makes one fail, the fixture is right and the change needs a
 * migration; editing the stored data would make the failure go away and the
 * loss ship. This pins the stored data of every released fixture by hash.
 *
 * The newest fixture may evolve only while unreleased and uninstalled. Once a
 * published observation or installable build names its version, it is pinned too.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RELEASE_FIXTURES } from './releaseFixtures';
import published from './releaseFixtures/published.json';
import { catalogSchema, easBuilds } from '../scripts/persistence/releases';
import { fixturesRequiringFreeze } from '../scripts/persistence/freeze';
import { FROZEN_FIXTURE_DATA } from './releaseFixtures/frozen';
import type { ReleaseFixture } from './releaseFixtures/format';

/** JSON with object keys in order, so a reordered file hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** What the release left on the phone: nothing about how the runner checks it. */
function storedDataHash(fixture: ReleaseFixture): string {
  const { asyncStorage, secureStore, sqliteDatabases, files } = fixture;
  // Fixtures pinned before a fixture could hold files have none, and hash as they did.
  return createHash('sha256')
    .update(canonical({ asyncStorage, secureStore, sqliteDatabases, ...(files ? { files } : {}) }))
    .digest('hex');
}

const released = fixturesRequiringFreeze(RELEASE_FIXTURES, [
  ...catalogSchema.parse(published).observations,
  ...easBuilds(
    readFileSync(join(__dirname, '../../docs/architecture/persistence/store-builds.tsv'), 'utf8')
  ),
]);

it.each(released.map((fixture) => [fixture.epoch, fixture] as const))(
  '%s holds the data it was released with',
  (epoch, fixture) => {
    const pinned = FROZEN_FIXTURE_DATA[epoch];
    const actual = storedDataHash(fixture);
    if (pinned === undefined) {
      throw new Error(
        `${epoch} is released and not pinned. Add to releaseFixtures/frozen.ts:\n  ${epoch}: '${actual}',`
      );
    }
    if (pinned !== actual) {
      throw new Error(
        `The stored data of ${epoch} changed (now ${actual}). A released fixture is frozen: ` +
          'if a schema change made it fail, the change needs a migration. Only when the ' +
          'fixture misstated what the release wrote may its data and its hash change, in a ' +
          'commit that cites the old source.'
      );
    }
  }
);

it('pins nothing that is not a released fixture', () => {
  const epochs = new Set<string>(released.map((fixture) => fixture.epoch));
  expect(Object.keys(FROZEN_FIXTURE_DATA).filter((epoch) => !epochs.has(epoch))).toEqual([]);
});
