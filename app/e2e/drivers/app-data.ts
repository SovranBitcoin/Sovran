/**
 * Host-side per-frame app-state capture: the zustand state-mirror file the app
 * writes under its own container, plus a full JSON dump of every coco SQLite
 * database. Both are best-effort evidence — `capture()` never rejects, every
 * failure degrades to a null member and a once-per-cause warning, and the DB
 * side fingerprints the SQLite files (name/size/mtime of db+wal+shm) so an
 * unchanged wallet costs a stat sweep instead of a copy + sqlite3 dump.
 *
 * Dumps are written RAW (no redaction) by explicit policy: run dirs are local,
 * 0600, and hold test-wallet material only — never share or commit them.
 */
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BUNDLE_ID, run, sleep, type RunOptions } from './simctl';
import type { AppDataCapturer, AppDataResult } from './driver';

const COCO_DB_RE = /^coco(-\d+)?\.db$/;
const STATE_MIRROR_REL = join('Documents', 'e2e', 'state.json');
const MINT_FAULT_LEDGER_REL = join('Documents', 'e2e', 'mint-faults.ledger.json');
const SQLITE_DIR_REL = join('Documents', 'SQLite');
const PARSE_RETRY_MS = 150;

export interface AppDataFs {
  readTextFile(path: string): string;
  /** Returns [] when the directory does not exist. */
  listDir(path: string): string[];
  stat(path: string): { size: number; mtimeMs: number } | null;
  copyFile(src: string, dest: string): void;
  mkdtemp(prefix: string): string;
  rm(path: string): void;
}

const realFs: AppDataFs = {
  readTextFile: (path) => readFileSync(path, 'utf8'),
  listDir: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  stat: (path) => {
    try {
      const s = statSync(path);
      return { size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return null;
    }
  },
  copyFile: (src, dest) => copyFileSync(src, dest),
  mkdtemp: (prefix) => mkdtempSync(prefix),
  rm: (path) => rmSync(path, { recursive: true, force: true }),
};

interface AppDataCapturerOptions {
  udid: string;
  bundleId?: string;
  onWarning?: (message: string) => void;
  signal?: AbortSignal;
  exec?: (cmd: string[], opts?: RunOptions) => Promise<string>;
  fs?: AppDataFs;
}

export function createSimulatorAppDataCapturer(options: AppDataCapturerOptions): AppDataCapturer {
  const bundleId = options.bundleId ?? BUNDLE_ID;
  const exec = options.exec ?? run;
  const fs = options.fs ?? realFs;
  const warned = new Set<string>();
  const warn = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    options.onWarning?.(message);
  };

  let dbFingerprint: string | undefined;
  let dbCached: string | null = null;

  // A `reset: reinstall` mid-run replaces the data container, so the path is
  // resolved per capture rather than cached for the session.
  const resolveContainer = async (): Promise<string | null> => {
    const out = await exec(
      ['xcrun', 'simctl', 'get_app_container', options.udid, bundleId, 'data'],
      { allowFail: true, ...(options.signal ? { signal: options.signal } : {}) }
    );
    const container = out.split('\n')[0]?.trim() ?? '';
    return container.startsWith('/') ? container : null;
  };

  const captureStore = async (container: string): Promise<string | null> => {
    const path = join(container, STATE_MIRROR_REL);
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw: string;
      try {
        raw = fs.readTextFile(path);
      } catch {
        warn('store-missing', 'state mirror file absent — .store.json sidecars unavailable');
        return null;
      }
      try {
        JSON.parse(raw);
        return raw;
      } catch {
        // Torn read straddling the app's atomic rename — settle and reread.
        if (attempt === 0) await sleep(PARSE_RETRY_MS);
      }
    }
    warn('store-parse', 'state mirror file unparsable after retry');
    return null;
  };

  const fingerprintDbs = (sqliteDir: string, dbNames: string[]): string =>
    dbNames
      .flatMap((name) => [name, `${name}-wal`, `${name}-shm`])
      .map((name) => {
        const stat = fs.stat(join(sqliteDir, name));
        return stat ? `${name}:${stat.size}:${stat.mtimeMs}` : `${name}:absent`;
      })
      .join('|');

  const dumpDbs = async (sqliteDir: string, dbNames: string[]): Promise<string> => {
    const temp = fs.mkdtemp(join(tmpdir(), 'e2e-coco-'));
    try {
      const dbs: Record<
        string,
        { tables: Record<string, unknown[]>; rowCounts: Record<string, number> }
      > = {};
      for (const name of dbNames) {
        for (const file of [name, `${name}-wal`, `${name}-shm`]) {
          if (fs.stat(join(sqliteDir, file))) fs.copyFile(join(sqliteDir, file), join(temp, file));
        }
        const copy = join(temp, name);
        const tableListRaw = await exec([
          'sqlite3',
          '-json',
          copy,
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ]);
        const tableNames = (
          tableListRaw ? (JSON.parse(tableListRaw) as { name: string }[]) : []
        ).map((row) => row.name);
        const tables: Record<string, unknown[]> = {};
        const rowCounts: Record<string, number> = {};
        for (const table of tableNames) {
          const rowsRaw = await exec(['sqlite3', '-json', copy, `SELECT * FROM "${table}"`]);
          const rows = rowsRaw ? (JSON.parse(rowsRaw) as unknown[]) : [];
          tables[table] = rows;
          rowCounts[table] = rows.length;
        }
        dbs[basename(name)] = { tables, rowCounts };
      }
      // Deterministic content (no timestamps) so identical wallet state dedups
      // to a single sidecar across frames.
      return JSON.stringify({ v: 1, dbs });
    } finally {
      fs.rm(temp);
    }
  };

  const captureDb = async (container: string): Promise<string | null> => {
    const sqliteDir = join(container, SQLITE_DIR_REL);
    const dbNames = fs
      .listDir(sqliteDir)
      .filter((name) => COCO_DB_RE.test(name))
      .sort();
    if (dbNames.length === 0) {
      warn('db-missing', 'no coco database in app container — .db.json sidecars unavailable');
      return null;
    }
    const fingerprint = fingerprintDbs(sqliteDir, dbNames);
    if (fingerprint === dbFingerprint && dbCached !== null) return dbCached;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const dump = await dumpDbs(sqliteDir, dbNames);
        dbFingerprint = fingerprint;
        dbCached = dump;
        return dump;
      } catch {
        // Torn copy while the app was mid-write — one retry, then degrade.
      }
    }
    warn('db-dump-failed', 'coco db dump failed after retry — serving stale/absent .db.json');
    return dbCached;
  };

  // Mint-fault ledger sidecar: best-effort and quiet — the file only exists in
  // mock.mint-faults sessions, so absence is the normal case, never a warning.
  const captureFaults = (container: string): string | null => {
    try {
      const raw = fs.readTextFile(join(container, MINT_FAULT_LEDGER_REL));
      JSON.parse(raw);
      return raw;
    } catch {
      return null;
    }
  };

  return {
    async capture(): Promise<AppDataResult> {
      try {
        const container = await resolveContainer();
        if (!container) {
          warn('container-unresolved', 'app data container unresolved — app-data capture skipped');
          return { store: null, db: null };
        }
        const [store, db] = await Promise.all([
          captureStore(container).catch(() => null),
          captureDb(container).catch(() => null),
        ]);
        return { store, db, faults: captureFaults(container) };
      } catch {
        return { store: null, db: null };
      }
    },
  };
}
