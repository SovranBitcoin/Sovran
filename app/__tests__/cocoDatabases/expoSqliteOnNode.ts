/**
 * The slice of expo-sqlite's `SQLiteDatabase` that Coco's adapter and the app's wallet open path
 * call, over Node's built-in SQLite. It lets a real database file be opened and migrated by the
 * real adapter in Jest, and lets `app/scripts/make-coco-fixture.mjs` write one with an old adapter.
 *
 * It is not the native module: a different SQLite build, one connection, no WAL. What it proves
 * is the adapter's SQL and migration chain over a real old file.
 *
 * Needs Node 22.13 or later (`node:sqlite` without a flag). Only erasable TypeScript here: the
 * generator imports this file directly under Node's type stripping.
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

function loadSqlite(): typeof import('node:sqlite') {
  // Looked up on first use rather than imported, so an older Node gets the sentence below
  // instead of "Cannot find module".
  const sqlite = process.getBuiltinModule?.('node:sqlite');
  if (sqlite) return sqlite;
  throw new Error(
    `The Coco database tests need Node 22.13 or later for node:sqlite; this is ${process.version}. ` +
      'Use the Node version CI uses (22.x) and run again.'
  );
}

type Params = unknown[];

function toInputs(params: Params): SQLInputValue[] {
  const list = params.length === 1 && Array.isArray(params[0]) ? (params[0] as Params) : params;
  return list.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return Number(value);
    return value as SQLInputValue;
  });
}

export class ExpoSqliteOnNode {
  readonly native: DatabaseSync;

  constructor(path: string) {
    // The phones' SQLite accepts a double-quoted string literal, and Coco 0.6.0 wrote
    // `state = "ready"`; Node's build refuses it unless asked.
    this.native = new (loadSqlite().DatabaseSync)(path, { enableDoubleQuotedStringLiterals: true });
  }

  async execAsync(sql: string): Promise<void> {
    this.native.exec(sql);
  }

  async runAsync(sql: string, ...params: Params) {
    const result = this.native.prepare(sql).run(...toInputs(params));
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async getFirstAsync<Row>(sql: string, ...params: Params): Promise<Row | null> {
    return (this.native.prepare(sql).get(...toInputs(params)) as Row | undefined) ?? null;
  }

  async getAllAsync<Row>(sql: string, ...params: Params): Promise<Row[]> {
    return this.native.prepare(sql).all(...toInputs(params)) as Row[];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.native.exec('BEGIN');
    try {
      await task();
      this.native.exec('COMMIT');
    } catch (error) {
      this.native.exec('ROLLBACK');
      throw error;
    }
  }

  /** Expo hands the task its own connection; here there is one, and Coco queues around it. */
  async withExclusiveTransactionAsync(task: (transaction: this) => Promise<void>): Promise<void> {
    await this.withTransactionAsync(() => task(this));
  }

  async closeAsync(): Promise<void> {
    this.native.close();
  }
}
