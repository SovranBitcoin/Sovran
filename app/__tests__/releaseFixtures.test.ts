/**
 * @jest-environment node
 */

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Every release epoch, upgraded straight to this build.
 *
 * Each fixture in `releaseFixtures/` is the disk of a used install of one
 * epoch. It is loaded into in-memory AsyncStorage and SecureStore and the
 * current app is started over it three times: the global migrations, the
 * stores the app cannot start without, every persisted store through its real
 * persist options and scoped storage, the keys of every account, and an
 * account switch to read each account's own copies.
 *
 * What Jest cannot do is left to a device: opening the SQLite databases,
 * rendering, and the native keychain. See `releaseFixtures/README.md`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { bytesToHex } from '@noble/hashes/utils.js';

// Mocks storage with in-memory maps; nothing above loads storage.
import { contents, install, launch } from './releaseFixtures/launch';
import type { Launch } from './releaseFixtures/launch';
import { ACCOUNTS, PHRASE } from './releaseFixtures/format';
import type { ReleaseFixture } from './releaseFixtures/format';
import { RELEASE_FIXTURES } from './releaseFixtures';
import { baselineCases, selectCases } from './releaseFixtures/cases';
import { registerUpgradeCases } from './releaseFixtures/upgradeSuite';

// ── The fixed identity ───────────────────────────────────────────────────────

it('uses account keys that match an independent NIP-06 derivation', () => {
  const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(PHRASE));
  ACCOUNTS.forEach((account, index) => {
    const child = root.derive(`m/44'/1237'/${index}'/0/0`);
    expect(bytesToHex(child.publicKey!.slice(1))).toBe(account.pubkey);
    expect(bytesToHex(child.privateKey!)).toBe(account.privateKeyHex);
  });
});

/**
 * `RELEASE_FIXTURE_FILE=E21-0.1.5 bun run test -- __tests__/releaseFixtures.test.ts`
 * runs one fixture file, listed in `index.ts` or not, while it is being written.
 */
const ONE_FILE = process.env.RELEASE_FIXTURE_FILE;
const FIXTURES: readonly ReleaseFixture[] = ONE_FILE
  ? [(require(`./releaseFixtures/${ONE_FILE}`) as { fixture: ReleaseFixture }).fixture]
  : RELEASE_FIXTURES;

// ── Every fixture ────────────────────────────────────────────────────────────

registerUpgradeCases(
  process.env.PERSISTENCE_SELECTION === 'variants'
    ? []
    : selectCases(baselineCases(FIXTURES), {
        epoch: process.env.PERSISTENCE_EPOCH,
        store: process.env.PERSISTENCE_STORE,
        version: process.env.PERSISTENCE_VERSION,
      })
);

// ── The disk an upgrade leaves ───────────────────────────────────────────────

/**
 * `WRITE_UPGRADED_DISK=E19-0.1.2:E20-0.1.4 bun run release-fixture:upgrade`
 * starts this build three times over the first fixture and writes what is then
 * on disk to `releaseFixtures/<second>.upgraded.json`. The fixture of the
 * release being prepared is built on that file, so its rows are the ones this
 * build's own persist and SecureStore code wrote, not a copy of a schema.
 */
const WRITE_DISK = process.env.WRITE_UPGRADED_DISK;

(WRITE_DISK ? it : it.skip)(
  'writes the disk this build leaves after upgrading a fixture',
  async () => {
    const [from, to] = (WRITE_DISK ?? '').split(':');
    expect(to).toMatch(/^E\d+-[\d.]+$/);
    const { fixture } = require(`./releaseFixtures/${from}`) as { fixture: ReleaseFixture };
    const quieted = (['log', 'info', 'debug', 'warn', 'error'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => {})
    );
    install(fixture);
    const launches: Launch[] = [];
    try {
      for (let n = 0; n < 3; n++) launches.push(await launch(fixture));
    } finally {
      quieted.forEach((spy) => spy.mockRestore());
    }
    // The disk is only worth keeping if the upgrade that made it lost nothing:
    // the same things the fixture's own run checks, on every launch.
    const gaps = new Set(fixture.knownGaps.map((known) => known.what));
    const accounts = Object.fromEntries(
      fixture.survives.accounts.map((a) => [a.accountIndex, a.pubkey])
    );
    for (const each of launches) {
      expect(each.rejections).toEqual([]);
      expect(each.unreadStores).toEqual([]);
      expect(each.secureStoreState).toBe('available');
      expect(each.openedPubkeys).toEqual(accounts);
      expect(each.disk.secureStore.user_mnemonic).toBe(fixture.survives.phrase);
      expect(
        each.defaultedRows.filter((row) => ![...gaps].some((what) => row.startsWith(`${what} `)))
      ).toEqual([]);
      for (const fact of fixture.survives.facts) {
        if (!gaps.has(fact.what))
          expect([fact.what, each.facts[fact.what]]).toEqual([fact.what, fact.equals]);
      }
    }
    expect(contents(launches[2].disk)).toEqual(contents(launches[1].disk));
    const last = launches[2];
    // Rows are written parsed so they can be read; `install` turns them back
    // into the same text. Anything that is not a JSON object stays as it was.
    const readable = (value: string): unknown => {
      try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === 'object' && parsed !== null ? parsed : value;
      } catch {
        return value;
      }
    };
    const disk = {
      asyncStorage: Object.fromEntries(
        Object.entries(last.disk.asyncStorage).map(([key, value]) => [key, readable(value)])
      ),
      secureStore: last.disk.secureStore,
      files: last.disk.files,
    };
    const file = join(__dirname, 'releaseFixtures', `${to}.upgraded.json`);
    writeFileSync(file, `${JSON.stringify(disk, null, 2)}\n`);
  },
  120_000
);
