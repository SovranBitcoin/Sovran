import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  deriveSovranAccount0CashuSeed,
  establishFundedRecovery,
  openFundedRecovery,
  type CocodCounterparty,
  type DeclaredRecoveryAsset,
  type FundedRecoveryReport,
} from '../funded';
import type { FundedRecovery } from '../funded/funded-recovery';
import { durableReplaceFile, ensurePrivateDirectory } from '../ledger/durable';

const LEGACY_SEEDS_FILE = 'legacy-SEEDS.json';
const METRO_LOG_FILE = 'metro.log';
const SUMMARY_FILE = 'legacy-recovery-summary.json';
const SEED_EXPORT_MARKER = 'E2E_SEED_EXPORT';
const CAPTURED_SEED_EXPORT = `${SEED_EXPORT_MARKER} [captured]`;
const CAPTURED_SEED_LINE = /\bE2E_SEED_EXPORT \[captured\](?:\s*(?:\x1b\[[0-9;]*m)?\s*)$/;
const LEGACY_SEED_EXPORT_PATTERN =
  /\bE2E_SEED_EXPORT\s+((?:[a-z]+\s+){11}[a-z]+(?:\s+[a-z]+){0,12})(?=\s*(?:\x1b\[[0-9;]*m)?\s*$)/;

function sanitizeLegacyMetroLogLine(
  line: string,
  onSeedExport: (mnemonic: string) => void
): string {
  const match = line.match(LEGACY_SEED_EXPORT_PATTERN);
  if (!match) throw new Error('malformed legacy E2E seed export');
  onSeedExport(match[1]);
  return line.replace(match[0], CAPTURED_SEED_EXPORT);
}

export interface LegacyRecoveryPort {
  readonly custodyPath: string;
  readonly assets: DeclaredRecoveryAsset[];
  reconcile(dependencies: {
    cocod: CocodCounterparty;
    acceptEmptyAssets?: readonly DeclaredRecoveryAsset[];
  }): Promise<FundedRecoveryReport>;
  disposePrivateMaterial(): void;
}

export interface LegacyRecoveryFactory {
  establish(options: {
    runDir: string;
    appMnemonic: string;
    assets: readonly DeclaredRecoveryAsset[];
  }): LegacyRecoveryPort;
  open(options: { runDir: string }): LegacyRecoveryPort;
}

interface LegacyRecoverySummary {
  version: 2;
  status: 'reconciled' | 'deferred';
  sourceRecords: {
    legacyJson: number;
    custody: number;
    metro: number;
  };
  uniqueSeeds: number;
  declaredAssets: number;
  reconciledCustodies: number;
  retainedCombinedCustodies: number;
  deferredAssets: LegacyDeferredAsset[];
  completedAt: string;
}

interface LegacyDeferredAsset extends DeclaredRecoveryAsset {
  custodyCount: number;
}

interface LegacyRecoveryResult {
  status: 'clean' | 'deferred';
  summaryPath?: string;
  summary?: LegacyRecoverySummary;
}

interface LegacyRecoveryAudit {
  status: 'clean' | 'deferred' | 'blocked';
  canRunRequiredAssets: boolean;
  deferredAssets: LegacyDeferredAsset[];
  retainedCombinedCustodies: number;
  reason?: 'unmanaged-sources' | 'invalid-quarantine';
}

interface RecoverLegacyArtifactsOptions {
  artifactsRoot: string;
  cocod: CocodCounterparty;
  assets: readonly DeclaredRecoveryAsset[];
  /** All known legacy assets are quarantined, but only these locations are
   * retried now. Omit to attempt every declared asset. */
  requiredAssets?: readonly Pick<DeclaredRecoveryAsset, 'mintUrl' | 'unit' | 'accountIndex'>[];
  factory?: LegacyRecoveryFactory;
  now?: () => Date;
  /** Reachability probe used to scope a failed combined-custody retirement to
   * the mints that are actually unverifiable. Injectable for tests; defaults
   * to a bounded GET of the mint's /v1/info. */
  probeMintHealth?: (mintUrl: string) => Promise<boolean>;
}

interface AuditLegacyArtifactsOptions {
  artifactsRoot: string;
  requiredAssets?: readonly Pick<DeclaredRecoveryAsset, 'mintUrl' | 'unit' | 'accountIndex'>[];
}

interface CustodySource {
  secretPath: string;
  sidecarPath: string;
}

interface MetroSource {
  path: string;
  sanitized: string;
  rawRecords: number;
}

interface DiscoveredSources {
  seeds: string[];
  legacyPath?: string;
  legacyRecords: number;
  custody: CustodySource[];
  metro?: MetroSource;
}

interface LegacyAssetTask {
  seedDigest: string;
  runDir: string;
  asset: DeclaredRecoveryAsset;
  manifestPath: string;
  statusPath: string;
  recoveryPath: string;
}

interface LegacyTaskStatus {
  version: 1;
  phase: 'validated' | 'reconciled';
  asset: DeclaredRecoveryAsset;
  reconciliation: Omit<FundedRecoveryReport['assets'][number], 'asset'>;
}

const DEFAULT_FACTORY: LegacyRecoveryFactory = {
  establish: (options) => establishFundedRecovery(options) as FundedRecovery,
  open: (options) => openFundedRecovery(options) as FundedRecovery,
};

function assertPrivateRegularFile(path: string, context: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error(`${context} is unavailable`);
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (stat.mode & 0o600) !== 0o600
  ) {
    throw new Error(`${context} is not a private regular file`);
  }
}

function assertPrivateDirectory(path: string, context: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${context} is not a private directory`);
  }
}

function parseJson(path: string, context: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${context} is malformed`);
  }
}

function discoverLegacyJson(artifactsRoot: string): {
  path?: string;
  seeds: string[];
  records: number;
} {
  const path = join(artifactsRoot, LEGACY_SEEDS_FILE);
  if (!existsSync(path)) return { seeds: [], records: 0 };
  assertPrivateRegularFile(path, 'legacy seed artifact');
  const value = parseJson(path, 'legacy seed artifact');
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('legacy seed artifact must be a non-empty record array');
  }
  const seeds = value.map((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('legacy seed artifact contains an invalid record');
    }
    const seed = (record as Record<string, unknown>).seed;
    if (typeof seed !== 'string' || seed.trim().length === 0) {
      throw new Error('legacy seed artifact record has no seed field');
    }
    return seed;
  });
  return { path, seeds, records: value.length };
}

function strictSidecar(
  value: unknown,
  expectedId: string
): {
  id: string;
  kind: 'mnemonic';
  len: number;
  fingerprint: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('legacy custody sidecar is malformed');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'fingerprint,id,kind,len') {
    throw new Error('legacy custody sidecar has an invalid shape');
  }
  if (
    record.id !== expectedId ||
    record.kind !== 'mnemonic' ||
    !Number.isSafeInteger(record.len) ||
    (record.len as number) <= 0 ||
    typeof record.fingerprint !== 'string' ||
    !/^[0-9a-f]{12}$/.test(record.fingerprint)
  ) {
    throw new Error('legacy custody sidecar failed validation');
  }
  return record as {
    id: string;
    kind: 'mnemonic';
    len: number;
    fingerprint: string;
  };
}

function discoverCustody(artifactsRoot: string): { seeds: string[]; sources: CustodySource[] } {
  const dir = join(artifactsRoot, 'custody', 'custody');
  if (!existsSync(dir)) return { seeds: [], sources: [] };
  assertPrivateDirectory(dir, 'legacy custody directory');
  const entries = readdirSync(dir, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  const files = new Map<string, Set<'secret' | 'json'>>();
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('legacy custody directory contains a non-file entry');
    }
    const match = entry.name.match(/^([0-9a-f]{16})\.(secret|json)$/);
    if (!match) throw new Error('legacy custody directory contains an unknown file');
    const extension = match[2] as 'secret' | 'json';
    const extensions = files.get(match[1]) ?? new Set<'secret' | 'json'>();
    if (extensions.has(extension)) throw new Error('legacy custody contains a duplicate file');
    extensions.add(extension);
    files.set(match[1], extensions);
  }

  const seeds: string[] = [];
  const sources: CustodySource[] = [];
  for (const [id, extensions] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    if (!extensions.has('secret') && extensions.has('json')) {
      const retiredSidecarPath = join(dir, `${id}.json`);
      assertPrivateRegularFile(retiredSidecarPath, 'retired legacy custody sidecar');
      strictSidecar(parseJson(retiredSidecarPath, 'retired legacy custody sidecar'), id);
      continue;
    }
    if (!extensions.has('secret') || !extensions.has('json')) {
      throw new Error('legacy custody is missing its matching source or sidecar');
    }
    const secretPath = join(dir, `${id}.secret`);
    const sidecarPath = join(dir, `${id}.json`);
    assertPrivateRegularFile(secretPath, 'legacy custody source');
    assertPrivateRegularFile(sidecarPath, 'legacy custody sidecar');
    const sidecar = strictSidecar(parseJson(sidecarPath, 'legacy custody sidecar'), id);
    const raw = readFileSync(secretPath, 'utf8');
    const digest = createHash('sha256').update(raw).digest('hex');
    if (
      raw.length !== sidecar.len ||
      digest.slice(0, 16) !== sidecar.id ||
      digest.slice(0, 12) !== sidecar.fingerprint
    ) {
      throw new Error('legacy custody source does not match its safe sidecar');
    }
    seeds.push(raw);
    sources.push({ secretPath, sidecarPath });
  }
  return { seeds, sources };
}

function linesPreservingEndings(value: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (;;) {
    const newline = value.indexOf('\n', start);
    if (newline === -1) break;
    lines.push(value.slice(start, newline + 1));
    start = newline + 1;
  }
  if (start < value.length) lines.push(value.slice(start));
  return lines;
}

function markerCount(line: string): number {
  return line.split(SEED_EXPORT_MARKER).length - 1;
}

function discoverMetro(artifactsRoot: string): { seeds: string[]; source?: MetroSource } {
  const path = join(artifactsRoot, METRO_LOG_FILE);
  if (!existsSync(path)) return { seeds: [] };
  assertPrivateRegularFile(path, 'legacy Metro log');
  const raw = readFileSync(path, 'utf8');
  const seeds: string[] = [];
  let rawRecords = 0;
  const sanitized = linesPreservingEndings(raw)
    .map((line) => {
      const count = markerCount(line);
      if (count === 0) return line;
      if (count !== 1) throw new Error('legacy Metro log contains an ambiguous seed record');
      if (line.includes(CAPTURED_SEED_EXPORT)) {
        if (!CAPTURED_SEED_LINE.test(line)) {
          throw new Error('legacy Metro log contains a malformed captured seed record');
        }
        return line;
      }
      let captured: string | undefined;
      let replacement: string;
      try {
        replacement = sanitizeLegacyMetroLogLine(line, (seed) => {
          if (captured !== undefined) throw new Error('duplicate seed callback');
          captured = seed;
        });
      } catch {
        throw new Error('legacy Metro log contains a malformed seed record');
      }
      if (!captured || !replacement.includes(CAPTURED_SEED_EXPORT)) {
        throw new Error('legacy Metro log seed record could not be sanitized');
      }
      seeds.push(captured);
      rawRecords++;
      return replacement;
    })
    .join('');
  return { seeds, source: { path, sanitized, rawRecords } };
}

function discoverSources(artifactsRoot: string): DiscoveredSources {
  const legacy = discoverLegacyJson(artifactsRoot);
  const custody = discoverCustody(artifactsRoot);
  const metro = discoverMetro(artifactsRoot);
  return {
    seeds: [...legacy.seeds, ...custody.seeds, ...metro.seeds],
    legacyPath: legacy.path,
    legacyRecords: legacy.records,
    custody: custody.sources,
    metro: metro.source,
  };
}

function declaredAssets(input: readonly DeclaredRecoveryAsset[]): DeclaredRecoveryAsset[] {
  if (input.length === 0) throw new Error('legacy recovery requires a declared SAT mint list');
  const seen = new Set<string>();
  let total = 0;
  return input.map((asset) => {
    let url: URL;
    try {
      url = new URL(asset.mintUrl);
    } catch {
      throw new Error('legacy recovery contains an invalid declared mint');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      asset.unit !== 'sat' ||
      asset.accountIndex !== 0 ||
      !Number.isSafeInteger(asset.maxPrincipal) ||
      asset.maxPrincipal <= 0
    ) {
      throw new Error('legacy recovery requires exact account-0 SAT assets');
    }
    const id = `${asset.mintUrl}\u0000sat\u00000`;
    if (seen.has(id)) throw new Error('legacy recovery contains a duplicate declared asset');
    seen.add(id);
    total += asset.maxPrincipal;
    if (!Number.isSafeInteger(total))
      throw new Error('legacy recovery principal exceeds safe range');
    return { ...asset };
  });
}

function validatedUniqueSeeds(input: readonly string[]): { digest: string; mnemonic: string }[] {
  const unique = new Map<string, string>();
  for (const raw of input) {
    const mnemonic = raw.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
    try {
      const derived = deriveSovranAccount0CashuSeed(mnemonic);
      derived.fill(0);
    } catch {
      throw new Error('legacy recovery contains invalid seed custody');
    }
    const digest = createHash('sha256').update(mnemonic).digest('hex');
    const previous = unique.get(digest);
    if (previous !== undefined && previous !== mnemonic) {
      throw new Error('legacy recovery seed identity collision');
    }
    unique.set(digest, mnemonic);
  }
  return [...unique]
    .map(([digest, mnemonic]) => ({ digest, mnemonic }))
    .sort((left, right) => left.digest.localeCompare(right.digest));
}

const assetId = (asset: Pick<DeclaredRecoveryAsset, 'mintUrl' | 'unit' | 'accountIndex'>): string =>
  `${asset.mintUrl}\u0000${asset.unit}\u0000${asset.accountIndex}`;

const exactAssetId = (asset: DeclaredRecoveryAsset): string =>
  `${assetId(asset)}\u0000${asset.maxPrincipal}`;

const assetDirectoryName = (asset: DeclaredRecoveryAsset): string =>
  `asset-${createHash('sha256').update(exactAssetId(asset)).digest('hex')}`;

function sameAssets(
  left: readonly DeclaredRecoveryAsset[],
  right: readonly DeclaredRecoveryAsset[]
): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(left.map(exactAssetId));
  return right.every((asset) => expected.has(exactAssetId(asset)));
}

function parseAsset(value: unknown, context: string): DeclaredRecoveryAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} has no declared asset`);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'accountIndex,maxPrincipal,mintUrl,unit' ||
    typeof record.mintUrl !== 'string' ||
    record.unit !== 'sat' ||
    record.accountIndex !== 0 ||
    !Number.isSafeInteger(record.maxPrincipal) ||
    (record.maxPrincipal as number) <= 0
  ) {
    throw new Error(`${context} contains an invalid asset`);
  }
  return declaredAssets([record as unknown as DeclaredRecoveryAsset])[0];
}

function writeTaskManifest(path: string, asset: DeclaredRecoveryAsset): void {
  durableReplaceFile(path, JSON.stringify({ version: 1, asset }), 0o600);
}

function readTaskManifest(path: string): DeclaredRecoveryAsset {
  assertPrivateRegularFile(path, 'legacy quarantine manifest');
  const value = parseJson(path, 'legacy quarantine manifest');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('legacy quarantine manifest is malformed');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'asset,version' || record.version !== 1) {
    throw new Error('legacy quarantine manifest has an invalid shape');
  }
  return parseAsset(record.asset, 'legacy quarantine manifest');
}

function writeTaskStatus(
  path: string,
  phase: LegacyTaskStatus['phase'],
  asset: DeclaredRecoveryAsset,
  reconciliation: LegacyTaskStatus['reconciliation']
): void {
  durableReplaceFile(path, JSON.stringify({ version: 1, phase, asset, reconciliation }), 0o600);
}

function parseTaskReconciliation(
  value: unknown,
  asset: DeclaredRecoveryAsset
): LegacyTaskStatus['reconciliation'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('legacy quarantine status has no exact reconciliation');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !==
    'counterpartyDelta,receiveFee,residualAmount,restoredAmount,sendFee,tokenAmount'
  ) {
    throw new Error('legacy quarantine status has an invalid reconciliation shape');
  }
  const reconciliation = record as unknown as LegacyTaskStatus['reconciliation'];
  validateExactReport([asset], {
    assets: [{ asset, ...reconciliation }],
    counterpartyTokens: [],
  });
  return reconciliation;
}

function readTaskStatus(path: string): LegacyTaskStatus {
  assertPrivateRegularFile(path, 'legacy quarantine status');
  const value = parseJson(path, 'legacy quarantine status');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('legacy quarantine status is malformed');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'asset,phase,reconciliation,version' ||
    record.version !== 1 ||
    (record.phase !== 'validated' && record.phase !== 'reconciled')
  ) {
    throw new Error('legacy quarantine status has an invalid shape');
  }
  const asset = parseAsset(record.asset, 'legacy quarantine status');
  return {
    version: 1,
    phase: record.phase,
    asset,
    reconciliation: parseTaskReconciliation(record.reconciliation, asset),
  };
}

function taskFor(
  workRoot: string,
  seedDigest: string,
  asset: DeclaredRecoveryAsset
): LegacyAssetTask {
  const runDir = join(workRoot, `seed-${seedDigest}`, assetDirectoryName(asset));
  return {
    seedDigest,
    runDir,
    asset,
    manifestPath: join(runDir, 'asset.json'),
    statusPath: join(runDir, 'reconciliation.json'),
    recoveryPath: join(runDir, 'funded-custody', 'recovery.json'),
  };
}

function listManagedTasks(workRoot: string): LegacyAssetTask[] {
  if (!existsSync(workRoot)) return [];
  assertPrivateDirectory(workRoot, 'legacy recovery work directory');
  const tasks: LegacyAssetTask[] = [];
  for (const seedEntry of readdirSync(workRoot, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (
      !seedEntry.isDirectory() ||
      seedEntry.isSymbolicLink() ||
      !/^seed-[0-9a-f]{64}$/.test(seedEntry.name)
    ) {
      throw new Error('legacy recovery work contains an invalid seed directory');
    }
    const seedDir = join(workRoot, seedEntry.name);
    assertPrivateDirectory(seedDir, 'legacy seed work directory');
    for (const entry of readdirSync(seedDir, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      // The first implementation used one combined recovery directly below the
      // seed directory. It remains private and is retired only after every split
      // asset task has reconciled.
      if (entry.name === 'funded-custody' && entry.isDirectory() && !entry.isSymbolicLink())
        continue;
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !/^asset-[0-9a-f]{64}$/.test(entry.name)
      ) {
        throw new Error('legacy seed work contains an invalid asset directory');
      }
      const runDir = join(seedDir, entry.name);
      assertPrivateDirectory(runDir, 'legacy asset work directory');
      const manifestPath = join(runDir, 'asset.json');
      const asset = readTaskManifest(manifestPath);
      if (entry.name !== assetDirectoryName(asset)) {
        throw new Error('legacy asset work directory does not match its manifest');
      }
      tasks.push({
        seedDigest: seedEntry.name.slice('seed-'.length),
        runDir,
        asset,
        manifestPath,
        statusPath: join(runDir, 'reconciliation.json'),
        recoveryPath: join(runDir, 'funded-custody', 'recovery.json'),
      });
    }
  }
  return tasks;
}

function managedSeedDigests(workRoot: string): string[] {
  if (!existsSync(workRoot)) return [];
  assertPrivateDirectory(workRoot, 'legacy recovery work directory');
  return readdirSync(workRoot, { withFileTypes: true })
    .map((entry) => {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !/^seed-[0-9a-f]{64}$/.test(entry.name)
      ) {
        throw new Error('legacy recovery work contains an invalid seed directory');
      }
      return entry.name.slice('seed-'.length);
    })
    .sort();
}

function safeAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateExactReport(
  assets: readonly DeclaredRecoveryAsset[],
  report: FundedRecoveryReport
): void {
  if (report.counterpartyTokens.length !== 0 || report.assets.length !== assets.length) {
    throw new Error('legacy recovery returned an unexpected report shape');
  }
  const seen = new Set<string>();
  for (const item of report.assets) {
    const id = `${item.asset.mintUrl}\u0000${item.asset.unit}\u0000${item.asset.accountIndex}`;
    const declared = assets.find(
      (asset) =>
        `${asset.mintUrl}\u0000${asset.unit}\u0000${asset.accountIndex}` === id &&
        asset.maxPrincipal === item.asset.maxPrincipal
    );
    if (!declared || seen.has(id)) throw new Error('legacy recovery report asset mismatch');
    seen.add(id);
    if (
      ![
        item.restoredAmount,
        item.tokenAmount,
        item.counterpartyDelta,
        item.sendFee,
        item.receiveFee,
        item.residualAmount,
      ].every(safeAmount) ||
      item.residualAmount !== 0 ||
      item.restoredAmount > declared.maxPrincipal ||
      item.restoredAmount !== item.tokenAmount + item.sendFee ||
      item.tokenAmount !== item.counterpartyDelta + item.receiveFee
    ) {
      throw new Error('legacy recovery report failed exact conservation');
    }
  }
}

function assertRecoveryOwnsTask(recovery: LegacyRecoveryPort, task: LegacyAssetTask): void {
  if (!sameAssets(recovery.assets, [task.asset])) {
    throw new Error('managed legacy recovery does not match its asset task');
  }
}

function taskStatus(task: LegacyAssetTask): LegacyTaskStatus | undefined {
  if (!existsSync(task.statusPath)) return undefined;
  const status = readTaskStatus(task.statusPath);
  if (exactAssetId(status.asset) !== exactAssetId(task.asset)) {
    throw new Error('legacy quarantine status does not match its manifest');
  }
  if (status.phase === 'reconciled' && existsSync(task.recoveryPath)) {
    throw new Error('reconciled legacy task retained private custody');
  }
  return status;
}

async function reconcileTask(
  task: LegacyAssetTask,
  cocod: CocodCounterparty,
  factory: LegacyRecoveryFactory
): Promise<boolean> {
  const existing = taskStatus(task);
  if (existing?.phase === 'reconciled') return true;
  if (existing?.phase === 'validated') {
    if (existsSync(task.recoveryPath)) {
      const recovery = factory.open({ runDir: task.runDir });
      assertRecoveryOwnsTask(recovery, task);
      try {
        recovery.disposePrivateMaterial();
      } catch {
        return false;
      }
    }
    writeTaskStatus(task.statusPath, 'reconciled', task.asset, existing.reconciliation);
    return true;
  }
  if (!existsSync(task.recoveryPath)) {
    throw new Error('unreconciled legacy task has no private custody');
  }
  const recovery = factory.open({ runDir: task.runDir });
  assertRecoveryOwnsTask(recovery, task);
  let report: FundedRecoveryReport;
  try {
    report = await recovery.reconcile({ cocod, acceptEmptyAssets: [task.asset] });
    validateExactReport([task.asset], report);
  } catch {
    return false;
  }
  // Persist the exact terminal proof before deleting its seed. A crash before
  // the second phase either retries disposal or promotes this record when the
  // custody unlink already succeeded.
  const { asset: _asset, ...reconciliation } = report.assets[0];
  writeTaskStatus(task.statusPath, 'validated', task.asset, reconciliation);
  try {
    recovery.disposePrivateMaterial();
  } catch {
    return false;
  }
  if (existsSync(recovery.custodyPath)) return false;
  writeTaskStatus(task.statusPath, 'reconciled', task.asset, reconciliation);
  return true;
}

function combinedRecoveryPath(workRoot: string, seedDigest: string): string {
  return join(workRoot, `seed-${seedDigest}`, 'funded-custody', 'recovery.json');
}

async function retireCombinedRecovery(
  workRoot: string,
  seedDigest: string,
  assets: readonly DeclaredRecoveryAsset[],
  cocod: CocodCounterparty,
  factory: LegacyRecoveryFactory
): Promise<boolean> {
  const path = combinedRecoveryPath(workRoot, seedDigest);
  if (!existsSync(path)) return true;
  const runDir = join(workRoot, `seed-${seedDigest}`);
  const recovery = factory.open({ runDir });
  if (!sameAssets(recovery.assets, assets)) {
    throw new Error('combined legacy recovery does not match declared assets');
  }
  try {
    const report = await recovery.reconcile({ cocod, acceptEmptyAssets: assets });
    validateExactReport(assets, report);
    recovery.disposePrivateMaterial();
  } catch {
    return false;
  }
  return !existsSync(path);
}

async function defaultMintHealthProbe(mintUrl: string): Promise<boolean> {
  try {
    const base = mintUrl.endsWith('/') ? mintUrl : `${mintUrl}/`;
    // Bare `fetch` on purpose: this is e2e-harness code running under Bun, not
    // in the app runtime, and the probe only wants reachability — it reads
    // `response.ok` and never parses a body, so `fetchJson`'s zod envelope and
    // redaction buy nothing here.
    // eslint-disable-next-line no-restricted-globals
    const response = await fetch(new URL('v1/info', base), { signal: AbortSignal.timeout(5_000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** The assets whose mints fail a reachability probe right now. Used to scope a
 * failed combined-custody retirement: a combined recovery re-verifies every
 * declared mint atomically, so one unreachable mint would otherwise taint all
 * of them and block funded runs on healthy mints whose legs are already
 * individually proven empty. */
async function unverifiableAssets(
  assets: readonly DeclaredRecoveryAsset[],
  probe: (mintUrl: string) => Promise<boolean>
): Promise<DeclaredRecoveryAsset[]> {
  const unreachable: DeclaredRecoveryAsset[] = [];
  for (const asset of assets) {
    if (!(await probe(asset.mintUrl))) unreachable.push(asset);
  }
  return unreachable;
}

function aggregateDeferred(tasks: readonly LegacyAssetTask[]): LegacyDeferredAsset[] {
  const deferred = new Map<string, LegacyDeferredAsset>();
  for (const task of tasks) {
    if (taskStatus(task)?.phase === 'reconciled') continue;
    const id = exactAssetId(task.asset);
    const current = deferred.get(id);
    if (current) current.custodyCount++;
    else deferred.set(id, { ...task.asset, custodyCount: 1 });
  }
  return [...deferred.values()].sort((left, right) =>
    exactAssetId(left).localeCompare(exactAssetId(right))
  );
}

function allTasksForEachSeed(
  tasks: readonly LegacyAssetTask[],
  seedDigests: readonly string[],
  assets: readonly DeclaredRecoveryAsset[]
): boolean {
  const found = new Set(tasks.map((task) => `${task.seedDigest}\u0000${exactAssetId(task.asset)}`));
  return seedDigests.every((seedDigest) =>
    assets.every((asset) => found.has(`${seedDigest}\u0000${exactAssetId(asset)}`))
  );
}

function taskHasDurableCustodyOrProof(task: LegacyAssetTask): boolean {
  const status = taskStatus(task);
  if (status) return true;
  if (!existsSync(task.recoveryPath)) return false;
  assertPrivateRegularFile(task.recoveryPath, 'legacy deferred recovery custody');
  return true;
}

function retainedCombinedCustodies(workRoot: string, seedDigests: readonly string[]): number {
  let count = 0;
  for (const seedDigest of seedDigests) {
    const path = combinedRecoveryPath(workRoot, seedDigest);
    if (!existsSync(path)) continue;
    assertPrivateRegularFile(path, 'combined legacy recovery custody');
    count++;
  }
  return count;
}

function syncDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    fsyncSync(fd);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(code)) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function durableUnlink(path: string): void {
  unlinkSync(path);
  syncDirectory(dirname(path));
}

function parseExistingSummary(path: string): LegacyRecoverySummary {
  assertPrivateRegularFile(path, 'legacy recovery summary');
  const value = parseJson(path, 'legacy recovery summary');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('legacy recovery summary is malformed');
  }
  const rawSummary = value as Record<string, unknown>;
  if (rawSummary.version === 1) {
    if (
      Object.keys(rawSummary).sort().join(',') !==
        'completedAt,declaredAssets,sourceRecords,status,uniqueSeeds,version' ||
      rawSummary.status !== 'reconciled' ||
      !rawSummary.sourceRecords ||
      typeof rawSummary.sourceRecords !== 'object' ||
      Array.isArray(rawSummary.sourceRecords) ||
      Object.keys(rawSummary.sourceRecords).sort().join(',') !== 'custody,legacyJson,metro'
    ) {
      throw new Error('legacy recovery v1 summary has an invalid shape');
    }
    const sourceRecords = rawSummary.sourceRecords as Record<string, unknown>;
    if (
      !safeAmount(sourceRecords.legacyJson as number) ||
      !safeAmount(sourceRecords.custody as number) ||
      !safeAmount(sourceRecords.metro as number) ||
      !safeAmount(rawSummary.uniqueSeeds as number) ||
      !safeAmount(rawSummary.declaredAssets as number) ||
      typeof rawSummary.completedAt !== 'string' ||
      !Number.isFinite(Date.parse(rawSummary.completedAt))
    ) {
      throw new Error('legacy recovery v1 summary failed validation');
    }
    const reconciledCustodies =
      (rawSummary.uniqueSeeds as number) * (rawSummary.declaredAssets as number);
    if (!Number.isSafeInteger(reconciledCustodies)) {
      throw new Error('legacy recovery v1 summary exceeds safe counts');
    }
    return {
      version: 2,
      status: 'reconciled',
      sourceRecords: sourceRecords as unknown as LegacyRecoverySummary['sourceRecords'],
      uniqueSeeds: rawSummary.uniqueSeeds as number,
      declaredAssets: rawSummary.declaredAssets as number,
      reconciledCustodies,
      retainedCombinedCustodies: 0,
      deferredAssets: [],
      completedAt: rawSummary.completedAt,
    };
  }
  if (
    Object.keys(rawSummary).sort().join(',') !==
    'completedAt,declaredAssets,deferredAssets,reconciledCustodies,retainedCombinedCustodies,sourceRecords,status,uniqueSeeds,version'
  ) {
    throw new Error('legacy recovery summary has an invalid shape');
  }
  const summary = value as Partial<LegacyRecoverySummary>;
  if (
    !summary.sourceRecords ||
    typeof summary.sourceRecords !== 'object' ||
    Array.isArray(summary.sourceRecords) ||
    Object.keys(summary.sourceRecords).sort().join(',') !== 'custody,legacyJson,metro'
  ) {
    throw new Error('legacy recovery summary has invalid source counts');
  }
  if (
    summary.version !== 2 ||
    (summary.status !== 'reconciled' && summary.status !== 'deferred') ||
    !safeAmount(summary.sourceRecords.legacyJson) ||
    !safeAmount(summary.sourceRecords.custody) ||
    !safeAmount(summary.sourceRecords.metro) ||
    !safeAmount(summary.uniqueSeeds ?? -1) ||
    !safeAmount(summary.declaredAssets ?? -1) ||
    !safeAmount(summary.reconciledCustodies ?? -1) ||
    !safeAmount(summary.retainedCombinedCustodies ?? -1) ||
    !Array.isArray(summary.deferredAssets) ||
    typeof summary.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(summary.completedAt))
  ) {
    throw new Error('legacy recovery summary failed validation');
  }
  const deferred = new Set<string>();
  summary.deferredAssets = summary.deferredAssets.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('legacy recovery summary has an invalid deferred asset');
    }
    const record = value as unknown as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(',') !==
        'accountIndex,custodyCount,maxPrincipal,mintUrl,unit' ||
      !Number.isSafeInteger(record.custodyCount) ||
      (record.custodyCount as number) <= 0
    ) {
      throw new Error('legacy recovery summary has an invalid deferred asset');
    }
    const { custodyCount, ...assetValue } = record;
    const asset = parseAsset(assetValue, 'legacy recovery summary');
    const id = exactAssetId(asset);
    if (deferred.has(id)) throw new Error('legacy recovery summary repeats a deferred asset');
    deferred.add(id);
    return { ...asset, custodyCount: custodyCount as number };
  });
  if (
    (summary.status === 'reconciled' && summary.deferredAssets.length !== 0) ||
    (summary.status === 'deferred' && summary.deferredAssets.length === 0)
  ) {
    throw new Error('legacy recovery summary status contradicts its deferred assets');
  }
  return summary as LegacyRecoverySummary;
}

function prepareTasks(
  workRoot: string,
  seeds: readonly { digest: string; mnemonic: string }[],
  assets: readonly DeclaredRecoveryAsset[],
  factory: LegacyRecoveryFactory
): LegacyAssetTask[] {
  ensurePrivateDirectory(workRoot);
  for (const seed of seeds) {
    const seedDir = join(workRoot, `seed-${seed.digest}`);
    ensurePrivateDirectory(seedDir);
    for (const asset of assets) {
      const task = taskFor(workRoot, seed.digest, asset);
      ensurePrivateDirectory(task.runDir);
      if (existsSync(task.manifestPath)) {
        if (exactAssetId(readTaskManifest(task.manifestPath)) !== exactAssetId(asset)) {
          throw new Error('legacy quarantine manifest changed its declared asset');
        }
      } else {
        writeTaskManifest(task.manifestPath, asset);
      }
      const status = taskStatus(task);
      if (!status && !existsSync(task.recoveryPath)) {
        const recovery = factory.establish({
          runDir: task.runDir,
          appMnemonic: seed.mnemonic,
          assets: [asset],
        });
        assertRecoveryOwnsTask(recovery, task);
        if (!existsSync(recovery.custodyPath)) {
          throw new Error('legacy quarantine custody was not durably established');
        }
      } else if (existsSync(task.recoveryPath)) {
        assertRecoveryOwnsTask(factory.open({ runDir: task.runDir }), task);
      }
    }
  }
  return listManagedTasks(workRoot);
}

function mergeDeferred(
  current: LegacyDeferredAsset[],
  assets: readonly DeclaredRecoveryAsset[],
  custodyCount: number
): LegacyDeferredAsset[] {
  const merged = new Map(current.map((asset) => [exactAssetId(asset), { ...asset }]));
  for (const asset of assets) {
    const id = exactAssetId(asset);
    const existing = merged.get(id);
    if (existing) existing.custodyCount += custodyCount;
    else merged.set(id, { ...asset, custodyCount });
  }
  return [...merged.values()].sort((left, right) =>
    exactAssetId(left).localeCompare(exactAssetId(right))
  );
}

function sourceCounts(
  sources: DiscoveredSources,
  previous?: LegacyRecoverySummary
): LegacyRecoverySummary['sourceRecords'] {
  const observed = {
    legacyJson: sources.legacyRecords,
    custody: sources.custody.length,
    metro: sources.metro?.rawRecords ?? 0,
  };
  if (!previous) return observed;
  return {
    legacyJson: Math.max(previous.sourceRecords.legacyJson, observed.legacyJson),
    custody: Math.max(previous.sourceRecords.custody, observed.custody),
    metro: Math.max(previous.sourceRecords.metro, observed.metro),
  };
}

function retireRawSources(sources: DiscoveredSources): void {
  if (sources.metro && sources.metro.rawRecords > 0) {
    durableReplaceFile(sources.metro.path, sources.metro.sanitized, 0o600);
  }
  if (sources.legacyPath) durableUnlink(sources.legacyPath);
  for (const source of sources.custody) {
    durableUnlink(source.secretPath);
    durableUnlink(source.sidecarPath);
  }
}

export async function recoverLegacyFundedArtifacts(
  options: RecoverLegacyArtifactsOptions
): Promise<LegacyRecoveryResult> {
  const assets = declaredAssets(options.assets);
  const requiredIds = new Set(
    (options.requiredAssets ?? assets).map((asset) => {
      const declared = assets.find((candidate) => assetId(candidate) === assetId(asset));
      if (!declared) throw new Error('legacy recovery required an undeclared asset');
      return assetId(declared);
    })
  );
  const sources = discoverSources(options.artifactsRoot);
  const summaryPath = join(options.artifactsRoot, SUMMARY_FILE);
  const previousSummary = existsSync(summaryPath) ? parseExistingSummary(summaryPath) : undefined;
  const uniqueSeeds = validatedUniqueSeeds(sources.seeds);
  const workRoot = join(options.artifactsRoot, 'legacy-recovery-work');
  if (uniqueSeeds.length === 0 && !existsSync(workRoot)) {
    return previousSummary
      ? {
          status: previousSummary.status === 'deferred' ? 'deferred' : 'clean',
          summaryPath,
          summary: previousSummary,
        }
      : { status: 'clean' };
  }
  if ((await options.cocod.status()) !== 'UNLOCKED') {
    throw new Error('cocod must be UNLOCKED before legacy funded recovery');
  }

  const factory = options.factory ?? DEFAULT_FACTORY;
  let tasks: LegacyAssetTask[];
  try {
    tasks =
      uniqueSeeds.length > 0
        ? prepareTasks(workRoot, uniqueSeeds, assets, factory)
        : listManagedTasks(workRoot);
    const taskSeeds = [...new Set(tasks.map(({ seedDigest }) => seedDigest))].sort();
    const workSeeds = managedSeedDigests(workRoot);
    // A crash while retiring redundant raw files can leave fewer raw seeds than
    // already-managed seed directories. Both sets remain authoritative here.
    const expectedSeeds = [
      ...new Set([...workSeeds, ...taskSeeds, ...uniqueSeeds.map(({ digest }) => digest)]),
    ].sort();
    if (
      !allTasksForEachSeed(tasks, expectedSeeds, assets) ||
      tasks.some(
        (task) => !assets.some((asset) => exactAssetId(asset) === exactAssetId(task.asset))
      ) ||
      tasks.some((task) => !taskHasDurableCustodyOrProof(task))
    ) {
      throw new Error('legacy quarantine tasks do not match the declared seed and asset set');
    }
  } catch {
    throw new Error(
      'legacy funded quarantine failed; raw sources and managed recovery were retained'
    );
  }

  for (const task of tasks) {
    if (requiredIds.has(assetId(task.asset))) {
      await reconcileTask(task, options.cocod, factory);
    }
  }
  let deferredAssets = aggregateDeferred(tasks);
  const seedDigests = managedSeedDigests(workRoot);
  for (const seedDigest of seedDigests) {
    const seedTasks = tasks.filter((task) => task.seedDigest === seedDigest);
    if (seedTasks.every((task) => taskStatus(task)?.phase === 'reconciled')) {
      const retired = await retireCombinedRecovery(
        workRoot,
        seedDigest,
        assets,
        options.cocod,
        factory
      );
      if (!retired) {
        // The combined custody stays retained either way; only its BLOCKING
        // scope narrows. When specific mints are provably unreachable, defer
        // just those; when the failure has no nameable mint, fail closed and
        // defer every declared asset.
        const unreachable = await unverifiableAssets(
          assets,
          options.probeMintHealth ?? defaultMintHealthProbe
        );
        deferredAssets = mergeDeferred(
          deferredAssets,
          unreachable.length > 0 ? unreachable : assets,
          1
        );
      }
    }
  }

  const reconciledCustodies = tasks.filter(
    (task) => taskStatus(task)?.phase === 'reconciled'
  ).length;
  const combinedCustodies = retainedCombinedCustodies(workRoot, seedDigests);
  const summary: LegacyRecoverySummary = {
    version: 2,
    status: deferredAssets.length > 0 ? 'deferred' : 'reconciled',
    sourceRecords: sourceCounts(sources, previousSummary),
    uniqueSeeds: seedDigests.length,
    declaredAssets: assets.length,
    reconciledCustodies,
    retainedCombinedCustodies: combinedCustodies,
    deferredAssets,
    completedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  ensurePrivateDirectory(options.artifactsRoot);
  durableReplaceFile(summaryPath, JSON.stringify(summary), 0o600);
  // Once every seed+asset has a managed custody or terminal proof, retiring the
  // redundant retired-harness sources cannot make a deferred asset unrecoverable.
  if (sources.seeds.length > 0) {
    if (
      !allTasksForEachSeed(
        tasks,
        uniqueSeeds.map(({ digest }) => digest),
        assets
      ) ||
      tasks.some((task) => !taskHasDurableCustodyOrProof(task))
    ) {
      throw new Error('legacy raw sources cannot retire before every managed custody is durable');
    }
    retireRawSources(sources);
  }
  return {
    status: summary.status === 'deferred' ? 'deferred' : 'clean',
    summaryPath,
    summary,
  };
}

function hasRawLegacySources(artifactsRoot: string): boolean {
  const sources = discoverSources(artifactsRoot);
  return sources.seeds.length > 0;
}

export function auditLegacyFundedArtifacts(
  options: AuditLegacyArtifactsOptions
): LegacyRecoveryAudit {
  try {
    if (hasRawLegacySources(options.artifactsRoot)) {
      return {
        status: 'blocked',
        canRunRequiredAssets: false,
        deferredAssets: [],
        retainedCombinedCustodies: 0,
        reason: 'unmanaged-sources',
      };
    }
    const summaryPath = join(options.artifactsRoot, SUMMARY_FILE);
    const workRoot = join(options.artifactsRoot, 'legacy-recovery-work');
    if (!existsSync(summaryPath) && !existsSync(workRoot)) {
      return {
        status: 'clean',
        canRunRequiredAssets: true,
        deferredAssets: [],
        retainedCombinedCustodies: 0,
      };
    }
    if (!existsSync(summaryPath)) throw new Error('legacy quarantine has no summary');
    const summary = parseExistingSummary(summaryPath);
    const tasks = listManagedTasks(workRoot);
    const workSeeds = managedSeedDigests(workRoot);
    const taskSeeds = new Set(tasks.map(({ seedDigest }) => seedDigest));
    const taskAssets = new Set(tasks.map(({ asset }) => exactAssetId(asset)));
    const reconciled = tasks.filter((task) => taskStatus(task)?.phase === 'reconciled').length;
    const taskDeferred = aggregateDeferred(tasks);
    const combined = retainedCombinedCustodies(workRoot, workSeeds);
    const completedV1WithoutTaskRecords =
      tasks.length === 0 &&
      summary.status === 'reconciled' &&
      summary.retainedCombinedCustodies === 0 &&
      summary.reconciledCustodies === summary.uniqueSeeds * summary.declaredAssets;
    if (
      (!completedV1WithoutTaskRecords &&
        (workSeeds.length !== summary.uniqueSeeds ||
          taskSeeds.size !== summary.uniqueSeeds ||
          taskAssets.size !== summary.declaredAssets ||
          reconciled !== summary.reconciledCustodies)) ||
      tasks.some((task) => !taskHasDurableCustodyOrProof(task)) ||
      combined !== summary.retainedCombinedCustodies ||
      taskDeferred.some((asset) => {
        const recorded = summary.deferredAssets.find(
          (candidate) => exactAssetId(candidate) === exactAssetId(asset)
        );
        return !recorded || recorded.custodyCount < asset.custodyCount;
      }) ||
      (summary.status === 'reconciled' && summary.deferredAssets.length > 0)
    ) {
      throw new Error('legacy quarantine summary does not match managed custody');
    }
    const required = options.requiredAssets ?? [];
    const blocked = summary.deferredAssets.some((deferred) =>
      required.some((asset) => assetId(asset) === assetId(deferred))
    );
    return {
      status: blocked ? 'blocked' : summary.status === 'deferred' ? 'deferred' : 'clean',
      canRunRequiredAssets: !blocked,
      deferredAssets: summary.deferredAssets,
      retainedCombinedCustodies: summary.retainedCombinedCustodies,
    };
  } catch {
    return {
      status: 'blocked',
      canRunRequiredAssets: false,
      deferredAssets: [],
      retainedCombinedCustodies: 0,
      reason: 'invalid-quarantine',
    };
  }
}

export function describeRequiredLegacyDeferrals(
  audit: LegacyRecoveryAudit,
  requiredAssets: readonly Pick<DeclaredRecoveryAsset, 'mintUrl' | 'unit' | 'accountIndex'>[]
): string | undefined {
  const required = new Set(requiredAssets.map(assetId));
  const blocked = audit.deferredAssets
    .filter((asset) => required.has(assetId(asset)))
    .sort((left, right) => exactAssetId(left).localeCompare(exactAssetId(right)));
  if (blocked.length === 0) return undefined;
  return blocked
    .map(
      (asset) =>
        `${asset.mintUrl} (${asset.unit}, account ${asset.accountIndex}, ${asset.custodyCount} retained ${asset.custodyCount === 1 ? 'custody' : 'custodies'})`
    )
    .join('; ');
}
