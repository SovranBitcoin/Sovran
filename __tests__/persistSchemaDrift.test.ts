/* eslint-disable import/first */

// Persisted-schema drift guard. Importing a store registers its {name, version,
// schema} via persistConfig; this test snapshots each schema's JSON shape keyed
// by version. When a store's persisted schema changes:
//   - additive change  → update the snapshot (`jest -u`), done.
//   - non-additive change (rename/remove/tighten a field) → the diff is your
//     prompt to bump `version` + add a `migrate`, or you silently drop the
//     durable blob on next launch (createMergeWithSchema rejects → defaults).

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

import { z } from 'zod';

// Import the durable / data-loss-critical stores so they self-register. These
// hold data that is NOT cheaply refetchable, so a silent schema-drift drop is
// real user-data loss.
import '@/shared/stores/profile/transactionAnnotationStore';
import '@/shared/stores/profile/ownedMediaStore';
import '@/shared/stores/profile/nostrSocialStore';
import '@/shared/stores/profile/dataMigrationStore';
import '@/shared/stores/global/kymMintStore';
import '@/shared/stores/profile/mintStore';

import { persistRegistry } from '@/shared/lib/persist/persistConfig';

describe('persisted schema drift', () => {
  it('registered at least the durable stores under test', () => {
    expect(persistRegistry.length).toBeGreaterThanOrEqual(6);
  });

  it.each(
    [...persistRegistry]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => [e.name, e] as const)
  )('%s schema matches the golden snapshot for its version', (_name, entry) => {
    const shape = z.toJSONSchema(entry.schema, { unrepresentable: 'any' });
    expect({ name: entry.name, version: entry.version, shape }).toMatchSnapshot(entry.name);
  });
});
