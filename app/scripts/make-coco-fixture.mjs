#!/usr/bin/env node
/**
 * Writes a wallet database with a released Coco SQLite adapter, for
 * `__tests__/cocoDatabaseUpgrade.test.ts` to open with the adapter this tree ships.
 *
 *   node app/scripts/make-coco-fixture.mjs @cashu/coco-expo-sqlite@2.0.0 --releases "0.1.2; 0.1.3"
 *
 * Run it for the version being replaced BEFORE changing the Coco version in app/package.json.
 * The old adapter and its core are installed from npm into a temporary directory; nothing is
 * added to any package.json. The wallet is written through the old package's own repositories,
 * never by the current code: a fixture written from today's schema cannot fail.
 *
 * Options:
 *   --releases "<a>; <b>"  the Sovran releases that shipped this version (required)
 *   --core <version>       the core version it shipped with, when it differs from the adapter's
 *   --out <dir>            where to put <name>.db, <name>.json and manifest.json (default: the
 *                          fixtures folder)
 *   --install <dir>        install into this directory and keep it, instead of a temporary one
 *
 * Needs Node 22.18 or later (node:sqlite, and importing the TypeScript shim directly).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ExpoSqliteOnNode } from '../__tests__/cocoDatabases/expoSqliteOnNode.ts';

const here = dirname(fileURLToPath(import.meta.url));

function parseArguments(argv) {
  const [spec, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) options[rest[i].replace(/^--/, '')] = rest[i + 1];
  const at = spec?.lastIndexOf('@') ?? -1;
  if (at <= 0 || !options.releases) {
    console.error(
      'usage: make-coco-fixture.mjs <package>@<version> --releases "<a>; <b>" [--core <version>] [--out <dir>] [--install <dir>]'
    );
    process.exit(2);
  }
  return {
    adapter: spec.slice(0, at),
    version: spec.slice(at + 1),
    coreVersion: options.core ?? spec.slice(at + 1),
    releases: options.releases.split(';').map((release) => release.trim()),
    out: resolve(options.out ?? join(here, '../__tests__/cocoDatabases')),
    install: options.install ? resolve(options.install) : null,
  };
}

/** Install the old adapter and its core where no package.json of this repository can see them. */
function installOldPackages({ adapter, version, coreVersion, install }) {
  const directory = install ?? mkdtempSync(join(tmpdir(), 'coco-fixture-'));
  const core = adapter.replace('expo-sqlite', 'core');
  const adapterDirectory = join(directory, 'node_modules', adapter);
  if (!existsSync(adapterDirectory)) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), '{"private":true}\n');
    // Peers are left out: expo-sqlite is replaced by the shim, and the core is named here.
    const npm = ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'];
    execFileSync('npm', [...npm, `${adapter}@${version}`, `${core}@${coreVersion}`], {
      cwd: directory,
      stdio: 'inherit',
    });
  }
  const installed = (name) =>
    JSON.parse(readFileSync(join(directory, 'node_modules', name, 'package.json'), 'utf8'));
  if (installed(adapter).version !== version || installed(core).version !== coreVersion) {
    throw new Error(`${directory} holds a different version than the one asked for`);
  }
  return { directory, core, temporary: !install };
}

/** Import a package the way code inside the old install would, not the way this repository would. */
function importFromInstall(directory, specifier) {
  const bridge = join(directory, 'bridge.mjs');
  writeFileSync(bridge, `export * from ${JSON.stringify(specifier)};\n`);
  return import(`${pathToFileURL(bridge).href}?${encodeURIComponent(specifier)}`);
}

// --- The wallet. Fixed values, so a fixture can be reproduced and its sidecar read by a person.
// Nothing here is a real secret, key or invoice.

const hex = (label) => createHash('sha256').update(`coco-fixture:${label}`).digest('hex');
const point = (label) => `02${hex(label)}`;
const SECONDS = 1_700_000_000;
const MINT_A = 'https://mint-a.fixture.example';
const MINT_B = 'https://mint-b.fixture.example/Bitcoin';
const KEYSET_A = '00a1b2c3d4e5f601';
const KEYSET_A_RETIRED = '00a1b2c3d4e5f602';
const KEYSET_B = '00b1b2c3d4e5f601';
const SEND_OPERATION = 'fixture-send-prepared';
const invoice = (label) => `lnbc1fixture${hex(label).slice(0, 40)}`;

const proof = (mintUrl, id, amount, state, extra = {}) => ({
  mintUrl,
  id,
  amount,
  secret: hex(`secret:${mintUrl}:${id}:${amount}:${state}`),
  C: point(`C:${mintUrl}:${id}:${amount}:${state}`),
  state,
  ...extra,
});

const wallet = {
  mints: [
    { mintUrl: MINT_A, name: 'Fixture mint A', trusted: true },
    { mintUrl: MINT_B, name: 'Fixture mint B', trusted: false },
  ],
  keysets: [
    { mintUrl: MINT_A, id: KEYSET_A, unit: 'sat', active: true, feePpk: 0 },
    { mintUrl: MINT_A, id: KEYSET_A_RETIRED, unit: 'sat', active: false, feePpk: 100 },
    { mintUrl: MINT_B, id: KEYSET_B, unit: 'sat', active: true, feePpk: 0 },
  ],
  counters: [
    { mintUrl: MINT_A, keysetId: KEYSET_A, counter: 42 },
    { mintUrl: MINT_A, keysetId: KEYSET_A_RETIRED, counter: 5 },
    { mintUrl: MINT_B, keysetId: KEYSET_B, counter: 7 },
  ],
  proofs: [
    ...[1, 2, 4, 8, 16].map((amount) => proof(MINT_A, KEYSET_A, amount, 'ready')),
    // Held by the prepared send below, where the version can reserve a proof.
    proof(MINT_A, KEYSET_A, 32, 'ready'),
    // Handed to the mint by the melt that is still in flight.
    proof(MINT_A, KEYSET_A, 64, 'inflight'),
    proof(MINT_A, KEYSET_A, 128, 'spent'),
    proof(MINT_A, KEYSET_A_RETIRED, 2, 'ready', {
      dleq: { e: hex('dleq:e'), s: hex('dleq:s'), r: hex('dleq:r') },
    }),
    proof(MINT_B, KEYSET_B, 4, 'ready'),
    proof(MINT_B, KEYSET_B, 16, 'ready', { witness: '{"signatures":["fixture"]}' }),
    proof(MINT_B, KEYSET_B, 1, 'spent'),
  ],
  mintQuotes: [
    { mintUrl: MINT_A, quote: 'fixture-mint-unpaid', state: 'UNPAID', amount: 100 },
    // Paid and not yet issued: the person's money is at the mint until this is minted.
    { mintUrl: MINT_A, quote: 'fixture-mint-paid', state: 'PAID', amount: 21 },
    { mintUrl: MINT_B, quote: 'fixture-mint-issued', state: 'ISSUED', amount: 20 },
  ].map((quote) => ({
    ...quote,
    request: invoice(quote.quote),
    unit: 'sat',
    expiry: SECONDS + 3600,
  })),
  meltQuotes: [
    {
      mintUrl: MINT_A,
      quote: 'fixture-melt-pending',
      state: 'PENDING',
      amount: 60,
      fee_reserve: 4,
    },
    {
      mintUrl: MINT_B,
      quote: 'fixture-melt-paid',
      state: 'PAID',
      amount: 1,
      fee_reserve: 0,
      payment_preimage: hex('preimage'),
    },
  ].map((quote) => ({
    ...quote,
    request: invoice(quote.quote),
    unit: 'sat',
    expiry: SECONDS + 3600,
  })),
};

const secretOf = (amount) =>
  wallet.proofs.find((p) => p.mintUrl === MINT_A && p.id === KEYSET_A && p.amount === amount)
    .secret;
const outputs = (label, amounts) =>
  amounts.map((amount, index) => ({
    blindedMessage: { amount, id: KEYSET_A, B_: point(`B:${label}:${index}`) },
    blindingFactor: hex(`r:${label}:${index}`),
    secret: hex(`out:${label}:${index}`),
  }));
const operationTimes = { createdAt: SECONDS * 1000, updatedAt: (SECONDS + 60) * 1000 };

/** What each kind of record holds, in the shape the first-generation repositories take. */
const records = {
  keyPairs: [
    {
      publicKeyHex: point('keyring'),
      secretKey: Buffer.from(hex('keyring-secret'), 'hex'),
      derivationIndex: 0,
    },
  ],
  history: [
    {
      type: 'mint',
      mintUrl: MINT_A,
      unit: 'sat',
      amount: 21,
      createdAt: SECONDS,
      quoteId: 'fixture-mint-paid',
      state: 'PAID',
      paymentRequest: invoice('fixture-mint-paid'),
    },
    {
      type: 'melt',
      mintUrl: MINT_A,
      unit: 'sat',
      amount: 60,
      createdAt: SECONDS + 1,
      quoteId: 'fixture-melt-pending',
      state: 'PENDING',
    },
    { type: 'receive', mintUrl: MINT_B, unit: 'sat', amount: 20, createdAt: SECONDS + 2 },
  ],
  sendOperations: [
    {
      id: SEND_OPERATION,
      mintUrl: MINT_A,
      amount: 30,
      unit: 'sat',
      state: 'prepared',
      method: 'default',
      methodData: {},
      needsSwap: true,
      fee: 0,
      inputAmount: 32,
      inputProofSecrets: [secretOf(32)],
      outputData: { keep: outputs('send-keep', [2]), send: outputs('send-send', [2, 4, 8, 16]) },
      ...operationTimes,
    },
    {
      id: 'fixture-send-done',
      mintUrl: MINT_A,
      amount: 128,
      unit: 'sat',
      // Named `completed` until migration 010 renamed it; set in `write` for those versions.
      state: 'finalized',
      method: 'default',
      methodData: {},
      needsSwap: false,
      fee: 0,
      inputAmount: 128,
      inputProofSecrets: [secretOf(128)],
      ...operationTimes,
    },
  ],
  meltOperations: [
    {
      id: 'fixture-melt-pending',
      mintUrl: MINT_A,
      state: 'pending',
      method: 'bolt11',
      methodData: { invoice: invoice('fixture-melt-pending') },
      quoteId: 'fixture-melt-pending',
      unit: 'sat',
      amount: 60,
      fee_reserve: 4,
      swap_fee: 0,
      needsSwap: false,
      inputAmount: 64,
      inputProofSecrets: [secretOf(64)],
      changeOutputData: { keep: outputs('melt-change', [1, 2]), send: [] },
      ...operationTimes,
    },
  ],
  mintOperations: [
    {
      id: 'fixture-mint-paid',
      mintUrl: MINT_A,
      state: 'pending',
      method: 'bolt11',
      methodData: {},
      quoteId: 'fixture-mint-paid',
      amount: 21,
      unit: 'sat',
      request: invoice('fixture-mint-paid'),
      expiry: SECONDS + 3600,
      lastObservedRemoteState: 'PAID',
      lastObservedRemoteStateAt: (SECONDS + 30) * 1000,
      outputData: { keep: outputs('mint', [1, 4, 16]), send: [] },
      ...operationTimes,
    },
  ],
  receiveOperations: [
    {
      id: 'fixture-receive-prepared',
      mintUrl: MINT_B,
      unit: 'sat',
      amount: 8,
      state: 'prepared',
      fee: 0,
      inputProofs: [
        { id: KEYSET_B, amount: 8, secret: hex('receive:secret'), C: point('receive:C') },
      ],
      outputData: { keep: outputs('receive', [8]), send: [] },
      ...operationTimes,
    },
  ],
};

/**
 * Write the wallet through the old repositories, skipping what that version did not have.
 * Returns what was written, which becomes the sidecar the test asserts from.
 */
async function write(repositories, migrations, toAmount) {
  const written = { ...wallet };
  const has = (repository, method) => typeof repositories[repository]?.[method] === 'function';
  // From 2.0.0 the quote repositories take a payment method and a canonical quote shape.
  const canonicalQuotes = has('mintQuoteRepository', 'upsertMintQuote');

  written.mints = wallet.mints.map(({ trusted, ...mint }) =>
    has('mintRepository', 'setMintTrusted') ? { ...mint, trusted } : mint
  );
  for (const mint of wallet.mints) {
    await repositories.mintRepository.addNewMint({
      ...mint,
      mintInfo: { name: mint.name, version: 'Fixture/1.0', nuts: {} },
      createdAt: SECONDS,
      updatedAt: SECONDS,
    });
  }
  for (const keyset of wallet.keysets) {
    await repositories.keysetRepository.addKeyset({
      ...keyset,
      keypairs: Object.fromEntries([1, 2, 4, 8].map((n) => [n, point(`key:${keyset.id}:${n}`)])),
    });
  }
  for (const { mintUrl, keysetId, counter } of wallet.counters) {
    await repositories.counterRepository.setCounter(mintUrl, keysetId, counter);
  }
  // From 2.0.0 a proof names its unit; before that the column did not exist.
  if (canonicalQuotes) written.proofs = wallet.proofs.map((p) => ({ ...p, unit: 'sat' }));
  for (const mint of wallet.mints) {
    const proofs = written.proofs.filter((p) => p.mintUrl === mint.mintUrl);
    await repositories.proofRepository.saveProofs(mint.mintUrl, proofs);
  }

  for (const quote of wallet.mintQuotes) {
    if (!canonicalQuotes) {
      await repositories.mintQuoteRepository.addMintQuote(quote);
      continue;
    }
    await repositories.mintQuoteRepository.upsertMintQuote({
      ...quote,
      method: 'bolt11',
      quoteId: quote.quote,
      reusable: false,
      amount: toAmount(quote.amount),
      quoteData: { amount: toAmount(quote.amount) },
      amountPaid: toAmount(quote.state === 'UNPAID' ? 0 : quote.amount),
      amountIssued: toAmount(quote.state === 'ISSUED' ? quote.amount : 0),
      remoteUpdatedAt: SECONDS,
      ...operationTimes,
    });
  }
  for (const quote of wallet.meltQuotes) {
    if (canonicalQuotes) {
      await repositories.meltQuoteRepository.upsertMeltQuote({
        ...quote,
        method: 'bolt11',
        quoteId: quote.quote,
        ...operationTimes,
      });
    } else {
      await repositories.meltQuoteRepository.addMeltQuote(quote);
    }
  }

  if (has('historyRepository', 'addHistoryEntry')) {
    written.history = records.history;
    for (const entry of records.history)
      await repositories.historyRepository.addHistoryEntry(entry);
  }
  if (has('keyRingRepository', 'setPersistedKeyPair')) {
    written.keyPairs = records.keyPairs.map((pair) => ({
      publicKeyHex: pair.publicKeyHex,
      secretKeyHex: Buffer.from(pair.secretKey).toString('hex'),
      derivationIndex: pair.derivationIndex,
    }));
    for (const pair of records.keyPairs) {
      await repositories.keyRingRepository.setPersistedKeyPair({
        ...pair,
        secretKey: new Uint8Array(pair.secretKey),
      });
    }
  }
  if (has('sendOperationRepository', 'create')) {
    const renamed = migrations.includes('010_rename_completed_to_finalized');
    written.sendOperations = records.sendOperations.map((operation) =>
      operation.state === 'finalized' && !renamed ? { ...operation, state: 'completed' } : operation
    );
    for (const operation of written.sendOperations) {
      await repositories.sendOperationRepository.create(operation);
    }
    await repositories.proofRepository.reserveProofs(MINT_A, [secretOf(32)], SEND_OPERATION);
    written.proofs = written.proofs.map((p) =>
      p.secret === secretOf(32) ? { ...p, usedByOperationId: SEND_OPERATION } : p
    );
  }
  for (const kind of ['meltOperations', 'mintOperations', 'receiveOperations']) {
    const repository = `${kind.slice(0, -1)}Repository`;
    if (!has(repository, 'create')) continue;
    written[kind] = records[kind];
    for (const operation of records[kind]) await repositories[repository].create(operation);
  }
  return written;
}

const options = parseArguments(process.argv.slice(2));
const installed = installOldPackages(options);
const name = `${options.adapter.replace('@', '').replace('/', '-')}@${options.version}`;
mkdirSync(options.out, { recursive: true });
const file = join(options.out, `${name}.db`);
rmSync(file, { force: true });

const { ExpoSqliteRepositories } = await importFromInstall(installed.directory, options.adapter);
// From 2.0.0 a quote's amounts cross the repository as cashu-ts's Amount, the old core's copy of it.
const cashu = await importFromInstall(installed.directory, '@cashu/cashu-ts').catch(() => ({}));
const toAmount = (value) => (cashu.Amount ? cashu.Amount.from(value) : value);
const database = new ExpoSqliteOnNode(file);
// Coco makes some forty tables and indexes, a page each. Small pages keep the committed file to
// tens of kilobytes; the page size is storage layout and changes nothing a query can see.
database.native.exec('PRAGMA page_size = 512');
const repositories = new ExpoSqliteRepositories({ database });
await repositories.init();
const migrations = (
  await database.getAllAsync('SELECT id FROM coco_cashu_migrations ORDER BY id')
).map((row) => row.id);
const written = await write(repositories, migrations, toAmount);
await database.closeAsync();

// What was written, for the test to assert from; and the folder's index, in the order shipped.
writeFileSync(
  join(options.out, `${name}.json`),
  `${JSON.stringify({ package: options.adapter, version: options.version, lastMigrationAtWrite: migrations.at(-1), written }, null, 2)}\n`
);
const manifestFile = join(options.out, 'manifest.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : [];
const entry = {
  package: options.adapter,
  version: options.version,
  corePackage: installed.core,
  coreVersion: options.coreVersion,
  releases: options.releases,
  database: `${name}.db`,
  written: `${name}.json`,
  sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
};
const existing = manifest.findIndex((other) => other.database === entry.database);
// A new version is the newest; writing an old one again keeps its place.
if (existing === -1) manifest.push(entry);
else manifest[existing] = entry;
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
if (installed.temporary) rmSync(installed.directory, { recursive: true, force: true });
console.log(`${file}\n  ${migrations.length} migrations, last ${migrations.at(-1)}`);
console.log(`  ${written.proofs.length} proofs; also wrote ${Object.keys(written).join(', ')}`);
