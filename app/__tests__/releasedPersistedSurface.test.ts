/**
 * @jest-environment node
 *
 * What v0.1.3 wrote to disk, frozen. A user upgrading from that release has
 * blobs under these store names, at these versions, under a global or a
 * per-profile key. If the current app no longer has a store by that name,
 * reads it from the other kind of key, or has gone backwards in version, that
 * user's data is silently left behind.
 *
 * The fixture was read from the v0.1.3 tag (d9ad12c4b) and must never be
 * regenerated from the working tree. `releaseUpgrade.test.ts` checks that the
 * contents of the blobs survive; this checks that the blobs are still found.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import released from './fixtures/persisted-surface-v0.1.3.json';
import { storeRegistryManifest } from '@/shared/lib/persist/storeRegistryManifest';

const APP_DIR = join(__dirname, '..');

type Declared = (typeof storeRegistryManifest)[number];

/** The `version` a store declares beside its storage name, or 1 (persistConfig's default). */
function declaredVersion(entry: Declared): number {
  const source = readFileSync(join(APP_DIR, entry.file), 'utf8');
  // The name appears twice: in `defineStore` and in `persistConfig`. The
  // version sits in the persist options, so read from the last one.
  const at = source.lastIndexOf(`name: '${entry.name}'`);
  const version = /version:\s*(\w+)/.exec(source.slice(at, at + 900));
  if (!version) return 1;
  if (/^\d+$/.test(version[1])) return Number(version[1]);
  // A named constant, e.g. `version: PROFILE_STORE_PERSIST_VERSION`.
  const constant = new RegExp(`const ${version[1]} = (\\d+)`).exec(source);
  if (!constant) throw new Error(`Cannot resolve the version of ${entry.name}`);
  return Number(constant[1]);
}

describe('stores released in v0.1.3 are still found after an upgrade', () => {
  const current = new Map<string, Declared>();
  for (const entry of storeRegistryManifest) {
    // A name can be declared twice (a store and its query cache); the
    // persisted declaration is the one an upgrade reads.
    if (entry.persisted || !current.has(entry.name)) current.set(entry.name, entry);
  }

  it.each(Object.entries(released.stores))('%s', (name, was) => {
    const now = current.get(name);

    expect(now).toBeDefined();
    expect(now!.persisted).toBe(true);
    // A blob written under `<name>:profile:<pubkey>` is only found by a store
    // that still reads a per-profile key, and a global one by a global store.
    expect(now!.profileStorage).toBe(was.profileScoped);
    // A lower version would send the released blob through no migration at all.
    expect(declaredVersion(now!)).toBeGreaterThanOrEqual(was.version);
  });

  it('covers every store the release shipped', () => {
    expect(Object.keys(released.stores)).toHaveLength(34);
  });
});

describe('keys and databases released in v0.1.3 are still read', () => {
  const read = (file: string) => readFileSync(join(APP_DIR, file), 'utf8');

  it.each(released.secureStoreKeys)('SecureStore key %s', (key) => {
    // Seeds and keys live under these names. A renamed key is a wallet the
    // upgraded app cannot open.
    expect(read('shared/lib/nostr/secureStorage.ts')).toContain(`'${key}'`);
  });

  it.each(released.sourcePins)('$what', ({ file, text }) => {
    expect(read(file)).toContain(text);
  });
});
