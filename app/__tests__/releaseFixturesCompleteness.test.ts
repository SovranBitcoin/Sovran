/**
 * @jest-environment node
 */

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * The release fixtures cover every build that could be on a phone, and the
 * newest one describes this build.
 *
 * `releaseFixtures.test.ts` proves each fixture upgrades. This proves there is
 * a fixture to run: for every epoch in the persistence map, for every version
 * in the list of store builds, and for the version this tree would ship as.
 * It fails by naming what is missing and how to add it.
 *
 * With `WRITE_RELEASE_FIXTURE=<epoch>` it writes the skeleton of a fixture for
 * the current tree instead (`WRITE_RELEASE_FIXTURE=E21 bun run release-fixture:new`).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ACCOUNTS, PHRASE, PHRASE_HASH, accountKey } from './releaseFixtures/format';
import { NOT_YET_AUTHORED, RELEASE_FIXTURES } from './releaseFixtures';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  };
  return { __esModule: true, default: storage, ...storage };
});

// The file transport of the logger needs the native file system; it holds logs, not user data.
jest.mock('@/shared/lib/loggerFile', () => ({
  applyFileLogging: () => {},
  exportLogFile: async () => null,
  clearLogFile: () => {},
  getLogFileInfo: () => null,
}));

const APP_DIR = join(__dirname, '..');
const FIXTURE_DIR = join(__dirname, 'releaseFixtures');
const PERSISTENCE = join(APP_DIR, '..', 'docs', 'architecture', 'persistence');
const HOW = 'See app/__tests__/releaseFixtures/README.md.';

const newest = RELEASE_FIXTURES[RELEASE_FIXTURES.length - 1];
const epochNumber = (epoch: string) => Number(epoch.slice(1));

/** `| E7 | 0.0.45 | `bab1c891f` | …` rows of the epoch table. */
function epochTable(): { epoch: string; versions: string; commits: string[] }[] {
  const map = readFileSync(join(PERSISTENCE, 'persistence-map.md'), 'utf8');
  // Later tables also begin their rows with an epoch; only this section lists them.
  const section = map.slice(map.indexOf('## Epochs')).split(/\n## /)[0];
  return [...section.matchAll(/^\| (E\d+) \| ([^|]+) \| ([^|]+) \|/gm)].map((row) => ({
    epoch: row[1],
    versions: row[2].trim(),
    commits: [...row[3].matchAll(/`([0-9a-f]{7,40})`/g)].map((commit) => commit[1]),
  }));
}

/** The distinct versions in the list of store builds. */
function storeBuildVersions(): string[] {
  const rows = readFileSync(join(PERSISTENCE, 'store-builds.tsv'), 'utf8').trim().split('\n');
  const column = rows[0].split('\t').indexOf('version');
  return [...new Set(rows.slice(1).map((row) => row.split('\t')[column]))];
}

/** Every persisted store this build declares, with the version it writes. */
function currentSurface(): { name: string; perAccount: boolean; version: number | undefined }[] {
  const { storeRegistryManifest } =
    require('@/shared/lib/persist/storeRegistryManifest') as typeof import('@/shared/lib/persist/storeRegistryManifest');
  const declared = storeRegistryManifest.filter((entry) => entry.persisted);
  for (const file of new Set(declared.map((entry) => entry.file))) {
    require(`@/${file.replace(/\.tsx?$/, '')}`);
  }
  const { persistRegistry } =
    require('@/shared/lib/persist/persistConfig') as typeof import('@/shared/lib/persist/persistConfig');
  return declared
    .map((entry) => ({
      name: entry.name,
      perAccount: entry.profileStorage,
      // A store made per owner on demand registers nothing until it is made.
      version: persistRegistry.find((registered) => registered.name === entry.name)?.version,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const isZustandRow = (value: unknown): value is { state: unknown; version: number } =>
  typeof value === 'object' && value !== null && 'state' in value && 'version' in value;

describe('every epoch has a fixture', () => {
  it('lists each fixture file once, in epoch order', () => {
    const files = readdirSync(FIXTURE_DIR).filter((file) => /^E\d+/.test(file));
    expect(files).toHaveLength(RELEASE_FIXTURES.length);
    const order = RELEASE_FIXTURES.map((fixture) => epochNumber(fixture.epoch));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });

  it('covers every row of the epoch table, read from the same commit', () => {
    const missing: string[] = [];
    for (const row of epochTable()) {
      const fixture = RELEASE_FIXTURES.find((each) => each.epoch === row.epoch);
      if (!fixture) {
        if (!NOT_YET_AUTHORED.includes(row.epoch)) {
          missing.push(
            `${row.epoch} (${row.versions}, ${row.commits.join(' or ')}) has no fixture`
          );
        }
      } else if (
        !row.commits.some((c) => c.startsWith(fixture.commit) || fixture.commit.startsWith(c))
      ) {
        missing.push(
          `${row.epoch}: the fixture was read from ${fixture.commit}, the map says ${row.commits.join(' or ')}`
        );
      }
    }
    for (const fixture of RELEASE_FIXTURES) {
      if (!epochTable().some((row) => row.epoch === fixture.epoch)) {
        missing.push(`${fixture.epoch} is not a row of the epoch table in persistence-map.md`);
      }
    }
    expect({ problems: missing, how: HOW }).toEqual({ problems: [], how: HOW });
  });

  it('has no epoch waiting to be written', () => {
    // An epoch named here is one whose upgrade nothing in this suite runs.
    expect(NOT_YET_AUTHORED).toEqual([]);
  });
});

describe('every build that could be on a phone falls in a fixture', () => {
  const claimed = new Set(RELEASE_FIXTURES.flatMap((fixture) => fixture.versions));

  it('claims every version in store-builds.tsv', () => {
    const unclaimed = storeBuildVersions().filter((version) => !claimed.has(version));
    // A version lands here when `epochs.py builds` records a new release. Add
    // it to the fixture whose surface it shares, or write a fixture for it.
    expect({ unclaimed, how: HOW }).toEqual({ unclaimed: [], how: HOW });
  });

  it('claims the version this tree would ship as', () => {
    const { expo } = JSON.parse(readFileSync(join(APP_DIR, 'app.json'), 'utf8')) as {
      expo: { version: string };
    };
    // Bumping the version without a fixture is how a release ships untested.
    expect({ version: expo.version, claimed: claimed.has(expo.version), how: HOW }).toEqual({
      version: expo.version,
      claimed: true,
      how: HOW,
    });
    expect(newest.versions).toContain(expo.version);
  });

  it('claims no version the build list and this tree do not know', () => {
    const { expo } = JSON.parse(readFileSync(join(APP_DIR, 'app.json'), 'utf8')) as {
      expo: { version: string };
    };
    const known = new Set([...storeBuildVersions(), expo.version]);
    expect([...claimed].filter((version) => !known.has(version))).toEqual([]);
  });
});

describe(`the newest fixture (${newest.epoch}) describes this build`, () => {
  const surface = currentSurface();
  const active = newest.survives.accounts.find(
    (account) => account.accountIndex === newest.survives.activeAccountIndex
  );
  const keyOf = (store: { name: string; perAccount: boolean }) =>
    store.perAccount && active ? accountKey(store.name, active.pubkey) : store.name;

  it('has a row for every persisted store, at the version this build writes', () => {
    const problems: string[] = [];
    for (const store of surface) {
      const row = newest.asyncStorage[keyOf(store)];
      if (!isZustandRow(row)) {
        problems.push(`${store.name}: no row under ${keyOf(store)}`);
      } else if (store.version !== undefined && row.version !== store.version) {
        problems.push(
          `${store.name}: the fixture holds version ${row.version}, this build writes ${store.version}`
        );
      }
    }
    // The durable surface moved. If the newest fixture's release has not
    // shipped, update it; if it has, this is a new epoch and needs its own.
    expect({ problems, how: HOW }).toEqual({ problems: [], how: HOW });
  });

  it('has no row for a store this build does not have, unless it says the row is kept', () => {
    const names = new Set(surface.map((store) => store.name));
    const strays = Object.entries(newest.asyncStorage)
      .filter(([key, value]) => isZustandRow(value) && !names.has(key.split(':profile:')[0]))
      .map(([key]) => key)
      .filter((key) => !newest.survives.keptAsyncStorage.includes(key));
    expect(strays).toEqual([]);
  });
});

describe('each fixture is well formed', () => {
  it.each(RELEASE_FIXTURES.map((fixture) => [fixture.epoch, fixture] as const))(
    '%s',
    (_epoch, fixture) => {
      const whats = fixture.survives.facts.map((fact) => fact.what);
      expect(new Set(whats).size).toBe(whats.length);
      expect(fixture.versions.length).toBeGreaterThan(0);
      expect(fixture.commit).toMatch(/^[0-9a-f]{7,40}$/);
      expect(
        fixture.survives.accounts.some(
          (a) => a.accountIndex === fixture.survives.activeAccountIndex
        )
      ).toBe(true);
      for (const key of fixture.survives.keptAsyncStorage)
        expect(fixture.asyncStorage).toHaveProperty([key]);
      for (const key of fixture.survives.keptSecureStore)
        expect(fixture.secureStore).toHaveProperty([key]);
      // A known gap needs somewhere its closing is tracked, or a reason it never will be.
      for (const known of fixture.knownGaps) {
        expect(known.followUp).toMatch(/^(F\d+|accepted)$/);
        expect(known.why.length).toBeGreaterThan(10);
      }
    }
  );
});

// ── Skeleton writer ──────────────────────────────────────────────────────────

const WRITE = process.env.WRITE_RELEASE_FIXTURE;

(WRITE ? it : it.skip)('writes the skeleton of a fixture for this build', () => {
  const epoch = WRITE!;
  expect(epoch).toMatch(/^E\d+$/);
  const { expo } = JSON.parse(readFileSync(join(APP_DIR, 'app.json'), 'utf8')) as {
    expo: { version: string };
  };
  const { persistRegistry } =
    require('@/shared/lib/persist/persistConfig') as typeof import('@/shared/lib/persist/persistConfig');
  const file = join(FIXTURE_DIR, `${epoch}-${expo.version}.ts`);
  if (existsSync(file)) throw new Error(`${file} exists. Edit it, or delete it first.`);

  const account = ACCOUNTS[0];
  const rows: string[] = [];
  const defaults: string[] = [];
  for (const store of currentSurface()) {
    if (store.name === 'profile-store') continue;
    const registered = persistRegistry.find((entry) => entry.name === store.name);
    const project = registered?.partialize as ((state: unknown) => unknown) | undefined;
    const state = project && registered?.store ? project(registered.store.getInitialState()) : {};
    const key = store.perAccount ? `[accountKey('${store.name}', A0)]` : `'${store.name}'`;
    rows.push(`    ${key}: zustandRow(${store.version ?? 1}, ${JSON.stringify(state)}),`);
    defaults.push(store.name);
  }
  const profileVersion = persistRegistry.find((entry) => entry.name === 'profile-store')?.version;

  writeFileSync(
    file,
    `import { ACCOUNTS, PHRASE, PHRASE_HASH, accountKey, zustandRow } from './format';
import type { ReleaseFixture } from './format';

const A0 = ACCOUNTS[0].pubkey;

/**
 * ${epoch}: ${expo.version}. Written by \`bun run release-fixture:new\` from the store
 * registry of the working tree; set \`commit\` to the release commit when it is cut.
 *
 * Every row below holds the store's defaults. Before the release: give each
 * store the user would miss a realistic value, add a fact that reads it back,
 * and take the store out of \`defaultRows\`.
 */
export const fixture: ReleaseFixture = {
  epoch: '${epoch}',
  versions: ['${expo.version}'],
  commit: '0000000',
  surface: 'TODO: what changed on disk since the previous epoch',
  asyncStorage: {
    'profile-store': zustandRow(${profileVersion ?? 1}, {
      activeAccountIndex: 0,
      profiles: [{ accountIndex: 0, pubkey: A0, addedAt: 1 }],
    }),
${rows.join('\n')}
  },
  secureStore: {
    user_mnemonic: PHRASE,
    derived_keys_0: JSON.stringify({
      npub: ACCOUNTS[0].npub,
      nsec: ACCOUNTS[0].nsec,
      pubkey: A0,
      privateKeyHex: ACCOUNTS[0].privateKeyHex,
      mnemonicHash: PHRASE_HASH,
    }),
    cashu_mnemonic_0: JSON.stringify({ value: ACCOUNTS[0].cashuMnemonic, mnemonicHash: PHRASE_HASH }),
  },
  sqliteDatabases: ['coco.db', 'nostr'],
  survives: {
    phrase: PHRASE,
    activeAccountIndex: 0,
    accounts: [{ accountIndex: 0, pubkey: A0 }],
    facts: [],
    keptAsyncStorage: [],
    keptSecureStore: ['user_mnemonic'],
  },
  defaultRows: ${JSON.stringify(defaults)},
  knownGaps: [],
};
`
  );
  // eslint-disable-next-line no-console -- the command's one line of output
  console.log(
    `Wrote ${file} (${account.pubkey.slice(0, 8)}…, ${defaults.length} stores). Add it to index.ts.`
  );
  expect(PHRASE_HASH).toHaveLength(16);
  expect(PHRASE.split(' ')).toHaveLength(12);
});
