import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { err, ok, Result, ResultAsync, type Result as ResultType } from 'neverthrow';

import { loadE2E } from '../core/loader';
import { captureSourceFingerprint } from '../core/git';
import { effectiveRequirements } from '../core/plan';
import { selectSuiteScenarios } from '../core/selection';
import { scenarioPlatforms, type Platform } from '../schema/capabilities';
import type { FundedAsset } from '../schema/scenario';
import { parseLedgerText, type LedgerEntry } from '../ledger/ledger';
import { buildCatalog } from '../viewer/lib/catalog';
import { isOwnedAndroidAvdMetadata } from '../drivers/android/android-session';
import { COCOD_ALLOWED_VERSIONS } from '../counterparties/cocod';
import { ARTIFACTS, E2E_ROOT, safeArtifactPath } from '../viewer/lib/paths';
import { listRuns } from '../viewer/lib/scan';
import type { RunDetail, ScenarioCatalogEntry } from '../viewer/lib/types';

export interface ExpectedMatrixPair {
  scenarioId: string;
  platform: Platform;
  driver: 'sim' | 'android';
  lane: string;
  endState: string;
  fundedAssets: FundedAsset[];
}

interface FreshMatrixEvidenceInput {
  cutoff: string;
  sourceFingerprint: string;
  scenarioCount: number;
  expectedPairs: ExpectedMatrixPair[];
  catalog: ScenarioCatalogEntry[];
  runs: RunDetail[];
  artifactsRoot: string;
}

type WorkspaceFreshMatrixSource = Omit<FreshMatrixEvidenceInput, 'cutoff'>;

interface WorkspaceFreshMatrixSourceError {
  type: 'workspace-source';
  message: string;
}

type WorkspaceFreshMatrixAuditError = WorkspaceFreshMatrixSourceError | FreshMatrixAuditError;

interface MatrixCoverage {
  scenarioId: string;
  platform: Platform;
  runId: string;
}

interface MissingMatrixPair extends ExpectedMatrixPair {
  reasons: string[];
}

interface FreshMatrixAuditReport {
  cutoff: string;
  sourceFingerprint: string;
  scenarios: number;
  expected: number;
  covered: number;
  missing: MissingMatrixPair[];
  coverage: MatrixCoverage[];
  runs: { runId: string; pairs: number }[];
  platforms: Record<Platform, { expected: number; covered: number }>;
  complete: boolean;
}

interface FreshMatrixAuditError {
  type: 'invalid-cutoff' | 'invalid-matrix';
  message: string;
}

interface ArtifactReadError {
  type: 'artifact-read';
  runId: string;
  message: string;
}

interface RunArtifacts {
  runDir: string;
  manifest: Record<string, unknown>;
  events: Record<string, unknown>[];
  sessions: RunSessionArtifact[];
  ledgers: RunLedgerArtifact[];
}

interface RunSessionArtifact {
  fileName: string;
  index: number;
  data: Record<string, unknown>;
  ledger?: {
    path: string;
    entries: LedgerEntry[];
  };
}

interface RunLedgerArtifact {
  directoryName: string;
  index: number;
  path: string;
  entries: LedgerEntry[];
}

interface CandidateRejection {
  type: 'candidate-rejected';
  reasons: string[];
}

const pairKey = (pair: Pick<ExpectedMatrixPair, 'scenarioId' | 'platform'>): string =>
  `${pair.scenarioId}|${pair.platform}`;

function strictIsoTimestampMs(value: string): number | undefined {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value
    );
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1]! ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isJsonObject(parsed)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function nonblankJsonlLines(text: string, label: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const blankIndex = lines.findIndex((line) => line.trim().length === 0);
  if (blankIndex >= 0) throw new Error(`${label} line ${blankIndex + 1} is blank`);
  return lines;
}

const readRunArtifacts = (
  artifactsRoot: string,
  runId: string
): ResultType<RunArtifacts, ArtifactReadError> =>
  Result.fromThrowable(
    () => {
      const runDir = join(artifactsRoot, `run-${runId}`);
      const manifest = parseJsonObject(
        readFileSync(join(runDir, 'manifest.json'), 'utf8'),
        'manifest.json'
      );
      const eventsText = readFileSync(join(runDir, 'events.jsonl'), 'utf8');
      const eventLines = nonblankJsonlLines(eventsText, 'events.jsonl');
      const events = eventLines.map((line, index) =>
        parseJsonObject(line, `events.jsonl line ${index + 1}`)
      );
      const ledgers = readdirSync(runDir)
        .filter((directoryName) => /^session-\d+$/.test(directoryName))
        .flatMap((directoryName): RunLedgerArtifact[] => {
          const ledgerPath = join(runDir, directoryName, 'funded-liability', 'ledger.jsonl');
          if (!existsSync(ledgerPath)) return [];
          const ledgerText = readFileSync(ledgerPath, 'utf8');
          nonblankJsonlLines(ledgerText, `${directoryName} ledger`);
          return [
            {
              directoryName,
              index: Number(/^session-(\d+)$/.exec(directoryName)![1]),
              path: ledgerPath,
              entries: parseLedgerText(ledgerText),
            },
          ];
        });
      const sessions = readdirSync(runDir)
        .filter((name) => /^session-\d+\.json$/.test(name))
        .map((fileName) => ({
          fileName,
          index: Number(/^session-(\d+)\.json$/.exec(fileName)![1]),
        }))
        .sort((a, b) => a.index - b.index)
        .map(({ fileName, index }) => {
          const ledger = ledgers.find(
            (candidate) =>
              candidate.index === index && candidate.directoryName === `session-${index}`
          );
          return {
            fileName,
            index,
            data: parseJsonObject(readFileSync(join(runDir, fileName), 'utf8'), fileName),
            ...(ledger ? { ledger: { path: ledger.path, entries: ledger.entries } } : {}),
          };
        });
      return { runDir, manifest, events, sessions, ledgers };
    },
    (cause): ArtifactReadError => ({
      type: 'artifact-read',
      runId,
      message: cause instanceof Error ? cause.message : String(cause),
    })
  )();

function sessionsProvingPair(
  sessions: RunArtifacts['sessions'],
  runId: string,
  pair: ExpectedMatrixPair
): RunSessionArtifact[] {
  return sessions.filter(({ data: session, index }) => {
    const sessionRunId = `${runId}-${String(index).padStart(2, '0')}`;
    if (session.version !== 1 || session.runId !== sessionRunId) return false;
    if (session.ephemeral !== true) return false;
    if (!Array.isArray(session.scenarios) || !session.scenarios.includes(pair.scenarioId)) {
      return false;
    }
    if (pair.platform === 'ios') {
      const simulator = session.simulator;
      return (
        isJsonObject(simulator) &&
        session.android === undefined &&
        typeof simulator.name === 'string' &&
        simulator.name.startsWith(`Sovran E2E ${sessionRunId}-`)
      );
    }
    const android = session.android;
    return (
      isJsonObject(android) &&
      session.simulator === undefined &&
      typeof android.serial === 'string' &&
      /^emulator-\d+$/.test(android.serial) &&
      typeof android.avd === 'string' &&
      typeof android.avdRoot === 'string' &&
      isOwnedAndroidAvdMetadata({
        runId: sessionRunId,
        avd: android.avd,
        avdRoot: android.avdRoot,
      })
    );
  });
}

function isTerminalFundedSession(session: RunSessionArtifact, topRunId: unknown): boolean {
  if (typeof topRunId !== 'string') return false;
  const expectedRunId = `${topRunId}-${String(session.index).padStart(2, '0')}`;
  const entries = session.ledger?.entries;
  if (
    session.data.version !== 1 ||
    session.data.runId !== expectedRunId ||
    session.data.ephemeral !== true ||
    session.data.seedExport !== true ||
    !Array.isArray(session.data.scenarios) ||
    session.data.scenarios.length === 0 ||
    !session.data.scenarios.every((scenario) => typeof scenario === 'string') ||
    !entries ||
    entries.some((entry) => entry.runId !== expectedRunId)
  ) {
    return false;
  }
  const intentLegs = new Set(
    entries.filter((entry) => entry.kind === 'intent').map((entry) => entry.legId)
  );
  const fundedLegs = new Set(
    entries.filter((entry) => entry.kind === 'funded').map((entry) => entry.legId)
  );
  const reconciledLegs = new Set(
    entries.filter((entry) => entry.kind === 'reconciled').map((entry) => entry.legId)
  );
  return (
    intentLegs.size > 0 &&
    fundedLegs.size === intentLegs.size &&
    reconciledLegs.size === intentLegs.size &&
    [...intentLegs].every((legId) => fundedLegs.has(legId) && reconciledLegs.has(legId))
  );
}

function fundingEvidenceReasons(
  artifacts: RunArtifacts,
  pair: ExpectedMatrixPair,
  pairSessions: RunSessionArtifact[]
): string[] {
  const reasons: string[] = [];
  const pairSession = pairSessions[0];
  const unpairedLedgers = artifacts.ledgers.filter(
    (ledger) =>
      !artifacts.sessions.some(
        (session) =>
          session.index === ledger.index && ledger.directoryName === `session-${session.index}`
      )
  );
  if (unpairedLedgers.length > 0) {
    reasons.push('run contains a liability ledger without exact session metadata');
  }
  if (pair.lane === 'funded') {
    if (
      artifacts.sessions.length === 0 ||
      artifacts.ledgers.length !== artifacts.sessions.length ||
      artifacts.sessions.some(
        (session) => !isTerminalFundedSession(session, artifacts.manifest.runId)
      )
    ) {
      reasons.push('funded run contains a session without exact terminal liability provenance');
    }
    const funded = artifacts.manifest.funded;
    const cocod = isJsonObject(funded) ? funded.cocod : undefined;
    if (
      !isJsonObject(funded) ||
      funded.acceptedTestFundLoss !== true ||
      !isJsonObject(cocod) ||
      typeof cocod.bin !== 'string' ||
      cocod.bin.length === 0 ||
      (cocod.source !== 'env' && cocod.source !== 'path') ||
      typeof cocod.version !== 'string' ||
      !COCOD_ALLOWED_VERSIONS.has(cocod.version) ||
      typeof cocod.home !== 'string' ||
      cocod.home.length === 0
    ) {
      reasons.push('funded manifest lacks accepted live cocod metadata');
    }
    if (pair.fundedAssets.length <= 0) {
      reasons.push('funded pair has no authored asset count');
    }
    if (pairSession?.data.seedExport !== true) {
      reasons.push('funded session does not prove private seed export');
    }
    const entries = pairSession?.ledger?.entries;
    if (!entries) {
      reasons.push('funded session has no strict nonempty liability ledger');
    } else {
      const sessionRunId = pairSession.data.runId;
      const intentLegs = new Set(
        entries.filter((entry) => entry.kind === 'intent').map((entry) => entry.legId)
      );
      const intentEntries = entries.filter(
        (entry): entry is Extract<LedgerEntry, { kind: 'intent' }> => entry.kind === 'intent'
      );
      const fundedLegs = new Set(
        entries.filter((entry) => entry.kind === 'funded').map((entry) => entry.legId)
      );
      const reconciledLegs = new Set(
        entries.filter((entry) => entry.kind === 'reconciled').map((entry) => entry.legId)
      );
      const exactLegs =
        intentLegs.size === pair.fundedAssets.length &&
        fundedLegs.size === pair.fundedAssets.length &&
        reconciledLegs.size === pair.fundedAssets.length &&
        [...intentLegs].every((legId) => fundedLegs.has(legId) && reconciledLegs.has(legId));
      const authoredAssets = new Set(
        pair.fundedAssets.map(
          (asset) =>
            `${asset.mintUrl}\u0000${asset.unit}\u0000${asset.accountIndex}\u0000${asset.maxPrincipal}`
        )
      );
      const intentAssets = new Set(
        intentEntries.map(
          (entry) =>
            `${entry.asset.mintUrl}\u0000${entry.asset.unit}\u0000${entry.asset.accountIndex}\u0000${entry.expectedAmount}`
        )
      );
      const exactAssets =
        intentEntries.length === pair.fundedAssets.length &&
        intentAssets.size === authoredAssets.size &&
        [...authoredAssets].every((asset) => intentAssets.has(asset));
      if (
        typeof sessionRunId !== 'string' ||
        entries.some((entry) => entry.runId !== sessionRunId) ||
        !exactLegs ||
        !exactAssets
      ) {
        reasons.push('funded liability ledger does not exactly reconcile every authored asset');
      }
    }
  } else {
    if (pair.fundedAssets.length !== 0) reasons.push('nonfunded pair declares funded assets');
    if (artifacts.manifest.funded !== undefined) {
      reasons.push('nonfunded run contains funded manifest metadata');
    }
    if (artifacts.sessions.some((session) => session.data.seedExport !== false)) {
      reasons.push('nonfunded run does not disable seed export in every session');
    }
    if (artifacts.ledgers.length > 0) {
      reasons.push('nonfunded run contains a liability ledger');
    }
  }
  return reasons;
}

function validateRawRun(
  artifacts: RunArtifacts,
  run: RunDetail,
  pair: ExpectedMatrixPair,
  cutoffMs: number,
  timeline: RunDetail['scenarios'][number]
): ResultType<void, CandidateRejection> {
  const { events, manifest, runDir } = artifacts;
  const reasons: string[] = [];
  const runBegins = events.filter((event) => event.type === 'run.begin');
  const runEnds = events.filter((event) => event.type === 'run.end');
  const scenarioBegins = events.filter((event) => event.type === 'scenario.begin');
  const scenarioEnds = events.filter((event) => event.type === 'scenario.end');
  const deferred = events.filter((event) => event.type === 'deferred');
  const suiteBegins = events.filter((event) => event.type === 'suite.begin');
  const suiteEnds = events.filter((event) => event.type === 'suite.end');
  const runBegin = runBegins[0];
  const runEnd = runEnds[0];
  const result = run.result;
  const rawPassed = typeof runEnd?.passed === 'number' ? runEnd.passed : undefined;
  const rawFailed = typeof runEnd?.failed === 'number' ? runEnd.failed : undefined;
  const rawSkipped = typeof runEnd?.skipped === 'number' ? runEnd.skipped : undefined;
  const rawDeferred = typeof runEnd?.deferred === 'number' ? runEnd.deferred : undefined;

  if (events.length === 0) reasons.push('raw event stream is empty');
  if (
    !events.every((event, index) => {
      const previous = events[index - 1];
      return (
        event.seq === index &&
        typeof event.t === 'number' &&
        Number.isSafeInteger(event.t) &&
        (!previous || (typeof previous.t === 'number' && event.t >= previous.t))
      );
    })
  ) {
    reasons.push('raw event seq/t values are invalid');
  }
  if (runBegins.length !== 1 || events[0]?.type !== 'run.begin') {
    reasons.push('raw stream must start with exactly one run.begin');
  }
  if (runEnds.length !== 1 || events.at(-1)?.type !== 'run.end') {
    reasons.push('raw stream must end with exactly one run.end');
  }
  if (
    suiteBegins.length !== 1 ||
    events[1]?.type !== 'suite.begin' ||
    suiteEnds.length !== 1 ||
    events.at(-2)?.type !== 'suite.end' ||
    suiteBegins[0]?.suite !== run.suite ||
    suiteEnds[0]?.suite !== run.suite ||
    runBegin?.suite !== run.suite ||
    manifest.suite !== run.suite
  ) {
    reasons.push('raw suite boundaries are invalid');
  }
  if (
    runBegin?.runId !== run.runId ||
    runEnd?.runId !== run.runId ||
    runBegin?.proof !== 'product-run' ||
    runEnd?.proof !== 'product-run'
  ) {
    reasons.push('raw run identity/proof does not match');
  }

  const manifestIds =
    Array.isArray(manifest.scenarios) && manifest.scenarios.every((id) => typeof id === 'string')
      ? (manifest.scenarios as string[])
      : [];
  const manifestStartedAtMs =
    typeof manifest.startedAt === 'string' ? strictIsoTimestampMs(manifest.startedAt) : undefined;
  if (
    manifest.version !== 1 ||
    manifest.runId !== run.runId ||
    manifest.driver !== run.driver ||
    manifest.proof !== 'product-run' ||
    manifest.startedAt !== run.startedAt ||
    manifestStartedAtMs === undefined ||
    manifestStartedAtMs < cutoffMs ||
    manifestIds.length !== run.scenarioIds.length ||
    manifestIds.some((id, index) => id !== run.scenarioIds[index])
  ) {
    reasons.push('raw manifest does not exactly match parsed run');
  }
  const startedAtMs = strictIsoTimestampMs(run.startedAt);
  if (
    typeof runBegin?.t !== 'number' ||
    runBegin.t < cutoffMs ||
    startedAtMs === undefined ||
    runBegin.t < startedAtMs
  ) {
    reasons.push('raw run began before cutoff');
  }
  if (runBegin?.totalScenarios !== manifestIds.length) {
    reasons.push('raw run.begin total does not match manifest');
  }

  if (!result || !runEnd) reasons.push('raw/parsed run.end is missing');
  else {
    if (
      rawPassed !== result.passed ||
      rawFailed !== result.failed ||
      rawSkipped !== result.skipped ||
      rawDeferred !== result.deferred ||
      runEnd.durationMs !== result.durationMs ||
      runEnd.funds !== result.funds
    ) {
      reasons.push('raw run.end does not match parsed result');
    }
    if (rawFailed !== 0 || rawSkipped !== 0 || runEnd.funds === 'quarantined') {
      reasons.push('raw run.end is not zero-failure/reconciled');
    }
    if (
      rawPassed === undefined ||
      rawFailed === undefined ||
      rawSkipped === undefined ||
      rawDeferred === undefined ||
      rawPassed + rawFailed + rawSkipped + rawDeferred !== manifestIds.length
    ) {
      reasons.push('raw run.end totals do not reconcile');
    }
    if (
      scenarioBegins.length !== (rawPassed ?? 0) + (rawFailed ?? 0) ||
      scenarioEnds.length !== scenarioBegins.length ||
      deferred.length !== rawDeferred ||
      run.scenarios.length !== scenarioBegins.length
    ) {
      reasons.push('raw scenario event counts do not reconcile');
    }
  }

  const begunIds = scenarioBegins.map((event) => String(event.id));
  const endedIds = scenarioEnds.map((event) => String(event.id));
  const deferredIds = deferred.map((event) => String(event.scenarioId));
  const sorted = (items: string[]) => [...items].sort();
  if (
    new Set(begunIds).size !== begunIds.length ||
    new Set(deferredIds).size !== deferredIds.length
  ) {
    reasons.push('raw scenarios are duplicated');
  }
  if (JSON.stringify(sorted(begunIds)) !== JSON.stringify(sorted(endedIds))) {
    reasons.push('raw scenario begin/end identities differ');
  }
  if (begunIds.some((id) => deferredIds.includes(id))) {
    reasons.push('raw scenario is both attempted and deferred');
  }
  if (
    JSON.stringify(sorted([...begunIds, ...deferredIds])) !== JSON.stringify(sorted(manifestIds))
  ) {
    reasons.push('raw attempted/deferred scenarios differ from manifest');
  }
  const lifecycleIds = events.flatMap((event) =>
    event.type === 'scenario.begin'
      ? [String(event.id)]
      : event.type === 'deferred'
        ? [String(event.scenarioId)]
        : []
  );
  if (JSON.stringify(lifecycleIds) !== JSON.stringify(manifestIds)) {
    reasons.push('raw scenario lifecycle order differs from manifest');
  }
  if (
    scenarioBegins.some(
      (event) =>
        event.index !== manifestIds.indexOf(String(event.id)) + 1 ||
        event.total !== manifestIds.length
    )
  ) {
    reasons.push('raw scenario indexes do not match manifest order');
  }
  let activeScenario: string | undefined;
  let scenarioOrderInvalid = false;
  const suiteBeginIndex = events.findIndex((event) => event.type === 'suite.begin');
  const suiteEndIndex = events.findIndex((event) => event.type === 'suite.end');
  for (const [index, event] of events.entries()) {
    if (event.type === 'scenario.begin') {
      if (activeScenario || index <= suiteBeginIndex || index >= suiteEndIndex) {
        scenarioOrderInvalid = true;
      }
      activeScenario = String(event.id);
    } else if (event.type === 'scenario.end') {
      if (activeScenario !== String(event.id)) scenarioOrderInvalid = true;
      activeScenario = undefined;
    } else if (event.type === 'deferred') {
      if (activeScenario || index <= suiteBeginIndex || index >= suiteEndIndex) {
        scenarioOrderInvalid = true;
      }
    }
  }
  if (activeScenario || scenarioOrderInvalid) {
    reasons.push('raw scenario boundaries are not sequentially ordered');
  }
  if (events.some((event) => event.ok === false)) reasons.push('raw stream contains a red event');
  if (
    events.some((event) =>
      ['baseline.failure', 'quarantine', 'cleanup.skipped'].includes(String(event.type))
    )
  ) {
    reasons.push('raw stream contains a failure marker');
  }

  const beginIndexes = events.flatMap((event, index) =>
    event.type === 'scenario.begin' && event.id === pair.scenarioId ? [index] : []
  );
  const endIndexes = events.flatMap((event, index) =>
    event.type === 'scenario.end' && event.id === pair.scenarioId ? [index] : []
  );
  if (beginIndexes.length !== 1 || endIndexes.length !== 1 || endIndexes[0] <= beginIndexes[0]) {
    reasons.push('raw pair does not have one ordered scenario begin/end');
  } else {
    const scoped = events.slice(beginIndexes[0], endIndexes[0] + 1);
    const finalStates = scoped.filter((event) => event.type === 'final-state');
    const reconciliationBegins = scoped.filter((event) => event.type === 'reconciliation.begin');
    const reconciliationEnds = scoped.filter((event) => event.type === 'reconciliation.end');
    const scopedBegin = scoped[0];
    const scopedEnd = scoped.at(-1);
    const finalState = finalStates[0];
    const finalFrames = timeline.frames.filter((frame) => frame.phase === 'FINAL');
    const finalFrame = finalFrames[0];
    if (scopedBegin?.lane !== pair.lane)
      reasons.push('raw scenario lane differs from authored lane');
    if (
      finalStates.length !== 1 ||
      finalState?.ok !== true ||
      finalState?.expected !== pair.endState ||
      finalState?.actual !== pair.endState
    ) {
      reasons.push('raw final state is not green/authored');
    }
    if (pair.lane === 'funded') {
      const reconciliationBegin = reconciliationBegins[0];
      const reconciliationEnd = reconciliationEnds[0];
      if (
        reconciliationBegins.length !== 1 ||
        reconciliationEnds.length !== 1 ||
        reconciliationEnd?.ok !== true ||
        reconciliationEnd.state !== 'reconciled' ||
        scoped.indexOf(reconciliationBegin!) >= scoped.indexOf(reconciliationEnd!) ||
        scoped.indexOf(reconciliationEnd!) >= scoped.indexOf(finalState!)
      ) {
        reasons.push('raw funded reconciliation proof is not exact and green');
      }
    } else if (reconciliationBegins.length !== 0 || reconciliationEnds.length !== 0) {
      reasons.push('raw nonfunded scenario contains reconciliation events');
    }
    if (!finalFrame || finalFrames.length !== 1) {
      reasons.push('viewer timeline does not have exactly one FINAL frame');
    } else {
      const rawFinalArtifacts = scoped.filter(
        (event) =>
          event.type === 'artifact' &&
          event.stepId === 'FINAL' &&
          event.artifactSeq === finalFrame.artifactSeq
      );
      const screenshot = rawFinalArtifacts.filter(
        (event) =>
          event.kind === 'screenshot' &&
          typeof event.path === 'string' &&
          resolve(event.path) === resolve(runDir, finalFrame.file)
      );
      const ax = rawFinalArtifacts.filter(
        (event) =>
          event.kind === 'ax' &&
          typeof event.path === 'string' &&
          finalFrame.axFile !== undefined &&
          resolve(event.path) === resolve(runDir, finalFrame.axFile)
      );
      const screenshotIndex = scoped.indexOf(screenshot[0]!);
      const axIndex = scoped.indexOf(ax[0]!);
      const finalStateIndex = scoped.indexOf(finalState!);
      if (
        screenshot.length !== 1 ||
        ax.length !== 1 ||
        screenshotIndex < 0 ||
        axIndex <= screenshotIndex ||
        finalStateIndex <= axIndex
      ) {
        reasons.push('raw FINAL screenshot/AX events do not match the viewer frame');
      }
    }
    if (scopedEnd?.type !== 'scenario.end' || scopedEnd.ok !== true) {
      reasons.push('raw scenario does not end green');
    }
  }

  return reasons.length === 0
    ? ok(undefined)
    : err({ type: 'candidate-rejected', reasons } satisfies CandidateRejection);
}

function validateCandidate(
  run: RunDetail,
  pair: ExpectedMatrixPair,
  catalogEntry: ScenarioCatalogEntry | undefined,
  artifacts: ResultType<RunArtifacts, ArtifactReadError>,
  cutoffMs: number,
  sourceFingerprint: string
): ResultType<RunDetail, CandidateRejection> {
  const reasons: string[] = [];
  const startedAtMs = strictIsoTimestampMs(run.startedAt);
  if (startedAtMs === undefined || startedAtMs < cutoffMs) reasons.push('run is stale');
  if (run.proof !== 'product-run') reasons.push('run is not product proof');
  if (run.status !== 'complete') reasons.push('run is not complete');
  if (run.driver !== pair.driver) reasons.push(`driver is ${run.driver}, expected ${pair.driver}`);
  if (!run.result) reasons.push('run has no run.end result');
  else {
    if (run.result.failed !== 0) reasons.push(`run has ${run.result.failed} failure(s)`);
    if (run.result.skipped !== 0) reasons.push(`run has ${run.result.skipped} skipped scenario(s)`);
    if (run.result.funds === 'quarantined') reasons.push('run funds are quarantined');
    if (
      pair.lane === 'funded' &&
      (run.result.funds !== 'reconciled' || run.fundsSafeToDelete !== true)
    ) {
      reasons.push('funded run is not reconciled and safe to delete');
    }
    if (pair.lane !== 'funded' && run.result.funds !== 'n/a') {
      reasons.push('nonfunded run funds are not exactly n/a');
    }
  }
  if (!run.scenarioIds.includes(pair.scenarioId)) reasons.push('manifest selection omits scenario');

  const timelines = run.scenarios.filter((timeline) => timeline.scenarioId === pair.scenarioId);
  if (timelines.length !== 1) reasons.push(`run has ${timelines.length} matching timeline(s)`);
  const timeline = timelines[0];
  if (timeline) {
    if (timeline.deferred) reasons.push('timeline is deferred');
    if (timeline.ok !== true) reasons.push('timeline is not green');
    if (timeline.lane !== pair.lane)
      reasons.push(`timeline lane is ${timeline.lane}, expected ${pair.lane}`);
    if (
      timeline.finalState?.ok !== true ||
      timeline.finalState.expected !== pair.endState ||
      timeline.finalState.actual !== pair.endState
    ) {
      reasons.push(`final state is not green ${pair.endState}`);
    }
    if (!timeline.frames.some((frame) => frame.phase === 'FINAL')) {
      reasons.push('timeline has no FINAL frame');
    }
    if (timeline.frames.some((frame) => frame.ok === false))
      reasons.push('timeline has a red frame');
  }

  if (!catalogEntry) reasons.push('viewer catalog omits scenario');
  else {
    if (!catalogEntry.suites.includes('full'))
      reasons.push('viewer scenario is outside full suite');
    if (catalogEntry.lane !== pair.lane) reasons.push('viewer lane differs from authored lane');
    if (!catalogEntry.platforms.includes(pair.platform))
      reasons.push('viewer platform chip is missing');
    const references = catalogEntry.runs.filter(
      (reference) => reference.runId === `run-${run.runId}`
    );
    if (references.length !== 1) reasons.push(`viewer has ${references.length} matching run refs`);
    const reference = references[0];
    if (
      reference &&
      (reference.proof !== 'product-run' ||
        reference.status !== 'complete' ||
        reference.driver !== pair.driver ||
        reference.ok !== true ||
        reference.startedAt !== run.startedAt)
    ) {
      reasons.push('viewer run ref is not green product evidence');
    }
  }

  if (artifacts.isErr()) reasons.push(`raw artifacts unreadable: ${artifacts.error.message}`);
  else {
    const { manifest, sessions } = artifacts.value;
    if (
      manifest.runId !== run.runId ||
      manifest.driver !== run.driver ||
      manifest.proof !== 'product-run' ||
      manifest.startedAt !== run.startedAt ||
      manifest.sourceFingerprint !== sourceFingerprint ||
      !Array.isArray(manifest.scenarios) ||
      !manifest.scenarios.includes(pair.scenarioId)
    ) {
      reasons.push('raw manifest does not match parsed run');
    }
    const pairSessions = sessionsProvingPair(sessions, run.runId, pair);
    if (pairSessions.length !== 1) {
      reasons.push(`expected one owned ephemeral session for pair, found ${pairSessions.length}`);
    }
    reasons.push(...fundingEvidenceReasons(artifacts.value, pair, pairSessions));
    const rawValidation = timeline
      ? validateRawRun(artifacts.value, run, pair, cutoffMs, timeline)
      : err({
          type: 'candidate-rejected',
          reasons: ['raw pair has no viewer timeline'],
        } satisfies CandidateRejection);
    if (rawValidation.isErr()) reasons.push(...rawValidation.error.reasons);
    if (timeline) {
      const screenshotEvidence = [...timeline.frames, ...timeline.named];
      if (screenshotEvidence.some((frame) => !frame.axFile)) {
        reasons.push('viewer timeline has screenshot evidence without AX data');
      }
      const viewerFiles = screenshotEvidence.flatMap((frame) => [
        frame.file,
        ...(frame.axFile ? [frame.axFile] : []),
        ...(frame.storeFile ? [frame.storeFile] : []),
        ...(frame.dbFile ? [frame.dbFile] : []),
      ]);
      if (timeline.videoFile) viewerFiles.push(timeline.videoFile);
      if (viewerFiles.some((file) => !safeArtifactPath(artifacts.value.runDir, file))) {
        reasons.push('viewer timeline references a missing or unsafe artifact');
      }
    }
  }

  return reasons.length === 0
    ? ok(run)
    : err({ type: 'candidate-rejected', reasons } satisfies CandidateRejection);
}

export function auditFreshMatrixEvidence(
  input: FreshMatrixEvidenceInput
): ResultType<FreshMatrixAuditReport, FreshMatrixAuditError> {
  const cutoffMs = strictIsoTimestampMs(input.cutoff);
  if (cutoffMs === undefined) {
    return err({ type: 'invalid-cutoff', message: `invalid ISO cutoff: ${input.cutoff}` });
  }
  const cutoff = new Date(cutoffMs).toISOString();

  const keys = input.expectedPairs.map(pairKey);
  if (new Set(keys).size !== keys.length) {
    return err({ type: 'invalid-matrix', message: 'expected matrix contains duplicate pairs' });
  }

  const catalogById = new Map(input.catalog.map((entry) => [entry.id, entry]));
  const artifactsByRun = new Map<string, ResultType<RunArtifacts, ArtifactReadError>>();
  const coverage: MatrixCoverage[] = [];
  const missing: MissingMatrixPair[] = [];

  for (const pair of input.expectedPairs) {
    const candidates = input.runs.filter(
      (run) =>
        run.driver === pair.driver &&
        run.scenarioIds.includes(pair.scenarioId) &&
        strictIsoTimestampMs(run.startedAt) !== undefined &&
        strictIsoTimestampMs(run.startedAt)! >= cutoffMs
    );
    let selected: RunDetail | undefined;
    const candidateReasons: string[] = [];
    for (const candidate of candidates) {
      let artifacts = artifactsByRun.get(candidate.runId);
      if (!artifacts) {
        artifacts = readRunArtifacts(input.artifactsRoot, candidate.runId);
        artifactsByRun.set(candidate.runId, artifacts);
      }
      const result = validateCandidate(
        candidate,
        pair,
        catalogById.get(pair.scenarioId),
        artifacts,
        cutoffMs,
        input.sourceFingerprint
      );
      if (result.isOk()) {
        selected = result.value;
        break;
      }
      candidateReasons.push(...result.error.reasons);
    }
    if (selected) {
      coverage.push({
        scenarioId: pair.scenarioId,
        platform: pair.platform,
        runId: selected.runId,
      });
    } else {
      missing.push({
        ...pair,
        reasons:
          candidateReasons.length > 0
            ? [...new Set(candidateReasons)]
            : ['no fresh run selected this scenario on the required driver'],
      });
    }
  }

  const pairsByRun = new Map<string, number>();
  for (const item of coverage) pairsByRun.set(item.runId, (pairsByRun.get(item.runId) ?? 0) + 1);
  const platformCount = (platform: Platform, items: { platform: Platform }[]): number =>
    items.filter((item) => item.platform === platform).length;

  return ok({
    cutoff,
    sourceFingerprint: input.sourceFingerprint,
    scenarios: input.scenarioCount,
    expected: input.expectedPairs.length,
    covered: coverage.length,
    missing,
    coverage,
    runs: [...pairsByRun].map(([runId, pairs]) => ({ runId, pairs })),
    platforms: {
      ios: {
        expected: platformCount('ios', input.expectedPairs),
        covered: platformCount('ios', coverage),
      },
      android: {
        expected: platformCount('android', input.expectedPairs),
        covered: platformCount('android', coverage),
      },
    },
    complete: missing.length === 0,
  });
}

interface WorkspaceSourceDependencies {
  captureSourceFingerprint?: () => string | undefined;
}

export function loadWorkspaceFreshMatrixSource(
  dependencies: WorkspaceSourceDependencies = {}
): ResultAsync<WorkspaceFreshMatrixSource, WorkspaceFreshMatrixSourceError> {
  return ResultAsync.fromThrowable(
    async () => {
      const fingerprint =
        dependencies.captureSourceFingerprint ?? (() => captureSourceFingerprint(E2E_ROOT));
      const initialSourceFingerprint = fingerprint();
      if (!initialSourceFingerprint) throw new Error('current source fingerprint is unavailable');
      const loaded = loadE2E(E2E_ROOT);
      if (loaded.issues.length > 0) {
        throw new Error(`e2e authoring has ${loaded.issues.length} validation issue(s)`);
      }
      const selection = selectSuiteScenarios(loaded.suites, loaded.scenarios, { suite: 'full' });
      const expectedPairs = selection.scenarios.flatMap((scenario) =>
        scenarioPlatforms(effectiveRequirements(scenario, loaded.fixtures)).map(
          (platform): ExpectedMatrixPair => ({
            scenarioId: scenario.id,
            platform,
            driver: platform === 'ios' ? 'sim' : 'android',
            lane: scenario.lane,
            endState: scenario.endState,
            fundedAssets: scenario.funds?.assets.map((asset) => ({ ...asset })) ?? [],
          })
        )
      );
      if (selection.scenarios.length !== 126 || expectedPairs.length !== 215) {
        throw new Error(
          `full matrix drifted: ${selection.scenarios.length} scenarios, ${expectedPairs.length} pairs`
        );
      }
      const expectedKeys = expectedPairs.map(pairKey);
      if (new Set(expectedKeys).size !== expectedKeys.length) {
        throw new Error('full matrix contains duplicate scenario/platform pairs');
      }

      const runs = await listRuns();
      const catalog = (await buildCatalog()).filter((entry) => entry.suites.includes('full'));
      const viewerKeys = catalog.flatMap((entry) =>
        entry.platforms.map((platform) => pairKey({ scenarioId: entry.id, platform }))
      );
      if (
        catalog.length !== 126 ||
        viewerKeys.length !== 215 ||
        JSON.stringify([...viewerKeys].sort()) !== JSON.stringify([...expectedKeys].sort())
      ) {
        throw new Error(
          `viewer matrix differs from runner: ${catalog.length} scenarios, ${viewerKeys.length} pairs`
        );
      }

      const sourceFingerprint = fingerprint();
      if (!sourceFingerprint || sourceFingerprint !== initialSourceFingerprint) {
        throw new Error('source changed while the matrix audit was loading');
      }

      return {
        sourceFingerprint,
        scenarioCount: selection.scenarios.length,
        expectedPairs,
        catalog,
        runs,
        artifactsRoot: ARTIFACTS,
      };
    },
    (cause): WorkspaceFreshMatrixSourceError => ({
      type: 'workspace-source',
      message: cause instanceof Error ? cause.message : String(cause),
    })
  )();
}

export function runWorkspaceFreshMatrixAudit(
  cutoff: string,
  dependencies: WorkspaceSourceDependencies = {}
): ResultAsync<FreshMatrixAuditReport, WorkspaceFreshMatrixAuditError> {
  const fingerprint =
    dependencies.captureSourceFingerprint ?? (() => captureSourceFingerprint(E2E_ROOT));
  return loadWorkspaceFreshMatrixSource(dependencies).andThen((source) => {
    const audit = auditFreshMatrixEvidence({ cutoff, ...source });
    if (audit.isErr()) return audit;
    const finalSourceFingerprint = fingerprint();
    if (!finalSourceFingerprint || finalSourceFingerprint !== source.sourceFingerprint) {
      return err({
        type: 'workspace-source',
        message: 'source changed while raw matrix evidence was being audited',
      } satisfies WorkspaceFreshMatrixSourceError);
    }
    return audit;
  });
}
