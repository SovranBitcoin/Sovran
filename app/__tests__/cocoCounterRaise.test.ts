/**
 * @jest-environment node
 *
 * The wallet's counter for a keyset must never go down: outputs derived from
 * a counter the mint has already signed are refused, and the receive behind
 * them stalls. The wrapper around Coco's counter repository used to read the
 * saved counter and then write a higher one. A transaction runs on its own
 * connection, so it could save a higher counter between those two steps and
 * have it lowered.
 *
 * The write is now one statement that keeps the larger value. It names Coco's
 * table, so it is run here against a wallet database written by the shipped
 * Coco adapter (SQLite here is Node's, see `cocoDatabases/expoSqliteOnNode.ts`).
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ExpoSqliteRepositories } from '@cashu/coco-expo-sqlite';

import {
  createSovranCocoRepositories,
  raiseCounterStatement,
} from '@/shared/lib/cashu/cocoRepositories';

import { ExpoSqliteOnNode } from './cocoDatabases/expoSqliteOnNode';

jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// The database written by the adapter version this tree installs. A Coco
// upgrade needs a new database first (`cocoDatabases/README.md`), and until it
// exists this fails on the missing file.
const ADAPTER_VERSION = (
  JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  }
).dependencies['@cashu/coco-expo-sqlite'];
const FIXTURE = join(__dirname, 'cocoDatabases', `cashu-coco-expo-sqlite@${ADAPTER_VERSION}.db`);
const MINT = 'https://counter.test.example';
const KEYSET = '00counterkeyset';

let folder: string;
let database: ExpoSqliteOnNode;
let coco: ExpoSqliteRepositories;

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'coco-counter-'));
  const file = join(folder, 'coco.db');
  copyFileSync(FIXTURE, file);
  database = new ExpoSqliteOnNode(file);
  coco = new ExpoSqliteRepositories({ database: database as never });
  await coco.init();
});

afterEach(() => {
  database.native.close();
  rmSync(folder, { recursive: true, force: true });
});

const saved = async () => (await coco.counterRepository.getCounter(MINT, KEYSET))?.counter ?? null;
const wrapped = () =>
  createSovranCocoRepositories(coco, {
    raiseCounter: async (mintUrl, keysetId, counter) => {
      await database.runAsync(raiseCounterStatement, [mintUrl, keysetId, counter]);
    },
  });

it('creates the counter, raises it, and never lowers it', async () => {
  const counters = wrapped().counterRepository;
  await counters.setCounter(MINT, KEYSET, 4);
  expect(await saved()).toBe(4);
  await counters.setCounter(MINT, KEYSET, 9);
  expect(await saved()).toBe(9);
  await counters.setCounter(MINT, KEYSET, 3);
  expect(await saved()).toBe(9);
});

it('does not lower a counter that was saved after the caller read a lower one', async () => {
  const counters = wrapped().counterRepository;
  // The caller read the counter while it was still unset...
  expect((await counters.getCounter(MINT, KEYSET))?.counter).toBe(0);
  // ...a transaction then saved and committed 9 on its own connection...
  await coco.counterRepository.setCounter(MINT, KEYSET, 9);
  // ...and the caller now writes what it worked out from the old read.
  await counters.setCounter(MINT, KEYSET, 3);
  expect(await saved()).toBe(9);
});

it('leaves the counters the shipped adapter wrote as they were', async () => {
  const before = await database.getAllAsync<{ keysetId: string; counter: number }>(
    'SELECT keysetId, counter FROM coco_cashu_counters ORDER BY keysetId'
  );
  expect(before.length).toBeGreaterThan(0);
  const counters = wrapped().counterRepository;
  for (const row of await database.getAllAsync<{ mintUrl: string; keysetId: string }>(
    'SELECT mintUrl, keysetId FROM coco_cashu_counters'
  )) {
    await counters.setCounter(row.mintUrl, row.keysetId, 1);
  }
  expect(
    await database.getAllAsync(
      'SELECT keysetId, counter FROM coco_cashu_counters ORDER BY keysetId'
    )
  ).toEqual(before);
});

describe('a transaction that commits between the read and the write', () => {
  /** Coco's repositories, with a transaction committing 9 right after the counter is read. */
  const withCommitAfterRead = () => ({
    ...coco,
    counterRepository: {
      getCounter: async (mintUrl: string, keysetId: string) => {
        const read = await coco.counterRepository.getCounter(mintUrl, keysetId);
        await coco.counterRepository.setCounter(mintUrl, keysetId, 9);
        return read;
      },
      setCounter: coco.counterRepository.setCounter.bind(coco.counterRepository),
    },
  });

  it('lowered the counter while the write was a read and then a write', async () => {
    // The fault, kept visible: without the one-statement write the wrapper
    // still reads and then writes, and this is what that allows.
    const counters = createSovranCocoRepositories(withCommitAfterRead() as never).counterRepository;
    await counters.setCounter(MINT, KEYSET, 3);
    expect(await saved()).toBe(3);
  });

  it('cannot lower it now: the write is one statement and keeps the larger value', async () => {
    const counters = createSovranCocoRepositories(withCommitAfterRead() as never, {
      raiseCounter: async (mintUrl, keysetId, counter) => {
        // The transaction commits at the last moment before the statement runs.
        await coco.counterRepository.setCounter(mintUrl, keysetId, 9);
        await database.runAsync(raiseCounterStatement, [mintUrl, keysetId, counter]);
      },
    }).counterRepository;
    await counters.setCounter(MINT, KEYSET, 3);
    expect(await saved()).toBe(9);
  });
});
