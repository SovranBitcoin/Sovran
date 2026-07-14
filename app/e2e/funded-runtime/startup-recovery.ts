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
import { basename, dirname, join } from 'node:path';

import { z } from 'zod';

import {
  openFundedRecovery,
  type CocodCounterparty,
  type DeclaredRecoveryAsset,
  type FundedRecoveryReport,
  type InspectedCashuToken,
} from '../funded';
import type { FundedRecovery } from '../funded/funded-recovery';
import { deleteRecovery, hasCustody, type CustodyHandle } from '../ledger/custody';
import {
  effectLeasePath,
  parseLedgerText,
  RunLedger,
  type AssetLocation,
  type LedgerEntry,
} from '../ledger/ledger';
import { durableReplaceFile } from '../ledger/durable';

export interface FundedRecoveryPort {
  readonly custodyPath: string;
  readonly assets: DeclaredRecoveryAsset[];
  inspectCashuToken(options: {
    asset: DeclaredRecoveryAsset;
    token: string;
  }): Promise<InspectedCashuToken>;
  reconcile(dependencies: {
    cocod: CocodCounterparty;
    acceptEmptyAssets?: readonly DeclaredRecoveryAsset[];
  }): Promise<FundedRecoveryReport>;
  disposePrivateMaterial(): void;
}

export type FundedRecoveryOpener = (options: { runDir: string }) => FundedRecoveryPort;

export interface FundedRecoverySession {
  runDir: string;
  recoveryPath: string;
  liabilityDir: string;
  ledgerPath: string;
}

export interface FundedRecoveryAuditSession extends FundedRecoverySession {
  recoveryPresent: boolean;
  ledgerPresent: boolean;
  runId?: string;
  legCount: number;
  effectLeaseCount: number;
  internalLeaseCount: number;
}

export interface FundedRecoveryAuditBlocker {
  runDir: string;
  reason:
    | 'invalid-recovery-custody'
    | 'invalid-funded-ledger'
    | 'invalid-runtime-accounting'
    | 'missing-recovery-for-open-liability'
    | 'invalid-effect-lease'
    | 'stale-internal-lease'
    | 'ambiguous-private-temp';
}

export type FundedRecoveryAudit =
  | { status: 'clean'; sessions: []; blockers: [] }
  | {
      status: 'recovery-required';
      sessions: FundedRecoveryAuditSession[];
      blockers: [];
    }
  | {
      status: 'blocked';
      sessions: FundedRecoveryAuditSession[];
      blockers: FundedRecoveryAuditBlocker[];
    };

export interface RecoveredFundedSession {
  runDir: string;
  cancelledLegs: number;
  reconciledLegs: number;
  clearedEffectLeases: number;
}

export interface FundedStartupRecoveryResult {
  status: 'clean';
  recovered: RecoveredFundedSession[];
  audit: FundedRecoveryAudit;
}

interface ManagedSession extends FundedRecoverySession {
  recoveryPresent: boolean;
  ledgerPresent: boolean;
}

interface AssetReport {
  asset: DeclaredRecoveryAsset;
  restored: FundedRecoveryReport['assets'][number];
  tokens: FundedRecoveryReport['counterpartyTokens'];
}

interface LegAccounting {
  recoveredAmount: number;
  sweepFees: number;
}

const recoveryAssetSchema = z.strictObject({
  mintUrl: z.string().url(),
  unit: z.string().min(1).max(16),
  accountIndex: z.literal(0),
  maxPrincipal: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const accountingAssetSchema = z.strictObject({
  asset: recoveryAssetSchema,
  baseline: z.number().int().nonnegative(),
  current: z.number().int().nonnegative(),
});

const accountingObservationSchema = z.strictObject({
  sequence: z.number().int().positive(),
  operation: z.string().min(1).max(100),
  asset: recoveryAssetSchema,
  before: z.number().int().nonnegative(),
  after: z.number().int().nonnegative(),
  delta: z.number().int().safe(),
});

const pendingInvoiceSchema = z.strictObject({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  asset: recoveryAssetSchema,
  amount: z.number().int().positive(),
  beforeBalance: z.number().int().nonnegative(),
  settlementDeadlineMs: z.number().int().nonnegative(),
});

const accountingRecordSchema = z.strictObject({
  version: z.literal(1),
  runId: z.string().min(1),
  assets: z.array(accountingAssetSchema),
  observations: z.array(accountingObservationSchema),
  pendingInvoices: z.array(pendingInvoiceSchema),
  final: z.boolean(),
});

const cashuOutflowBase = {
  version: z.literal(1),
  id: z.string().regex(/^[0-9a-f]{16}$/),
  asset: recoveryAssetSchema,
  amount: z.number().int().positive(),
  tokenFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  beforeBalance: z.number().int().nonnegative(),
};

const cashuOutflowSchema = z.discriminatedUnion('phase', [
  z.strictObject({
    ...cashuOutflowBase,
    phase: z.literal('prepared'),
    token: z.string().min(1),
  }),
  z.strictObject({
    ...cashuOutflowBase,
    phase: z.literal('received'),
    afterBalance: z.number().int().nonnegative(),
    counterpartyDelta: z.number().int().positive(),
  }),
  z.strictObject({
    ...cashuOutflowBase,
    phase: z.literal('spent-uncredited'),
    afterBalance: z.number().int().nonnegative(),
    counterpartyDelta: z.literal(0),
    acceptedTestFundLoss: z.literal(true),
  }),
]);

type RuntimeAccounting = z.infer<typeof accountingRecordSchema>;
type CashuOutflowEvidence = z.infer<typeof cashuOutflowSchema>;
type PreparedCashuOutflow = Extract<CashuOutflowEvidence, { phase: 'prepared' }>;
type ReceivedCashuOutflow = Extract<CashuOutflowEvidence, { phase: 'received' }>;
type SpentUncreditedCashuOutflow = Extract<CashuOutflowEvidence, { phase: 'spent-uncredited' }>;
type TerminalCashuOutflow = ReceivedCashuOutflow | SpentUncreditedCashuOutflow;

interface SessionEvidence {
  accounting: RuntimeAccounting;
  cashuOutflows: TerminalCashuOutflow[];
  effectLeases: string[];
}

const defaultOpenRecovery: FundedRecoveryOpener = (options) =>
  openFundedRecovery(options) as FundedRecovery;

const assetKey = (asset: AssetLocation): string =>
  `${asset.mintUrl}\u0000${asset.unit}\u0000${asset.accountIndex}`;

function regularNodeExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function managedSessions(artifactsRoot: string): ManagedSession[] {
  if (!existsSync(artifactsRoot)) return [];
  const sessions: ManagedSession[] = [];
  for (const runEntry of readdirSync(artifactsRoot, { withFileTypes: true })) {
    if (!runEntry.isDirectory() || runEntry.isSymbolicLink() || !runEntry.name.startsWith('run-')) {
      continue;
    }
    const runRoot = join(artifactsRoot, runEntry.name);
    for (const sessionEntry of readdirSync(runRoot, { withFileTypes: true })) {
      if (
        !sessionEntry.isDirectory() ||
        sessionEntry.isSymbolicLink() ||
        !/^session-\d+$/.test(sessionEntry.name)
      ) {
        continue;
      }
      const runDir = join(runRoot, sessionEntry.name);
      const recoveryPath = join(runDir, 'funded-custody', 'recovery.json');
      const liabilityDir = join(runDir, 'funded-liability');
      const ledgerPath = join(liabilityDir, 'ledger.jsonl');
      const recoveryPresent = regularNodeExists(recoveryPath);
      const ledgerPresent = regularNodeExists(ledgerPath);
      if (!recoveryPresent && !ledgerPresent) continue;
      sessions.push({
        runDir,
        recoveryPath,
        liabilityDir,
        ledgerPath,
        recoveryPresent,
        ledgerPresent,
      });
    }
  }
  return sessions.sort((left, right) => left.runDir.localeCompare(right.runDir));
}

/** Find only current harness run/session custody. A root-level recovery.json or
 * any other legacy artifact is deliberately outside this scan. */
export function scanFundedRecoverySessions(artifactsRoot: string): FundedRecoverySession[] {
  return managedSessions(artifactsRoot)
    .filter(({ recoveryPresent }) => recoveryPresent)
    .map(({ recoveryPresent: _recovery, ledgerPresent: _ledger, ...session }) => session);
}

function assertPrivateRecoveryFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('invalid recovery custody');
  }
}

function assertLedgerFile(path: string): LedgerEntry[] {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid funded ledger');
  return parseLedgerText(readFileSync(path, 'utf8'));
}

function leaseFiles(liabilityDir: string): string[] {
  const dir = join(liabilityDir, 'effect-leases');
  if (!existsSync(dir)) return [];
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid effect lease');
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.lock')) {
        throw new Error('invalid effect lease');
      }
      return join(dir, entry.name);
    })
    .sort();
}

function privateTempFiles(runDir: string): string[] {
  const files: string[] = [];
  const visit = (path: string): void => {
    if (!existsSync(path)) return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('ambiguous private temp');
    if (stat.isFile()) {
      if (basename(path).endsWith('.tmp')) files.push(path);
      return;
    }
    if (!stat.isDirectory()) throw new Error('ambiguous private temp');
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('ambiguous private temp');
      visit(join(path, entry.name));
    }
  };
  visit(join(runDir, 'funded-custody'));
  visit(join(runDir, 'funded-runtime'));
  return files.sort();
}

function internalRecoveryLeases(runDir: string): string[] {
  const dir = join(runDir, 'funded-custody', 'locks');
  if (!existsSync(dir)) return [];
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('stale internal lease');
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) => {
      const validName =
        entry.name === 'create.lock' ||
        entry.name === 'effects.lock' ||
        /^[0-9a-f]{64}\.update\.lock$/.test(entry.name);
      if (!entry.isFile() || entry.isSymbolicLink() || !validName) {
        throw new Error('stale internal lease');
      }
      return join(dir, entry.name);
    })
    .sort();
}

function readPrivateJson<T>(path: string, schema: z.ZodType<T>, context: string): T {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`invalid ${context}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`invalid ${context}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new Error(`invalid ${context}`);
  return result.data;
}

function readRuntimeAccounting(session: ManagedSession): RuntimeAccounting {
  const path = join(session.runDir, 'funded-runtime', 'cocod-accounting.json');
  if (!regularNodeExists(path)) throw new Error('invalid runtime accounting');
  const accounting = readPrivateJson(path, accountingRecordSchema, 'runtime accounting');
  const ledgerEntries = session.ledgerPresent ? assertLedgerFile(session.ledgerPath) : [];
  if (ledgerEntries.length > 0 && accounting.runId !== ledgerEntries[0].runId) {
    throw new Error('invalid runtime accounting');
  }
  const states = new Map<string, (typeof accounting.assets)[number]>();
  for (const state of accounting.assets) {
    const id = assetKey(state.asset);
    if (states.has(id)) throw new Error('invalid runtime accounting');
    states.set(id, state);
  }
  for (const [index, observation] of accounting.observations.entries()) {
    if (
      observation.sequence !== index + 1 ||
      observation.delta !== observation.after - observation.before ||
      !states.has(assetKey(observation.asset))
    ) {
      throw new Error('invalid runtime accounting');
    }
  }
  for (const state of states.values()) {
    let current = state.baseline;
    for (const observation of accounting.observations.filter(
      ({ asset }) => assetKey(asset) === assetKey(state.asset)
    )) {
      if (observation.before !== current) throw new Error('invalid runtime accounting');
      current = observation.after;
    }
    if (state.current !== current) throw new Error('invalid runtime accounting');
  }
  return accounting;
}

const cashuTokenFingerprint = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

function readCashuOutflows(session: ManagedSession): CashuOutflowEvidence[] {
  const dir = join(session.runDir, 'funded-runtime', 'cashu-outflows');
  if (!existsSync(dir)) return [];
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('invalid runtime accounting');
  }
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[0-9a-f]{16}\.json$/.test(entry.name)) {
        throw new Error('invalid runtime accounting');
      }
      const record = readPrivateJson(
        join(dir, entry.name),
        cashuOutflowSchema,
        'runtime accounting'
      );
      if (record.id !== entry.name.slice(0, 16) || !record.tokenFingerprint.startsWith(record.id)) {
        throw new Error('invalid runtime accounting');
      }
      if (record.phase === 'prepared') {
        if (cashuTokenFingerprint(record.token) !== record.tokenFingerprint) {
          throw new Error('invalid runtime accounting');
        }
        return record;
      }
      const validReceived =
        record.phase === 'received' &&
        record.afterBalance - record.beforeBalance === record.counterpartyDelta &&
        record.counterpartyDelta === record.amount;
      const validSpentUncredited =
        record.phase === 'spent-uncredited' &&
        record.afterBalance === record.beforeBalance &&
        record.counterpartyDelta === 0;
      if (!validReceived && !validSpentUncredited) {
        throw new Error('invalid runtime accounting');
      }
      return record;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function cashuObservationKey(input: {
  asset: DeclaredRecoveryAsset;
  before: number;
  after: number;
  delta: number;
}): string {
  return `${assetKey(input.asset)}\u0000${input.before}\u0000${input.after}\u0000${input.delta}`;
}

function readSessionEvidence(
  session: ManagedSession,
  options: { allowIncompleteCashu?: boolean } = {}
): SessionEvidence {
  const accounting = readRuntimeAccounting(session);
  if (!session.ledgerPresent && accounting.observations.some(({ delta }) => delta !== 0)) {
    throw new Error('invalid runtime accounting');
  }
  const allCashuOutflows = readCashuOutflows(session);
  const prepared = allCashuOutflows.filter(
    (record): record is PreparedCashuOutflow => record.phase === 'prepared'
  );
  const cashuOutflows = allCashuOutflows.filter(
    (record): record is TerminalCashuOutflow => record.phase !== 'prepared'
  );
  if (!options.allowIncompleteCashu && prepared.length > 0) {
    throw new Error('uncertain Cashu outflow');
  }
  const effectLeases = session.ledgerPresent ? leaseFiles(session.liabilityDir) : [];
  const cashuObservations = accounting.observations.filter(
    ({ operation }) => operation === 'cashu.redeem'
  );
  const received = cashuOutflows.filter(
    (record): record is ReceivedCashuOutflow => record.phase === 'received'
  );
  if (options.allowIncompleteCashu) {
    const candidates = [...received, ...prepared];
    const consumed = new Set<number>();
    for (const observation of cashuObservations) {
      const match = candidates.findIndex((record, index) => {
        if (consumed.has(index) || assetKey(record.asset) !== assetKey(observation.asset)) {
          return false;
        }
        if (record.phase === 'received') {
          return (
            record.beforeBalance === observation.before &&
            record.afterBalance === observation.after &&
            record.counterpartyDelta === observation.delta
          );
        }
        return (
          record.beforeBalance === observation.before &&
          observation.delta === record.amount &&
          observation.after - observation.before === observation.delta
        );
      });
      if (match === -1) throw new Error('invalid runtime accounting');
      consumed.add(match);
    }
  } else {
    const observed = cashuObservations.map(cashuObservationKey).sort();
    const persisted = received
      .map((record) =>
        cashuObservationKey({
          asset: record.asset,
          before: record.beforeBalance,
          after: record.afterBalance,
          delta: record.counterpartyDelta,
        })
      )
      .sort();
    if (JSON.stringify(observed) !== JSON.stringify(persisted)) {
      throw new Error('invalid runtime accounting');
    }
  }
  for (const observation of accounting.observations) {
    if (
      observation.delta > 0 &&
      !['cashu.redeem', 'bolt11.settled', 'bolt11.settled.finally', 'recovery.sweep'].includes(
        observation.operation
      )
    ) {
      throw new Error('invalid runtime accounting');
    }
  }
  return { accounting, cashuOutflows, effectLeases };
}

function assertLedgerOutflowEvidence(
  intent: Extract<LedgerEntry, { kind: 'intent' }>,
  entries: LedgerEntry[],
  evidence: SessionEvidence
): void {
  const recorded = entries
    .filter(
      (entry): entry is Extract<LedgerEntry, { kind: 'outflow' }> =>
        entry.kind === 'outflow' && entry.legId === intent.legId
    )
    .map(({ amount }) => amount)
    .sort((left, right) => left - right);
  const cashu = evidence.cashuOutflows
    .filter(({ asset }) => assetKey(asset) === assetKey(intent.asset))
    .map(({ amount }) => amount);
  const lightning = evidence.accounting.observations
    .filter(
      ({ asset, operation }) =>
        assetKey(asset) === assetKey(intent.asset) &&
        (operation === 'bolt11.settled' || operation === 'bolt11.settled.finally')
    )
    .map(({ delta }) => {
      if (delta <= 0) throw new Error('invalid runtime accounting');
      return delta;
    });
  const observed = [...cashu, ...lightning].sort((left, right) => left - right);
  if (JSON.stringify(recorded) !== JSON.stringify(observed)) {
    throw new Error('runtime accounting does not exactly match durable outflows');
  }
}

function assertSafeAsset(asset: DeclaredRecoveryAsset): void {
  if (
    asset.accountIndex !== 0 ||
    !Number.isSafeInteger(asset.maxPrincipal) ||
    asset.maxPrincipal <= 0
  ) {
    throw new Error('invalid recovery asset');
  }
}

function inspectSession(
  session: ManagedSession,
  openRecovery: FundedRecoveryOpener,
  staleOwnerIsDead: boolean
): FundedRecoveryAuditSession {
  if (privateTempFiles(session.runDir).length > 0) {
    throw new Error('ambiguous private temp');
  }
  const internalLeases = internalRecoveryLeases(session.runDir);
  if (internalLeases.length > 0 && !staleOwnerIsDead) {
    throw new Error('stale internal lease');
  }
  let recovery: FundedRecoveryPort | undefined;
  if (session.recoveryPresent) {
    assertPrivateRecoveryFile(session.recoveryPath);
    recovery = openRecovery({ runDir: session.runDir });
    if (recovery.custodyPath !== session.recoveryPath || recovery.assets.length === 0) {
      throw new Error('invalid recovery custody');
    }
    const assets = new Set<string>();
    for (const asset of recovery.assets) {
      assertSafeAsset(asset);
      const id = assetKey(asset);
      if (assets.has(id)) throw new Error('duplicate recovery asset');
      assets.add(id);
    }
  }

  const entries = session.ledgerPresent ? assertLedgerFile(session.ledgerPath) : [];
  const runIds = new Set(entries.map(({ runId }) => runId));
  if (runIds.size > 1) throw new Error('invalid funded ledger');
  const intents = entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'intent' }> => entry.kind === 'intent'
  );
  const intentAssets = new Set<string>();
  for (const intent of intents) {
    const id = assetKey(intent.asset);
    if (intentAssets.has(id)) throw new Error('duplicate funded ledger asset');
    intentAssets.add(id);
    if (recovery) {
      const declared = recovery.assets.find((asset) => assetKey(asset) === id);
      if (!declared || declared.maxPrincipal !== intent.expectedAmount) {
        throw new Error('funded ledger does not match recovery custody');
      }
    }
  }

  const leases = leaseFiles(session.liabilityDir);
  const expectedLeases = new Set(
    intents.map((intent) => effectLeasePath(session.liabilityDir, intent.runId, intent.legId))
  );
  if (leases.some((path) => !expectedLeases.has(path))) throw new Error('invalid effect lease');
  readSessionEvidence(session, { allowIncompleteCashu: true });

  return {
    ...session,
    runId: entries[0]?.runId,
    legCount: intents.length,
    effectLeaseCount: leases.length,
    internalLeaseCount: internalLeases.length,
  };
}

export function auditFundedRecoverySessions(
  artifactsRoot: string,
  openRecovery: FundedRecoveryOpener = defaultOpenRecovery,
  options: { staleOwnerIsDead?: boolean } = {}
): FundedRecoveryAudit {
  const candidates = managedSessions(artifactsRoot);
  if (candidates.length === 0) return { status: 'clean', sessions: [], blockers: [] };

  const sessions: FundedRecoveryAuditSession[] = [];
  const blockers: FundedRecoveryAuditBlocker[] = [];
  for (const candidate of candidates) {
    try {
      const inspected = inspectSession(candidate, openRecovery, options.staleOwnerIsDead === true);
      if (!candidate.recoveryPresent && candidate.ledgerPresent) {
        const ledger = new RunLedger(candidate.liabilityDir, inspected.runId!);
        if ([...ledger.status().values()].some((status) => !isTerminal(status))) {
          sessions.push(inspected);
          blockers.push({
            runDir: candidate.runDir,
            reason: 'missing-recovery-for-open-liability',
          });
        } else {
          const referencedCustodyRemains = ledger
            .read()
            .filter(
              (entry): entry is Extract<LedgerEntry, { kind: 'intent' }> => entry.kind === 'intent'
            )
            .some(({ custody }) => hasCustody(candidate.liabilityDir, custody));
          if (
            referencedCustodyRemains ||
            inspected.effectLeaseCount > 0 ||
            inspected.internalLeaseCount > 0
          ) {
            sessions.push(inspected);
          }
        }
      } else {
        sessions.push(inspected);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const reason: FundedRecoveryAuditBlocker['reason'] = message.includes('effect lease')
        ? 'invalid-effect-lease'
        : message.includes('internal lease')
          ? 'stale-internal-lease'
          : message.includes('private temp')
            ? 'ambiguous-private-temp'
            : message.includes('runtime accounting') || message.includes('Cashu outflow')
              ? 'invalid-runtime-accounting'
              : message.includes('ledger')
                ? 'invalid-funded-ledger'
                : 'invalid-recovery-custody';
      blockers.push({ runDir: candidate.runDir, reason });
    }
  }
  if (blockers.length > 0) return { status: 'blocked', sessions, blockers };
  if (sessions.length === 0) return { status: 'clean', sessions: [], blockers: [] };
  return { status: 'recovery-required', sessions, blockers: [] };
}

function isTerminal(
  status: ReturnType<RunLedger['status']> extends Map<string, infer T> ? T : never
) {
  return status === 'reconciled' || status === 'cancelled';
}

function assertNonNegativeAmount(value: number, context: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid ${context}`);
  }
}

function validateRecoveryReport(
  declaredAssets: readonly DeclaredRecoveryAsset[],
  report: FundedRecoveryReport
): Map<string, AssetReport> {
  const declared = new Map<string, DeclaredRecoveryAsset>();
  for (const asset of declaredAssets) {
    assertSafeAsset(asset);
    const id = assetKey(asset);
    if (declared.has(id)) throw new Error('duplicate recovery asset');
    declared.set(id, asset);
  }

  const result = new Map<string, AssetReport>();
  for (const restored of report.assets) {
    const id = assetKey(restored.asset);
    const asset = declared.get(id);
    if (!asset || restored.asset.maxPrincipal !== asset.maxPrincipal || result.has(id)) {
      throw new Error('recovery report contains an invalid asset');
    }
    for (const [context, value] of [
      ['restored amount', restored.restoredAmount],
      ['token amount', restored.tokenAmount],
      ['counterparty delta', restored.counterpartyDelta],
      ['send fee', restored.sendFee],
      ['receive fee', restored.receiveFee],
      ['residual amount', restored.residualAmount],
    ] as const) {
      assertNonNegativeAmount(value, context);
    }
    if (
      restored.residualAmount !== 0 ||
      restored.tokenAmount !== restored.counterpartyDelta + restored.receiveFee ||
      restored.restoredAmount !== restored.tokenAmount + restored.sendFee
    ) {
      throw new Error('recovery report violates exact asset conservation');
    }
    result.set(id, { asset, restored, tokens: [] });
  }
  if (result.size !== declared.size) throw new Error('recovery report omitted a declared asset');

  for (const token of report.counterpartyTokens) {
    const item = result.get(assetKey(token.asset));
    if (!item || token.asset.maxPrincipal !== item.asset.maxPrincipal) {
      throw new Error('recovery report contains an invalid counterparty token asset');
    }
    assertNonNegativeAmount(token.tokenAmount, 'counterparty token amount');
    assertNonNegativeAmount(token.counterpartyDelta, 'counterparty token delta');
    assertNonNegativeAmount(token.fee, 'counterparty token fee');
    const validDisposition =
      token.disposition === 'returned'
        ? token.counterpartyDelta <= token.tokenAmount &&
          token.fee >= token.tokenAmount - token.counterpartyDelta
        : token.disposition === 'spent-by-app'
          ? token.counterpartyDelta === 0
          : false;
    if (token.tokenAmount <= 0 || !validDisposition) {
      throw new Error('counterparty token report violates exact conservation');
    }
    item.tokens.push(token);
  }

  for (const item of result.values()) {
    const returnedPrincipal = item.tokens
      .filter(({ disposition }) => disposition === 'returned')
      .reduce((sum, token) => sum + token.tokenAmount, 0);
    if (item.restored.restoredAmount + returnedPrincipal > item.asset.maxPrincipal) {
      throw new Error('recovery report exceeds declared principal');
    }
  }
  return result;
}

function acceptedEmptyAssets(
  session: ManagedSession,
  reportByAsset: ReadonlyMap<string, AssetReport>,
  evidence: SessionEvidence
): { accepted: DeclaredRecoveryAsset[]; unsafe: DeclaredRecoveryAsset[] } {
  const entries = session.ledgerPresent ? assertLedgerFile(session.ledgerPath) : [];
  const intents = entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'intent' }> => entry.kind === 'intent'
  );
  const accepted: DeclaredRecoveryAsset[] = [];
  const unsafe: DeclaredRecoveryAsset[] = [];
  for (const item of reportByAsset.values()) {
    if (item.restored.restoredAmount !== 0) continue;
    // FundedRecovery terminalizes an empty asset itself when it returned a
    // persisted counterparty token. That token is independent proof of the
    // principal's disposition, so no caller exception is needed.
    if (item.tokens.some(({ disposition }) => disposition === 'returned')) continue;

    const intent = intents.find(({ asset }) => assetKey(asset) === assetKey(item.asset));
    const observedFundingEffect = evidence.accounting.observations.some(
      ({ asset, delta }) => assetKey(asset) === assetKey(item.asset) && delta < 0
    );
    if (!intent) {
      if (observedFundingEffect) unsafe.push(item.asset);
      else accepted.push(item.asset);
      continue;
    }
    const legEntries = entries.filter(({ legId }) => legId === intent.legId);
    const funded = legEntries.some(({ kind }) => kind === 'funded');
    const quarantined = legEntries.some(({ kind }) => kind === 'quarantined');
    const observedOutflow = legEntries
      .filter(
        (entry): entry is Extract<LedgerEntry, { kind: 'outflow' }> => entry.kind === 'outflow'
      )
      .reduce((sum, entry) => sum + entry.amount + entry.fees, 0);
    // Operator-declared loss acceptance (RunLedger.writeOff) explains emptiness
    // the same way an observed outflow does — but only when it exactly closes
    // the leg's principal together with real outflows.
    const writtenOff = legEntries
      .filter(
        (entry): entry is Extract<LedgerEntry, { kind: 'written-off' }> =>
          entry.kind === 'written-off'
      )
      .reduce((sum, entry) => sum + entry.amount, 0);
    const explained = observedOutflow + writtenOff;
    const retainedEffectLease = evidence.effectLeases.includes(
      effectLeasePath(session.liabilityDir, intent.runId, intent.legId)
    );
    if (
      (!funded && explained === 0 && !retainedEffectLease && !observedFundingEffect) ||
      explained === intent.expectedAmount
    ) {
      if (quarantined && explained !== intent.expectedAmount) unsafe.push(item.asset);
      else accepted.push(item.asset);
    } else {
      unsafe.push(item.asset);
    }
  }
  return { accepted, unsafe };
}

function accountingForLeg(
  intent: Extract<LedgerEntry, { kind: 'intent' }>,
  entries: LedgerEntry[],
  report: AssetReport
): LegAccounting {
  const outflows = entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'outflow' }> =>
      entry.kind === 'outflow' && entry.legId === intent.legId
  );
  const outflowAmount = outflows.reduce((sum, entry) => sum + entry.amount, 0);
  const outflowFees = outflows.reduce((sum, entry) => sum + entry.fees, 0);
  const writtenOffAmount = entries
    .filter(
      (entry): entry is Extract<LedgerEntry, { kind: 'written-off' }> =>
        entry.kind === 'written-off' && entry.legId === intent.legId
    )
    .reduce((sum, entry) => sum + entry.amount, 0);
  const returnedTokens = report.tokens.filter(({ disposition }) => disposition === 'returned');
  const returnedPrincipal = returnedTokens.reduce((sum, entry) => sum + entry.tokenAmount, 0);
  const returnedDelta = returnedTokens.reduce((sum, entry) => sum + entry.counterpartyDelta, 0);
  const recoveredAmount = report.restored.counterpartyDelta + returnedDelta;
  const knownPrincipal =
    report.restored.restoredAmount +
    returnedPrincipal +
    outflowAmount +
    outflowFees +
    writtenOffAmount;
  if (knownPrincipal !== intent.expectedAmount) {
    throw new Error('startup recovery has unexplained funded liability principal');
  }
  const sweepFees =
    report.restored.sendFee +
    report.restored.receiveFee +
    returnedTokens.reduce((sum, entry) => sum + (entry.tokenAmount - entry.counterpartyDelta), 0);
  if (!Number.isSafeInteger(sweepFees) || sweepFees < 0) {
    throw new Error('startup recovery cannot conserve funded liability');
  }
  return { recoveredAmount, sweepFees };
}

function validateExistingSweep(
  intent: Extract<LedgerEntry, { kind: 'intent' }>,
  entries: LedgerEntry[],
  expected: LegAccounting
): void {
  const sweeps = entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'sweep' }> =>
      entry.kind === 'sweep' && entry.legId === intent.legId
  );
  if (!sweeps.some(({ ok, residualAmount }) => ok && residualAmount === 0)) {
    throw new Error('funded liability has no successful terminal sweep');
  }
  const recoveredAmount = sweeps.reduce((sum, entry) => sum + entry.recoveredAmount, 0);
  const fees = sweeps.reduce((sum, entry) => sum + entry.fees, 0);
  if (recoveredAmount !== expected.recoveredAmount || fees !== expected.sweepFees) {
    throw new Error('durable sweep does not match startup recovery report');
  }
}

function reconcileLedger(
  session: ManagedSession,
  recoveryAssets: readonly DeclaredRecoveryAsset[],
  report: FundedRecoveryReport,
  evidence: SessionEvidence
): { cancelledLegs: number; reconciledLegs: number } {
  const entries = assertLedgerFile(session.ledgerPath);
  const runId = entries[0]!.runId;
  const ledger = new RunLedger(session.liabilityDir, runId);
  const reportByAsset = validateRecoveryReport(recoveryAssets, report);
  const intents = entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'intent' }> => entry.kind === 'intent'
  );
  let cancelledLegs = 0;
  let reconciledLegs = 0;

  for (const intent of intents) {
    assertLedgerOutflowEvidence(intent, entries, evidence);
    const assetReport = reportByAsset.get(assetKey(intent.asset));
    const declared = recoveryAssets.find((asset) => assetKey(asset) === assetKey(intent.asset));
    if (!assetReport || !declared || declared.maxPrincipal !== intent.expectedAmount) {
      throw new Error('funded liability does not match recovery report');
    }
    const currentEntries = ledger.read();
    const legEntries = currentEntries.filter((entry) => entry.legId === intent.legId);
    const currentStatus = ledger.status().get(intent.legId);
    const hasFunded = legEntries.some(({ kind }) => kind === 'funded');
    const valueProven = assetReport.restored.restoredAmount > 0 || assetReport.tokens.length > 0;

    if (currentStatus === 'cancelled') {
      if (valueProven) throw new Error('cancelled liability has recovered value');
      continue;
    }

    if (!hasFunded) {
      if (!valueProven) {
        ledger.cancelFunding(intent.legId);
        cancelledLegs++;
        continue;
      }
      ledger.markFunded(intent.legId, { amount: intent.expectedAmount, fees: 0 });
    }

    const accounting = accountingForLeg(intent, currentEntries, assetReport);
    if (currentStatus === 'reconciled') {
      validateExistingSweep(intent, currentEntries, accounting);
      continue;
    }

    const afterFunded = ledger.read();
    const successfulSweep = afterFunded.some(
      (entry) =>
        entry.legId === intent.legId &&
        entry.kind === 'sweep' &&
        entry.ok &&
        entry.residualAmount === 0
    );
    if (successfulSweep) {
      validateExistingSweep(intent, afterFunded, accounting);
    } else {
      ledger.recordSweep(intent.legId, {
        asset: intent.asset,
        ok: true,
        recoveredAmount: accounting.recoveredAmount,
        residualAmount: 0,
        fees: accounting.sweepFees,
      });
    }
    ledger.reconcile(intent.legId);
    reconciledLegs++;
  }

  if ([...ledger.status().values()].some((status) => !isTerminal(status))) {
    throw new Error('startup recovery left a non-terminal funded liability');
  }
  return { cancelledLegs, reconciledLegs };
}

function validateTerminalLedgerOnly(
  session: ManagedSession,
  evidence: SessionEvidence
): {
  cancelledLegs: number;
  reconciledLegs: number;
} {
  const entries = assertLedgerFile(session.ledgerPath);
  const ledger = new RunLedger(session.liabilityDir, entries[0]!.runId);
  for (const intent of entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'intent' }> => entry.kind === 'intent'
  )) {
    assertLedgerOutflowEvidence(intent, entries, evidence);
  }
  const statuses = [...ledger.status().values()];
  if (statuses.some((status) => !isTerminal(status))) {
    throw new Error('stale funded recovery is missing for an open liability');
  }
  return {
    cancelledLegs: statuses.filter((status) => status === 'cancelled').length,
    reconciledLegs: statuses.filter((status) => status === 'reconciled').length,
  };
}

function syncDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    fsyncSync(fd);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
    if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(code ?? '')) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function clearInternalRecoveryLeases(session: ManagedSession, staleOwnerIsDead: boolean): void {
  const leases = internalRecoveryLeases(session.runDir);
  if (leases.length === 0) return;
  if (!staleOwnerIsDead) throw new Error('stale recovery owner has not been proven dead');
  for (const path of leases) unlinkSync(path);
  syncDirectory(dirname(leases[0]!));
}

async function assertPendingInvoicesAreTerminal(
  evidence: SessionEvidence,
  cocod: CocodCounterparty,
  now: () => number
): Promise<void> {
  for (const pending of evidence.accounting.pendingInvoices) {
    const snapshot = await cocod.balanceSnapshot();
    const current = cocod.exactBalance(snapshot, pending.asset);
    const delta = current - pending.beforeBalance;
    if (delta === 0 && now() >= pending.settlementDeadlineMs) continue;
    if (delta === 0) {
      throw new Error('stale funded recovery retained an invoice inside its settlement window');
    }
    throw new Error('stale funded recovery has an uncertain invoice settlement');
  }
}

function clearEffectLeases(session: ManagedSession): number {
  const entries = assertLedgerFile(session.ledgerPath);
  const intents = entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'intent' }> => entry.kind === 'intent'
  );
  const expected = new Set(
    intents.map((intent) => effectLeasePath(session.liabilityDir, intent.runId, intent.legId))
  );
  const leases = leaseFiles(session.liabilityDir);
  if (leases.some((path) => !expected.has(path))) throw new Error('invalid effect lease');
  for (const path of leases) unlinkSync(path);
  if (leases.length > 0) syncDirectory(dirname(leases[0]!));
  return leases.length;
}

function deleteLedgerCustody(session: ManagedSession): void {
  const entries = assertLedgerFile(session.ledgerPath);
  const handles = new Map<string, CustodyHandle>();
  for (const entry of entries) {
    if (entry.kind === 'intent') handles.set(entry.custody.id, entry.custody);
  }
  for (const handle of handles.values()) {
    if (hasCustody(session.liabilityDir, handle)) {
      deleteRecovery(session.liabilityDir, handle);
    }
  }
}

function persistCashuOutflow(session: ManagedSession, record: TerminalCashuOutflow): void {
  durableReplaceFile(
    join(session.runDir, 'funded-runtime', 'cashu-outflows', `${record.id}.json`),
    JSON.stringify(record),
    0o600
  );
}

function terminalCashuState(
  inspected: InspectedCashuToken,
  expectedAmount: number
): 'UNSPENT' | 'SPENT' {
  const amounts = [
    inspected.totalAmount,
    inspected.unspentAmount,
    inspected.pendingAmount,
    inspected.spentAmount,
  ];
  if (
    amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0) ||
    inspected.totalAmount !== expectedAmount ||
    inspected.unspentAmount + inspected.pendingAmount + inspected.spentAmount !== expectedAmount
  ) {
    throw new Error('prepared Cashu outflow inspection was inconsistent; private custody retained');
  }
  if (inspected.pendingAmount > 0) {
    throw new Error('prepared Cashu outflow is PENDING; private custody retained');
  }
  if (inspected.unspentAmount === expectedAmount && inspected.spentAmount === 0) {
    return 'UNSPENT';
  }
  if (inspected.spentAmount === expectedAmount && inspected.unspentAmount === 0) {
    return 'SPENT';
  }
  throw new Error('prepared Cashu outflow has mixed proof states; private custody retained');
}

function exactCashuObservation(
  observation: RuntimeAccounting['observations'][number],
  outflow: ReceivedCashuOutflow
): boolean {
  return (
    observation.operation === 'cashu.redeem' &&
    assetKey(observation.asset) === assetKey(outflow.asset) &&
    observation.before === outflow.beforeBalance &&
    observation.after === outflow.afterBalance &&
    observation.delta === outflow.counterpartyDelta
  );
}

async function repairCashuAccounting(
  session: ManagedSession,
  cocod: CocodCounterparty,
  outflow: ReceivedCashuOutflow
): Promise<void> {
  const accounting = readRuntimeAccounting(session);
  const matches = accounting.observations.filter((observation) =>
    exactCashuObservation(observation, outflow)
  );
  if (matches.length > 1) throw new Error('invalid runtime accounting');
  if (matches.length === 1) return;

  const state = accounting.assets.find(({ asset }) => assetKey(asset) === assetKey(outflow.asset));
  if (!state || state.current !== outflow.beforeBalance) {
    throw new Error(
      'Cashu outflow accounting repair found balance drift; private custody retained'
    );
  }
  const snapshot = await cocod.balanceSnapshot();
  const current = cocod.exactBalance(snapshot, outflow.asset);
  if (current !== outflow.afterBalance) {
    throw new Error(
      'Cashu outflow accounting repair found balance drift; private custody retained'
    );
  }
  accounting.observations.push({
    sequence: accounting.observations.length + 1,
    operation: 'cashu.redeem',
    asset: outflow.asset,
    before: outflow.beforeBalance,
    after: outflow.afterBalance,
    delta: outflow.counterpartyDelta,
  });
  state.current = outflow.afterBalance;
  durableReplaceFile(
    join(session.runDir, 'funded-runtime', 'cocod-accounting.json'),
    JSON.stringify(accounting),
    0o600
  );
}

function repairCashuLedger(session: ManagedSession, outflow: TerminalCashuOutflow): void {
  if (!session.ledgerPresent) {
    throw new Error('Cashu outflow has no durable funded ledger; private custody retained');
  }
  const entries = assertLedgerFile(session.ledgerPath);
  const intents = entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'intent' }> =>
      entry.kind === 'intent' && assetKey(entry.asset) === assetKey(outflow.asset)
  );
  if (intents.length !== 1) {
    throw new Error(
      'Cashu outflow does not identify one funded liability; private custody retained'
    );
  }
  const matchingTransaction = entries.filter(
    (entry) => 'txId' in entry && entry.txId === outflow.id
  );
  const counterparty =
    outflow.phase === 'spent-uncredited' ? 'accepted-crash-loss' : 'cocod-test-wallet';
  if (matchingTransaction.length > 1) throw new Error('invalid funded ledger');
  if (matchingTransaction.length === 1) {
    const [existing] = matchingTransaction;
    if (
      existing?.kind !== 'outflow' ||
      existing.legId !== intents[0]!.legId ||
      existing.amount !== outflow.amount ||
      existing.fees !== 0 ||
      existing.counterparty !== counterparty
    ) {
      throw new Error('invalid funded ledger');
    }
    return;
  }
  const ledger = new RunLedger(session.liabilityDir, intents[0]!.runId);
  ledger.recordOutflow(intents[0]!.legId, {
    amount: outflow.amount,
    fees: 0,
    counterparty,
    txId: outflow.id,
  });
}

async function repairTerminalCashuEvidence(
  session: ManagedSession,
  cocod: CocodCounterparty,
  outflow: TerminalCashuOutflow
): Promise<void> {
  if (outflow.phase === 'received') {
    await repairCashuAccounting(session, cocod, outflow);
  }
  repairCashuLedger(session, outflow);
}

async function resumePreparedCashuOutflow(options: {
  session: ManagedSession;
  cocod: CocodCounterparty;
  recovery: FundedRecoveryPort;
  outflow: PreparedCashuOutflow;
  acceptedTestFundLoss: boolean;
}): Promise<void> {
  const { session, cocod, recovery, outflow } = options;
  if (cashuTokenFingerprint(outflow.token) !== outflow.tokenFingerprint) {
    throw new Error('invalid runtime accounting');
  }
  let inspected: InspectedCashuToken;
  try {
    inspected = await recovery.inspectCashuToken({ asset: outflow.asset, token: outflow.token });
  } catch {
    throw new Error('prepared Cashu outflow inspection failed; private custody retained');
  }
  const state = terminalCashuState(inspected, outflow.amount);
  const beforeSnapshot = await cocod.balanceSnapshot();
  const current = cocod.exactBalance(beforeSnapshot, outflow.asset);
  let afterBalance = current;

  if (state === 'UNSPENT') {
    if (current !== outflow.beforeBalance) {
      throw new Error('prepared Cashu outflow found cocod balance drift; private custody retained');
    }
    let reportedAmount: number;
    try {
      ({ reportedAmount } = await cocod.receiveCashu(outflow.token));
    } catch {
      throw new Error('prepared Cashu outflow retry failed; private custody retained');
    }
    if (reportedAmount !== outflow.amount) {
      throw new Error('prepared Cashu outflow retry returned a different amount; custody retained');
    }
    const afterSnapshot = await cocod.balanceSnapshot();
    afterBalance = cocod.exactBalance(afterSnapshot, outflow.asset);
  }

  const delta = afterBalance - outflow.beforeBalance;
  if (delta !== 0 && delta !== outflow.amount) {
    throw new Error('prepared Cashu outflow found cocod balance drift; private custody retained');
  }
  if (delta === 0) {
    if (state !== 'SPENT') {
      throw new Error('prepared Cashu outflow retry was not credited; private custody retained');
    }
    if (!options.acceptedTestFundLoss) {
      throw new Error(
        'SPENT Cashu outflow has zero cocod credit; explicit fund-loss acceptance is required'
      );
    }
    const { token: _token, phase: _phase, ...base } = outflow;
    const terminal: SpentUncreditedCashuOutflow = {
      ...base,
      phase: 'spent-uncredited',
      afterBalance,
      counterpartyDelta: 0,
      acceptedTestFundLoss: true,
    };
    persistCashuOutflow(session, terminal);
    await repairTerminalCashuEvidence(session, cocod, terminal);
    return;
  }

  const { token: _token, phase: _phase, ...base } = outflow;
  const terminal: ReceivedCashuOutflow = {
    ...base,
    phase: 'received',
    afterBalance,
    counterpartyDelta: delta,
  };
  persistCashuOutflow(session, terminal);
  await repairTerminalCashuEvidence(session, cocod, terminal);
}

async function resumeCashuOutflows(options: {
  session: ManagedSession;
  cocod: CocodCounterparty;
  recovery: FundedRecoveryPort;
  acceptedTestFundLoss: boolean;
}): Promise<void> {
  for (const outflow of readCashuOutflows(options.session)) {
    if (outflow.phase === 'prepared') {
      await resumePreparedCashuOutflow({ ...options, outflow });
    } else {
      await repairTerminalCashuEvidence(options.session, options.cocod, outflow);
    }
  }
}

async function recoverSession(
  session: ManagedSession,
  cocod: CocodCounterparty,
  openRecovery: FundedRecoveryOpener,
  options: { staleOwnerIsDead: boolean; acceptedTestFundLoss: boolean; now: () => number }
): Promise<RecoveredFundedSession> {
  let counts = { cancelledLegs: 0, reconciledLegs: 0 };
  let recovery: FundedRecoveryPort | undefined;
  if (session.recoveryPresent) {
    recovery = openRecovery({ runDir: session.runDir });
    await resumeCashuOutflows({
      session,
      cocod,
      recovery,
      acceptedTestFundLoss: options.acceptedTestFundLoss,
    });
  }
  const evidence = readSessionEvidence(session);
  await assertPendingInvoicesAreTerminal(evidence, cocod, options.now);
  clearInternalRecoveryLeases(session, options.staleOwnerIsDead);
  if (recovery) {
    let report: FundedRecoveryReport;
    try {
      report = await recovery.reconcile({ cocod });
    } catch {
      throw new Error(
        `stale funded recovery failed for ${basename(dirname(session.runDir))}/${basename(session.runDir)}; private custody was retained`
      );
    }
    let validated = validateRecoveryReport(recovery.assets, report);
    if (validated.size !== recovery.assets.length) {
      throw new Error('stale funded recovery returned an incomplete report');
    }
    const empty = acceptedEmptyAssets(session, validated, evidence);
    if (empty.unsafe.length > 0) {
      throw new Error(
        'stale funded recovery found an unexplained empty funded asset; private custody was retained'
      );
    }
    if (empty.accepted.length > 0) {
      try {
        report = await recovery.reconcile({
          cocod,
          acceptEmptyAssets: empty.accepted,
        });
      } catch {
        throw new Error(
          `stale funded recovery failed for ${basename(dirname(session.runDir))}/${basename(session.runDir)}; private custody was retained`
        );
      }
      validated = validateRecoveryReport(recovery.assets, report);
      if (validated.size !== recovery.assets.length) {
        throw new Error('stale funded recovery returned an incomplete report');
      }
    }
    if (session.ledgerPresent) {
      counts = reconcileLedger(session, recovery.assets, report, evidence);
    }
  } else if (session.ledgerPresent) {
    counts = validateTerminalLedgerOnly(session, evidence);
  }

  const clearedEffectLeases = session.ledgerPresent ? clearEffectLeases(session) : 0;
  if (session.ledgerPresent) deleteLedgerCustody(session);
  recovery?.disposePrivateMaterial();
  if (session.recoveryPresent && regularNodeExists(session.recoveryPath)) {
    throw new Error('stale funded recovery custody remained after terminal disposal');
  }
  return { runDir: session.runDir, ...counts, clearedEffectLeases };
}

export async function recoverStaleFundedSessions(options: {
  artifactsRoot: string;
  cocod: CocodCounterparty;
  openRecovery?: FundedRecoveryOpener;
  staleOwnerIsDead?: boolean;
  acceptedTestFundLoss?: boolean;
  now?: () => number;
}): Promise<FundedStartupRecoveryResult> {
  const openRecovery = options.openRecovery ?? defaultOpenRecovery;
  const staleOwnerIsDead = options.staleOwnerIsDead === true;
  const initialAudit = auditFundedRecoverySessions(options.artifactsRoot, openRecovery, {
    staleOwnerIsDead,
  });
  if (initialAudit.status === 'clean') {
    return { status: 'clean', recovered: [], audit: initialAudit };
  }
  if (initialAudit.status === 'blocked') {
    throw new Error('stale funded startup state failed validation; private custody was retained');
  }
  if (initialAudit.sessions.some(({ recoveryPresent }) => recoveryPresent)) {
    if ((await options.cocod.status()) !== 'UNLOCKED') {
      throw new Error('cocod must be UNLOCKED before stale funded recovery');
    }
  }

  const required = new Set(initialAudit.sessions.map(({ runDir }) => runDir));
  const candidates = managedSessions(options.artifactsRoot).filter(({ runDir }) =>
    required.has(runDir)
  );
  const recovered: RecoveredFundedSession[] = [];
  for (const session of candidates) {
    recovered.push(
      await recoverSession(session, options.cocod, openRecovery, {
        staleOwnerIsDead,
        acceptedTestFundLoss: options.acceptedTestFundLoss === true,
        now: options.now ?? (() => Date.now()),
      })
    );
  }
  const finalAudit = auditFundedRecoverySessions(options.artifactsRoot, openRecovery, {
    staleOwnerIsDead,
  });
  if (finalAudit.status !== 'clean') {
    throw new Error('stale funded startup recovery did not reach a clean terminal state');
  }
  return { status: 'clean', recovered, audit: finalAudit };
}
