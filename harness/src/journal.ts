import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const object = z.record(z.string(), z.json());
const row = z.object({ revision: z.number().int(), value: z.string() });
const operation = z.object({ input: z.string() });
type Value = z.infer<typeof object>;

/** A transition and its dispatch intent live in the same document/transaction.
 * Unknown external outcomes stay in that document until reconciled; never replay effects here. */
export class Journal {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    const version = z.object({ user_version: z.number() }).parse(this.db.query('PRAGMA user_version').get()).user_version;
    if (version !== 0 && version !== 1) {
      this.db.close();
      throw new Error(`Unsupported harness database version ${version}; preserve it for migration`);
    }
    this.db.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (task TEXT NOT NULL, id TEXT NOT NULL, input TEXT NOT NULL,
          revision INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(task, id));
        DROP INDEX IF EXISTS active_workspace;
        PRAGMA user_version = 1;`);
    }).immediate();
  }

  create(id: string, value: unknown) {
    const parsed = object.parse(value);
    return this.db.transaction(() => {
      // Existing conflicting prototype rows remain readable for reconciliation.
      // Checking under the write lock enforces exclusivity without an index
      // migration that could make the whole journal impossible to open.
      if (typeof parsed.root === 'string' && this.db.query(`SELECT id FROM tasks
        WHERE json_extract(value, '$.root') = ? AND (
          json_extract(value, '$.phase') NOT IN ('ready', 'incomplete', 'cancelled')
          OR json_type(value, '$.ticket') = 'object'
          OR json_extract(value, '$.pending.kind') IN ('command', 'publish')) LIMIT 1`).get(parsed.root))
        throw new Error('Workspace already has outstanding work');
      this.db.query('INSERT INTO tasks VALUES (?, 0, ?)').run(id, JSON.stringify(parsed));
      return this.read(id);
    }).immediate();
  }

  read(id: string) {
    const result = row.parse(this.db.query('SELECT revision, value FROM tasks WHERE id = ?').get(id));
    return { revision: result.revision, value: object.parse(JSON.parse(result.value)) };
  }

  change(id: string, operationId: string, input: unknown, update: (value: Value) => unknown, equivalentInputs: unknown[] = []) {
    const inputHash = createHash('sha256').update(JSON.stringify(z.json().parse(input))).digest('hex');
    return this.db.transaction(() => {
      const previous = this.db.query('SELECT input FROM events WHERE task = ? AND id = ?').get(id, operationId);
      if (previous) {
        const previousHash = operation.parse(previous).input;
        if (previousHash !== inputHash && !equivalentInputs.some(value =>
          createHash('sha256').update(JSON.stringify(z.json().parse(value))).digest('hex') === previousHash))
          throw new Error('Operation id reused with different input');
        return { ...this.read(id), applied: false };
      }
      const current = this.read(id);
      const value = JSON.stringify(object.parse(update(current.value)));
      const revision = current.revision + 1;
      this.db.query('INSERT INTO events VALUES (?, ?, ?, ?, ?)').run(id, operationId, inputHash, revision, value);
      this.db.query('UPDATE tasks SET revision = ?, value = ? WHERE id = ?').run(revision, value, id);
      return { ...this.read(id), applied: true };
    }).immediate();
  }

  close() { this.db.close(); }
}
