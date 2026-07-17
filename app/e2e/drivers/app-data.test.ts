import { describe, expect, it } from 'bun:test';
import { createSimulatorAppDataCapturer, type AppDataFs } from './app-data';

const CONTAINER = '/containers/data';
const STATE = `${CONTAINER}/Documents/e2e/state.json`;
const SQLITE = `${CONTAINER}/Documents/SQLite`;

interface FakeWorld {
  containerOut?: string;
  files: Record<string, string>;
  stats: Record<string, { size: number; mtimeMs: number }>;
  sqliteRows: Record<string, string>; // sql -> stdout
  failCopies?: number;
}

function makeFakes(world: FakeWorld) {
  const execCalls: string[][] = [];
  const exec = async (cmd: string[]): Promise<string> => {
    execCalls.push(cmd);
    if (cmd[2] === 'get_app_container') return world.containerOut ?? CONTAINER;
    if (cmd[0] === 'sqlite3') {
      const sql = cmd[3];
      if (sql in world.sqliteRows) return world.sqliteRows[sql];
      return '';
    }
    throw new Error(`unexpected exec: ${cmd.join(' ')}`);
  };
  const fs: AppDataFs = {
    readTextFile: (path) => {
      const value = world.files[path];
      if (value === undefined) throw new Error('ENOENT');
      return value;
    },
    listDir: (path) =>
      Object.keys(world.stats)
        .filter((p) => p.startsWith(`${path}/`))
        .map((p) => p.slice(path.length + 1))
        .filter((name) => !name.includes('/')),
    stat: (path) => world.stats[path] ?? null,
    copyFile: (src) => {
      if (world.failCopies && world.failCopies > 0) {
        world.failCopies--;
        throw new Error('torn copy');
      }
      if (!world.stats[src]) throw new Error('ENOENT');
    },
    mkdtemp: (prefix) => `${prefix}xxxx`,
    rm: () => {},
  };
  return { exec, execCalls, fs };
}

const TABLE_LIST_SQL =
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";

function walletWorld(): FakeWorld {
  return {
    files: {
      [STATE]: JSON.stringify({ v: 1, revision: 3, stores: { settings: { theme: 'dark' } } }),
    },
    stats: {
      [`${SQLITE}/coco.db`]: { size: 4096, mtimeMs: 100 },
      [`${SQLITE}/coco.db-wal`]: { size: 512, mtimeMs: 101 },
    },
    sqliteRows: {
      [TABLE_LIST_SQL]: JSON.stringify([{ name: 'coco_cashu_proofs' }]),
      'SELECT * FROM "coco_cashu_proofs"': JSON.stringify([{ amount: 21, state: 'ready' }]),
    },
  };
}

function capturer(world: FakeWorld, onWarning?: (m: string) => void) {
  const { exec, execCalls, fs } = makeFakes(world);
  const cap = createSimulatorAppDataCapturer({
    udid: 'UDID',
    ...(onWarning ? { onWarning } : {}),
    exec,
    fs,
  });
  return { cap, execCalls };
}

describe('createSimulatorAppDataCapturer', () => {
  it('captures store json and a full per-table db dump', async () => {
    const { cap } = capturer(walletWorld());
    const result = await cap.capture();
    expect(JSON.parse(result.store!)).toEqual({
      v: 1,
      revision: 3,
      stores: { settings: { theme: 'dark' } },
    });
    expect(JSON.parse(result.db!)).toEqual({
      v: 1,
      dbs: {
        'coco.db': {
          tables: { coco_cashu_proofs: [{ amount: 21, state: 'ready' }] },
          rowCounts: { coco_cashu_proofs: 1 },
        },
      },
    });
  });

  it('skips the sqlite dump when the file fingerprint is unchanged', async () => {
    const world = walletWorld();
    const { cap, execCalls } = capturer(world);
    const first = await cap.capture();
    const sqliteCallsAfterFirst = execCalls.filter((c) => c[0] === 'sqlite3').length;
    const second = await cap.capture();
    expect(second.db).toBe(first.db); // same cached string reference
    expect(execCalls.filter((c) => c[0] === 'sqlite3').length).toBe(sqliteCallsAfterFirst);
    world.stats[`${SQLITE}/coco.db-wal`] = { size: 640, mtimeMs: 200 };
    await cap.capture();
    expect(execCalls.filter((c) => c[0] === 'sqlite3').length).toBeGreaterThan(
      sqliteCallsAfterFirst
    );
  });

  it('retries a torn copy once and succeeds', async () => {
    const world = walletWorld();
    world.failCopies = 1;
    const { cap } = capturer(world);
    const result = await cap.capture();
    expect(result.db).not.toBeNull();
  });

  it('degrades to nulls with warnings when the container is unresolved', async () => {
    const world = walletWorld();
    world.containerOut = 'No such file or directory';
    const warnings: string[] = [];
    const { cap } = capturer(world, (m) => warnings.push(m));
    const result = await cap.capture();
    expect(result).toEqual({ store: null, db: null });
    expect(warnings.length).toBe(1);
    await cap.capture();
    expect(warnings.length).toBe(1); // throttled per cause
  });

  it('degrades store to null when the mirror file is absent, db still captured', async () => {
    const world = walletWorld();
    delete world.files[STATE];
    const warnings: string[] = [];
    const { cap } = capturer(world, (m) => warnings.push(m));
    const result = await cap.capture();
    expect(result.store).toBeNull();
    expect(result.db).not.toBeNull();
    expect(warnings.some((m) => m.includes('state mirror'))).toBe(true);
  });

  it('rereads a torn store file and returns null only after the retry fails', async () => {
    const world = walletWorld();
    world.files[STATE] = '{"v":1,"stores":{'; // torn forever
    const { cap } = capturer(world);
    const result = await cap.capture();
    expect(result.store).toBeNull();
    expect(result.db).not.toBeNull();
  });

  it('captures every profile db and skips pre-v2 backups', async () => {
    const world = walletWorld();
    world.stats[`${SQLITE}/coco-1.db`] = { size: 2048, mtimeMs: 50 };
    world.stats[`${SQLITE}/coco.db.pre-v2`] = { size: 999, mtimeMs: 1 };
    const { cap } = capturer(world);
    const result = await cap.capture();
    expect(Object.keys(JSON.parse(result.db!).dbs).sort()).toEqual(['coco-1.db', 'coco.db']);
  });

  it('never rejects even when everything throws', async () => {
    const cap = createSimulatorAppDataCapturer({
      udid: 'UDID',
      exec: async () => {
        throw new Error('boom');
      },
      fs: {
        readTextFile: () => {
          throw new Error('boom');
        },
        listDir: () => {
          throw new Error('boom');
        },
        stat: () => {
          throw new Error('boom');
        },
        copyFile: () => {
          throw new Error('boom');
        },
        mkdtemp: () => {
          throw new Error('boom');
        },
        rm: () => {
          throw new Error('boom');
        },
      },
    });
    expect(await cap.capture()).toEqual({ store: null, db: null });
  });
});
