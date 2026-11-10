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
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { bytesToHex } from '@noble/hashes/utils.js';

// Mocks storage with in-memory maps; nothing above loads storage.
import { contents, install, launch, rejectionsOfLastLaunchSoFar } from './releaseFixtures/launch';
import type { Launch } from './releaseFixtures/launch';
import { ACCOUNTS, NAMED_CHECKS, PHRASE } from './releaseFixtures/format';
import type { ReleaseFixture } from './releaseFixtures/format';
import { RELEASE_FIXTURES } from './releaseFixtures';

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

describe.each(
  FIXTURES.map((fixture) => [fixture.epoch, fixture.versions.join(', '), fixture] as const)
)('%s (%s) upgraded straight to this build', (_epoch, _versions, fixture) => {
  const { survives } = fixture;
  const gap = (what: string) => fixture.knownGaps.find((known) => known.what === what);
  /** `it`, or `it.failing` for an expectation the fixture records as a known gap. */
  const check = (what: string) => (gap(what) ? it.failing : it);
  const title = (what: string) => {
    const known = gap(what);
    return known ? `keeps ${what} [known gap ${known.followUp}: ${known.why}]` : `keeps ${what}`;
  };

  const launches: Launch[] = [];
  const quieted: jest.SpyInstance[] = [];
  let startupError: unknown;
  let startupRejections: string[] = [];

  beforeAll(async () => {
    // The logger prints every entry; a launch makes hundreds.
    for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
      quieted.push(jest.spyOn(console, method).mockImplementation(() => {}));
    }
    install(fixture);
    try {
      // Three cold starts. An install from before accounts existed finishes
      // moving its stores on the second, once account 0 has its row.
      for (let n = 0; n < 3; n++) launches.push(await launch(fixture));
    } catch (error) {
      startupError = error;
      startupRejections = rejectionsOfLastLaunchSoFar();
    }
  }, 120_000);

  afterAll(() => quieted.forEach((spy) => spy.mockRestore()));

  it('starts, three times over, without stopping on a failure or recovery screen', () => {
    expect({ error: startupError, rejections: startupRejections }).toEqual({
      error: undefined,
      rejections: [],
    });
    expect(launches).toHaveLength(3);
    for (const each of launches) {
      expect(each.unreadStores).toEqual([]);
      expect(each.secureStoreState).toBe('available');
    }
  });

  it('keeps the phrase and makes no new one', () => {
    expect(survives.phrase).toBe(PHRASE);
    for (const each of launches) expect(each.disk.secureStore.user_mnemonic).toBe(survives.phrase);
  });

  it('opens every account with the key it had, and keeps the same account selected', () => {
    const expected = Object.fromEntries(survives.accounts.map((a) => [a.accountIndex, a.pubkey]));
    for (const each of launches) {
      expect(each.openedPubkeys).toEqual(expected);
      expect(each.activeAccountIndex).toBe(survives.activeAccountIndex);
      const saved = JSON.parse(each.disk.asyncStorage['profile-store']) as {
        state: { profiles: { accountIndex: number; pubkey: string }[] };
      };
      expect(
        Object.fromEntries(saved.state.profiles.map((p) => [p.accountIndex, p.pubkey]))
      ).toEqual(expected);
    }
  });

  if (survives.facts.length > 0) {
    for (const fact of survives.facts) {
      check(fact.what)(title(fact.what), () => {
        expect(launches).toHaveLength(3);
        for (const each of launches) expect(each.facts[fact.what]).toEqual(fact.equals);
      });
    }
  }

  it('turns down no saved blob and sets none aside as unreadable', () => {
    expect(launches).toHaveLength(3);
    for (const each of launches) {
      expect(each.rejections).toEqual([]);
      const keys = [...Object.keys(each.disk.asyncStorage), ...Object.keys(each.disk.secureStore)];
      expect(keys.filter((key) => key.includes(':unreadable'))).toEqual([]);
    }
  });

  it('loads no store that held data as its defaults', () => {
    expect(launches).toHaveLength(3);
    const accepted = fixture.knownGaps.map((known) => known.what);
    const lost = (each: Launch) =>
      each.defaultedRows.filter((row) => !accepted.some((what) => row.startsWith(`${what} `)));
    for (const each of launches) expect(lost(each)).toEqual([]);
  });

  it('deletes nothing the fixture says must be kept', () => {
    expect(launches).toHaveLength(3);
    for (const each of launches) {
      for (const key of survives.keptAsyncStorage) {
        const was = fixture.asyncStorage[key];
        expect(each.disk.asyncStorage[key]).toBe(
          typeof was === 'string' ? was : JSON.stringify(was)
        );
      }
      for (const key of survives.keptSecureStore) {
        expect(each.disk.secureStore[key]).toBe(fixture.secureStore[key]);
      }
    }
  });

  it('changes nothing on a later launch', () => {
    expect(launches).toHaveLength(3);
    const [first, second, third] = launches;
    expect(contents(third.disk)).toEqual(contents(second.disk));
    // An install that already had its account list is finished after one launch.
    if ('profile-store' in fixture.asyncStorage)
      expect(contents(second.disk)).toEqual(contents(first.disk));
  });

  it('names only databases the current app opens for these accounts', () => {
    const manager = readFileSync(join(__dirname, '..', 'shared/lib/cashu/manager.ts'), 'utf8');
    expect(manager).toContain("accountIndex === 0 ? 'coco.db' : `coco-${accountIndex}.db`");
    const opened = survives.accounts.flatMap(({ accountIndex }) =>
      accountIndex === 0
        ? ['coco.db', 'nostr']
        : [`coco-${accountIndex}.db`, `nostr-${accountIndex}`]
    );
    for (const name of fixture.sqliteDatabases) expect(opened).toContain(name);
  });

  const { reduxEcash } = survives;
  if (reduxEcash) {
    check(NAMED_CHECKS.reduxProofs)(title(NAMED_CHECKS.reduxProofs), () => {
      const { readLegacyEcash } = require('wallet') as typeof import('wallet');
      const row = fixture.asyncStorage['persist:SOVRAN'];
      const found = readLegacyEcash(typeof row === 'string' ? row : JSON.stringify(row));
      expect(found.kind).toBe('read');
      if (found.kind !== 'read') return;
      const perMint = new Map<string, number>();
      for (const group of found.groups) {
        const amount = group.proofs.reduce((sum, proof) => sum + proof.amount, 0);
        perMint.set(group.mintUrl, (perMint.get(group.mintUrl) ?? 0) + amount);
      }
      expect({ skipped: found.skipped, perMint: Object.fromEntries(perMint) }).toEqual({
        skipped: 0,
        perMint: Object.fromEntries(reduxEcash.map((held) => [held.mintUrl, held.amount])),
      });
    });
  }
});

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
