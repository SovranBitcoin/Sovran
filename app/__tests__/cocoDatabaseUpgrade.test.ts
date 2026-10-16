/**
 * Every Coco SQLite adapter Sovran has shipped wrote a wallet database; this opens each of them
 * with the adapter this tree ships and checks that nothing a person owns went missing.
 *
 * `cocoDatabases/` holds one database per shipped adapter version, written by that old package
 * (see its README and `scripts/make-coco-fixture.mjs`), and beside each a record of what was
 * written. Every expectation here comes from that record, never from the current schema.
 *
 * Two layers per database, each over its own copy of the file:
 *  1. the shipped adapter runs its real migrations and its repositories read everything back;
 *  2. the app's own open path (`CocoManager.initialize`) opens it, takes its pre-v2 backup and
 *     answers the balance the wallet screen reads.
 *
 * SQLite here is Node's (`cocoDatabases/expoSqliteOnNode.ts`), not the phones': this proves the
 * migration chain over real old files, not the native module. Needs Node 22.13 or later.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExpoSqliteRepositories } from '@cashu/coco-expo-sqlite';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { ExpoSqliteOnNode } from './cocoDatabases/expoSqliteOnNode';

// The app's documents folder for the second layer. `mock`-prefixed so the factories may read it.
const mockDocuments = mkdtempSync(join(tmpdir(), 'coco-upgrade-'));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-sqlite', () => {
  const { join: joinPath } = jest.requireActual('node:path');
  const { ExpoSqliteOnNode: Database } = jest.requireActual('./cocoDatabases/expoSqliteOnNode');
  return {
    openDatabaseAsync: async (name: string) =>
      new Database(joinPath(mockDocuments, 'SQLite', name)),
    deleteDatabaseAsync: jest.fn(),
  };
});
// The real file system, so the backup the app takes before migrating is a real file.
jest.mock('expo-file-system/legacy', () => {
  const fs = jest.requireActual('node:fs');
  const path = (uri: string) => uri.replace('file://', '');
  return {
    // Read when the app asks, by which time the folder above exists.
    get documentDirectory() {
      return `file://${mockDocuments}/`;
    },
    getInfoAsync: async (uri: string) => ({ exists: fs.existsSync(path(uri)) }),
    copyAsync: async ({ from, to }: { from: string; to: string }) =>
      fs.copyFileSync(path(from), path(to)),
    deleteAsync: async (uri: string) => fs.rmSync(path(uri), { force: true }),
  };
});
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => false, shareAsync: jest.fn() }));

type Operation = { id: string; mintUrl: string; state: string; amount: number } & Record<
  string,
  unknown
>;
type Quote = { mintUrl: string; quote: string; state: string; amount: number; request: string };
type WrittenProof = {
  mintUrl: string;
  id: string;
  amount: number;
  secret: string;
  C: string;
  state: 'ready' | 'inflight' | 'spent';
  usedByOperationId?: string;
  dleq?: unknown;
  witness?: unknown;
};
/** What the old adapter was asked to store: `cocoDatabases/<name>.json`. */
type Written = {
  mints: { mintUrl: string; name: string; trusted?: boolean }[];
  keysets: { mintUrl: string; id: string; unit: string; active: boolean; feePpk: number }[];
  counters: { mintUrl: string; keysetId: string; counter: number }[];
  proofs: WrittenProof[];
  mintQuotes: Quote[];
  meltQuotes: (Quote & { fee_reserve: number; payment_preimage?: string })[];
  history?: { type: string; mintUrl: string; amount: number; quoteId?: string }[];
  keyPairs?: { publicKeyHex: string; secretKeyHex: string; derivationIndex: number }[];
  sendOperations?: Operation[];
  meltOperations?: Operation[];
  mintOperations?: Operation[];
  receiveOperations?: Operation[];
};
type ManifestEntry = {
  package: string;
  version: string;
  corePackage: string;
  coreVersion: string;
  releases: string[];
  database: string;
  written: string;
  sha256: string;
};

const folder = join(__dirname, 'cocoDatabases');
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const manifest = readJson<ManifestEntry[]>(join(folder, 'manifest.json'));
const appPackage = readJson<{ dependencies: Record<string, string> }>(
  join(__dirname, '../package.json')
);

/** Coco 2 hands amounts back as its own type; the records hold plain numbers. */
const number = (amount: unknown) => Number(String(amount));
/** Stored JSON as plain data, with Coco 2's amount type flattened to what it prints. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0);
const readyIn = (written: Written, mintUrl: string) =>
  written.proofs.filter((proof) => proof.mintUrl === mintUrl && proof.state === 'ready');

/** Every row of every table, and the schema, to compare one open with the next. */
async function contents(database: ExpoSqliteOnNode) {
  const schema = await database.getAllAsync<{ type: string; name: string; sql: string | null }>(
    'SELECT type, name, sql FROM sqlite_master ORDER BY type, name'
  );
  const tables: Record<string, unknown[]> = {};
  for (const { type, name } of schema) {
    if (type === 'table') tables[name] = await database.getAllAsync(`SELECT * FROM "${name}"`);
  }
  return { schema, tables };
}

afterAll(() => rmSync(mockDocuments, { recursive: true, force: true }));

describe('the folder covers the Coco this build ships', () => {
  const newest = manifest[manifest.length - 1];

  it('has a database written by the adapter and core in app/package.json', () => {
    const shipped = {
      adapter: `@cashu/coco-expo-sqlite@${appPackage.dependencies['@cashu/coco-expo-sqlite']}`,
      core: `@cashu/coco-core@${appPackage.dependencies['@cashu/coco-core']}`,
    };
    const recorded = {
      adapter: `${newest.package}@${newest.version}`,
      core: `${newest.corePackage}@${newest.coreVersion}`,
    };
    if (shipped.adapter !== recorded.adapter || shipped.core !== recorded.core) {
      throw new Error(
        `app/package.json ships ${shipped.adapter} with ${shipped.core}, but the newest wallet ` +
          `database in __tests__/cocoDatabases was written by ${recorded.adapter} with ${recorded.core}.\n` +
          'A Coco bump needs a database from both sides of it. BEFORE changing the version, make ' +
          'sure the one being replaced has its database here (it is the newest entry of ' +
          'manifest.json; never delete or regenerate a released one). Then add the new version:\n' +
          `  node app/scripts/make-coco-fixture.mjs ${shipped.adapter} --releases "<the release that will carry it>"\n` +
          'and commit the .db, its .json and manifest.json with the bump. See cocoDatabases/README.md.'
      );
    }
  });

  it('lists every database file, and every listed file is the one that was written', () => {
    const listed = manifest.flatMap((entry) => [entry.database, entry.written]).sort();
    const present = readdirSync(folder)
      .filter((file) => file.endsWith('.db') || /@.*\.json$/.test(file))
      .sort();
    expect(present).toEqual(listed);
    // A database is frozen once its version has shipped: a changed file is a different fixture.
    const hashes = manifest.map((entry) => ({
      database: entry.database,
      sha256: createHash('sha256')
        .update(readFileSync(join(folder, entry.database)))
        .digest('hex'),
    }));
    expect(hashes).toEqual(manifest.map(({ database, sha256 }) => ({ database, sha256 })));
  });

  it('says which releases carried each version', () => {
    expect(manifest.filter((entry) => entry.releases.length === 0)).toEqual([]);
  });
});

describe.each(manifest)('a wallet written by $package $version', (entry) => {
  const { written, lastMigrationAtWrite } = readJson<{
    written: Written;
    lastMigrationAtWrite: string;
  }>(join(folder, entry.written));
  const mintUrls = written.mints.map((mint) => mint.mintUrl);

  describe('opened by the shipped adapter', () => {
    const file = join(mockDocuments, `adapter-${entry.database}`);
    let database: ExpoSqliteOnNode;
    let repositories: ExpoSqliteRepositories;
    let migrationsBefore: string[];

    beforeAll(async () => {
      copyFileSync(join(folder, entry.database), file);
      database = new ExpoSqliteOnNode(file);
      migrationsBefore = (
        await database.getAllAsync<{ id: string }>('SELECT id FROM coco_cashu_migrations')
      ).map((row) => row.id);
      repositories = new ExpoSqliteRepositories({ database: database as never });
      await repositories.init();
    });
    afterAll(() => database.closeAsync());

    it('is at the schema the old adapter left, and migrates forward from there', async () => {
      expect(migrationsBefore.sort().at(-1)).toBe(lastMigrationAtWrite);
      const after = await database.getAllAsync<{ id: string }>(
        'SELECT id FROM coco_cashu_migrations'
      );
      expect(after.map((row) => row.id)).toEqual(expect.arrayContaining(migrationsBefore));
      expect(after.length).toBeGreaterThanOrEqual(migrationsBefore.length);
    });

    it('keeps every proof with its secret, amount, mint, keyset and state', async () => {
      const read = await Promise.all(
        written.proofs.map((proof) =>
          repositories.proofRepository.getProofBySecret(proof.mintUrl, proof.secret)
        )
      );
      // A witness is JSON. 1.0.1 stored the text as given and the rest stored it quoted, so it
      // comes back as text from some files and already parsed from a 1.0.1 one: the same witness.
      const witness = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);
      const kept = read.map(
        (proof) =>
          proof && {
            ...proof,
            amount: number(proof.amount),
            ...(proof.witness ? { witness: witness(proof.witness) } : {}),
          }
      );
      expect(kept).toEqual(
        written.proofs.map((proof) => ({
          ...proof,
          // The unit column arrived with Coco 2; every wallet before it held sats.
          unit: 'sat',
          ...(proof.witness ? { witness: witness(proof.witness) } : {}),
        }))
      );
      const rows = await database.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM coco_cashu_proofs'
      );
      expect(rows?.count).toBe(written.proofs.length);
    });

    it('keeps the spendable balance of each mint', async () => {
      const balances: Record<string, number> = {};
      for (const mintUrl of mintUrls) {
        const ready = await repositories.proofRepository.getReadyProofs(mintUrl);
        balances[mintUrl] = sum(ready.map((proof) => number(proof.amount)));
      }
      expect(balances).toEqual(
        Object.fromEntries(
          mintUrls.map((mintUrl) => [
            mintUrl,
            sum(readyIn(written, mintUrl).map((proof) => proof.amount)),
          ])
        )
      );
    });

    it('does not lower a keyset counter', async () => {
      for (const { mintUrl, keysetId, counter } of written.counters) {
        const kept = await repositories.counterRepository.getCounter(mintUrl, keysetId);
        // A lower counter would derive secrets the mint has already signed.
        expect(kept?.counter).toBeGreaterThanOrEqual(counter);
      }
    });

    it('keeps the mints, and keeps their keysets or marks the mint to fetch them again', async () => {
      // Migration 015 (Coco 1.0.0-rc.0) empties the keyset table on purpose and zeroes each
      // mint's `updatedAt`, so the keys are fetched again. A wallet from before it therefore
      // opens with no keysets until its mint answers; proofs and counters are not touched.
      const keysetsWereReset = lastMigrationAtWrite < '015';
      for (const mint of written.mints) {
        const kept = await repositories.mintRepository.getMintByUrl(mint.mintUrl);
        expect(kept).toMatchObject(mint);
        if (keysetsWereReset) expect(kept.updatedAt).toBe(0);
      }
      for (const keyset of written.keysets) {
        const kept = await repositories.keysetRepository.getKeysetById(keyset.mintUrl, keyset.id);
        if (keysetsWereReset) expect(kept).toBeNull();
        else expect(kept).toMatchObject(keyset);
      }
    });

    it('keeps a mint quote that has not been issued readable', async () => {
      // Quotes written before Coco 2 stay in the old table and are read through the legacy
      // repository, which the app reconciles at startup; an issued one is finished business.
      const legacy = await repositories.legacyMintQuoteRepository.getPendingLegacyMintQuotes();
      for (const quote of written.mintQuotes) {
        const kept =
          (await repositories.mintQuoteRepository.getMintQuote(
            quote.mintUrl,
            'bolt11',
            quote.quote
          )) ??
          legacy.find((other) => other.mintUrl === quote.mintUrl && other.quoteId === quote.quote);
        if (quote.state === 'ISSUED') {
          expect(kept?.state ?? 'ISSUED').toBe('ISSUED');
          continue;
        }
        expect(kept && { ...kept, amount: number(kept.amount) }).toMatchObject({
          state: quote.state,
          amount: quote.amount,
          request: quote.request,
        });
      }
    });

    it('keeps every melt quote readable', async () => {
      for (const { quote, mintUrl, ...expected } of written.meltQuotes) {
        const kept = await repositories.meltQuoteRepository.getMeltQuote(mintUrl, 'bolt11', quote);
        expect(plain(kept)).toMatchObject({
          ...expected,
          mintUrl,
          quoteId: quote,
          amount: String(expected.amount),
          fee_reserve: String(expected.fee_reserve),
        });
      }
    });

    it('keeps every operation, with what it needs to finish or roll back', async () => {
      const read = {
        sendOperations: repositories.sendOperationRepository,
        meltOperations: repositories.meltOperationRepository,
        mintOperations: repositories.mintOperationRepository,
        receiveOperations: repositories.receiveOperationRepository,
      };
      // Coco 2 stores money as text. These are the fields that hold money, by name.
      const money = new Set(['amount', 'fee', 'inputAmount', 'fee_reserve', 'swap_fee']);
      for (const [kind, repository] of Object.entries(read) as [keyof typeof read, never][]) {
        for (const operation of written[kind] ?? []) {
          const kept = plain(
            await (repository as (typeof read)['sendOperations']).getById(operation.id)
          );
          const expected = Object.entries(plain(operation) as Record<string, unknown>).map(
            ([field, value]) => {
              // Migration 010 renamed the state; the operation is the same finished send.
              if (field === 'state' && value === 'completed') return [field, 'finalized'];
              if (money.has(field)) return [field, String(value)];
              if (field === 'inputProofs') {
                const proofs = value as { amount: number }[];
                return [field, proofs.map((proof) => ({ ...proof, amount: String(proof.amount) }))];
              }
              // Not a column until Coco 2 tracked the remote state on the quote instead.
              if (field.startsWith('lastObservedRemoteState')) return [field, undefined];
              return [field, value];
            }
          );
          expect(kept).toMatchObject(
            Object.fromEntries(expected.filter(([, value]) => value !== undefined))
          );
        }
      }
      // A melt or mint in flight must be in the list recovery walks at startup.
      const pending = [
        ...(await repositories.meltOperationRepository.getPending()),
        ...(await repositories.mintOperationRepository.getPending()),
      ].map((operation) => operation.id);
      expect(pending.sort()).toEqual(
        [...(written.meltOperations ?? []), ...(written.mintOperations ?? [])]
          .filter((operation) => operation.state === 'pending')
          .map((operation) => operation.id)
          .sort()
      );
    });

    it('keeps the history and the keyring', async () => {
      const history = await repositories.historyRepository.getPaginatedHistoryEntries(100, 0);
      const shown = history.map((item) => plain(item) as Record<string, unknown>);
      for (const { type, mintUrl, amount, quoteId } of written.history ?? []) {
        // An entry may now be drawn from its operation instead of the old row; it must be there.
        expect(shown).toContainEqual(
          expect.objectContaining({
            type,
            mintUrl,
            amount: String(amount),
            ...(quoteId ? { quoteId } : {}),
          })
        );
      }
      for (const pair of written.keyPairs ?? []) {
        const kept = await repositories.keyRingRepository.getPersistedKeyPair(pair.publicKeyHex);
        expect(kept && Buffer.from(kept.secretKey).toString('hex')).toBe(pair.secretKeyHex);
        expect(kept?.derivationIndex).toBe(pair.derivationIndex);
      }
    });

    it('changes nothing when it is opened again', async () => {
      const first = await contents(database);
      await database.closeAsync();
      database = new ExpoSqliteOnNode(file);
      await new ExpoSqliteRepositories({ database: database as never }).init();
      expect(await contents(database)).toEqual(first);
    });
  });

  describe('opened by the app', () => {
    const live = join(mockDocuments, 'SQLite', 'coco.db');
    const backup = `${live}.pre-v2`;
    const original = readFileSync(join(folder, entry.database));

    beforeAll(() => {
      mkdirSync(join(mockDocuments, 'SQLite'), { recursive: true });
      for (const stale of [live, backup]) rmSync(stale, { force: true });
      copyFileSync(join(folder, entry.database), live);
      CocoManager.setAccountIndex(0);
      // The logger prints every entry and an open makes dozens. Warnings and errors still show.
      for (const method of ['log', 'info', 'debug'] as const) {
        jest.spyOn(console, method).mockImplementation(() => {});
      }
    });
    afterAll(async () => {
      await CocoManager.cleanup();
      jest.restoreAllMocks();
    });

    it('shows the balance that was there, and keeps a copy of a pre-v2 database', async () => {
      // Every database holds the same wallet, so a wallet left open by the one before would pass.
      expect(CocoManager.peekInstance()).toBeNull();
      const manager = await CocoManager.initialize();

      const shown = await manager.wallet.balances.byMint({ units: ['sat'] });
      const expected = Object.fromEntries(
        mintUrls.map((mintUrl) => {
          const ready = readyIn(written, mintUrl);
          const held = ready.filter((proof) => proof.usedByOperationId);
          const total = sum(ready.map((proof) => proof.amount));
          const reserved = sum(held.map((proof) => proof.amount));
          return [mintUrl, { spendable: total - reserved, reserved, total }];
        })
      );
      expect(
        Object.fromEntries(
          Object.entries(shown).map(([mintUrl, balance]) => [
            mintUrl,
            {
              spendable: number(balance.spendable),
              reserved: number(balance.reserved),
              total: number(balance.total),
            },
          ])
        )
      ).toEqual(expected);

      // The safety rail: Coco 2's migrations cannot be undone, so the app copies the file first.
      const wasBeforeCoco2 = !written.proofs.some((proof) => 'unit' in proof);
      expect(existsSync(backup)).toBe(wasBeforeCoco2);
      if (wasBeforeCoco2) expect(readFileSync(backup).equals(original)).toBe(true);
    });
  });
});
