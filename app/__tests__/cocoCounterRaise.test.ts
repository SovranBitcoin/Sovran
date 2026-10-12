/**
 * @jest-environment node
 *
 * The wallet's counter for a keyset must never go down: outputs derived from
 * a counter the mint has already signed are refused, and the receive behind
 * them stalls. The wrapper around Coco's counter repository reads the saved
 * counter and writes a higher one. On the root connection those were two
 * separate statements, and a transaction could start, save a higher counter
 * and commit between them, to have it lowered by the write that followed.
 *
 * The read and the write now run inside one of Coco's own transactions, which
 * waits its turn behind any other and lets nothing in between. This runs
 * against a wallet database written by the installed Coco adapter (SQLite here
 * is Node's, see `cocoDatabases/expoSqliteOnNode.ts`).
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ExpoSqliteRepositories } from '@cashu/coco-expo-sqlite';

import { createSovranCocoRepositories } from '@/shared/lib/cashu/cocoRepositories';

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

it('creates the counter, raises it, and never lowers it', async () => {
  const counters = createSovranCocoRepositories(coco).counterRepository;
  await counters.setCounter(MINT, KEYSET, 4);
  expect(await saved()).toBe(4);
  await counters.setCounter(MINT, KEYSET, 9);
  expect(await saved()).toBe(9);
  await counters.setCounter(MINT, KEYSET, 3);
  expect(await saved()).toBe(9);
});

it('leaves the counters the shipped adapter wrote as they were', async () => {
  const read = () =>
    database.getAllAsync<{ mintUrl: string; keysetId: string; counter: number }>(
      'SELECT mintUrl, keysetId, counter FROM coco_cashu_counters ORDER BY keysetId'
    );
  const before = await read();
  expect(before.length).toBeGreaterThan(0);
  const counters = createSovranCocoRepositories(coco).counterRepository;
  for (const row of before) await counters.setCounter(row.mintUrl, row.keysetId, 1);
  expect(await read()).toEqual(before);
});

describe('a transaction that commits between the read and the write', () => {
  /**
   * Coco's repositories, with another writer saving 9 on the root connection
   * right after the counter is read there: what a transaction committing in
   * that gap amounts to.
   */
  const withWriterAfterRootRead = () =>
    Object.assign(Object.create(coco) as ExpoSqliteRepositories, {
      counterRepository: {
        getCounter: async (mintUrl: string, keysetId: string) => {
          const read = await coco.counterRepository.getCounter(mintUrl, keysetId);
          await coco.counterRepository.setCounter(mintUrl, keysetId, 9);
          return read;
        },
        setCounter: coco.counterRepository.setCounter.bind(coco.counterRepository),
      },
    });

  it('cannot lower the counter: a root write reads and writes inside one transaction', async () => {
    // The root repository is never read for the decision, so a writer that
    // waits for a root read never gets its gap; and whatever is saved when the
    // transaction runs is what the write is compared with.
    const counters = createSovranCocoRepositories(withWriterAfterRootRead()).counterRepository;
    await coco.counterRepository.setCounter(MINT, KEYSET, 9);
    await counters.setCounter(MINT, KEYSET, 3);
    expect(await saved()).toBe(9);
  });

  it('runs a root write through a transaction, and a write inside one without a second', async () => {
    const begun = jest.spyOn(coco, 'withTransaction');
    const repositories = createSovranCocoRepositories(coco);

    await repositories.counterRepository.setCounter(MINT, KEYSET, 4);
    expect(begun).toHaveBeenCalledTimes(1);

    await repositories.withTransaction(async (scope) => {
      await scope.counterRepository.setCounter(MINT, KEYSET, 6);
      // A later, lower write inside the same transaction is refused too.
      await scope.counterRepository.setCounter(MINT, KEYSET, 5);
    });
    expect(begun).toHaveBeenCalledTimes(2);
    expect(await saved()).toBe(6);
  });

  it('does not save a counter that a transaction rolled back', async () => {
    const repositories = createSovranCocoRepositories(coco);
    await repositories.counterRepository.setCounter(MINT, KEYSET, 4);
    await expect(
      repositories.withTransaction(async (scope) => {
        await scope.counterRepository.setCounter(MINT, KEYSET, 8);
        throw new Error('the operation failed');
      })
    ).rejects.toThrow('the operation failed');
    expect(await saved()).toBe(4);
  });
});
