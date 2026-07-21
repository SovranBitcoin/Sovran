/**
 * Cross-platform full-suite orchestrator. Runs every `full.json` session
 * group as its own `bun e2e/cli.ts run` child process (one chunk per
 * platform), retries scenario failures and infra aborts on separate budgets,
 * and checkpoints durable state + SUMMARY.md after every attempt so a killed
 * campaign resumes exactly where it stopped. The fresh-matrix audit remains
 * the authority on coverage; the orchestrator's job is to produce the small
 * all-green runs that audit accepts.
 *
 *   bun e2e/orchestrate.ts plan   [--platforms ios,android] [--lane <lane>]
 *   bun e2e/orchestrate.ts run    --i-approve-destructive-reset
 *                                 [--i-accept-test-fund-loss] [--platforms ...]
 *                                 [--lane <lane>] [--only <chunkId,...>]
 *                                 [--resume <dir|latest>]
 *                                 [--retries-fail N] [--retries-infra N]
 *                                 [--no-record] [--skip-covered]
 *   bun e2e/orchestrate.ts status [--dir <dir|latest>]
 */
/* eslint-disable no-console -- this file is the human-facing CLI boundary */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { captureSourceFingerprint } from './core/git';
import { PLATFORMS, type Platform } from './schema/capabilities';
import { runWorkspaceFreshMatrixAudit } from './audit/fresh-matrix';
import { APP_ROOT, ARTIFACTS, E2E_ROOT } from './viewer/lib/paths';
import { classifyRunDir } from './orchestrator/classify';
import { buildChunkPlan, chunkArgv, type ChunkPlan } from './orchestrator/matrix';
import {
  androidPreflight,
  diskPreflight,
  fundedPreflight,
  iosPreflight,
  type PreflightResult,
} from './orchestrator/preflight';
import { spawnChunkChild, type ChildHandle } from './orchestrator/runner';
import {
  DEFAULT_RETRIES,
  chunksNeedingReconciliation,
  createState,
  isTerminalChunkStatus,
  loadState,
  saveState,
  type OrchestratorState,
} from './orchestrator/state';
import { writeSummary } from './orchestrator/summary';

type Command = 'run' | 'plan' | 'status';

interface OrchestrateOptions {
  command: Command;
  platforms: Platform[];
  lane?: string;
  /** Chunk ids (`platform:target`) to run exclusively — smoke runs and
   * fix-pass re-runs; other chunks stay pending. */
  only?: string[];
  approveDestructiveReset: boolean;
  acceptTestFundLoss: boolean;
  resume?: string;
  dir?: string;
  retriesFail?: number;
  retriesInfra?: number;
  noRecord: boolean;
  skipCovered: boolean;
}

function fail(message: string, code = 2): never {
  console.error(`✗ ${message}`);
  process.exit(code);
}

const VALUE_FLAGS = new Set([
  'platforms',
  'lane',
  'only',
  'resume',
  'dir',
  'retries-fail',
  'retries-infra',
]);
const BOOLEAN_FLAGS = new Set([
  'i-approve-destructive-reset',
  'i-accept-test-fund-loss',
  'no-record',
  'skip-covered',
]);
const ALLOWED_BY_COMMAND: Record<Command, Set<string>> = {
  plan: new Set(['platforms', 'lane']),
  status: new Set(['dir']),
  run: new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS].filter((flag) => flag !== 'dir')),
};

function parseArgs(argv: string[]): OrchestrateOptions {
  const command = argv[0] as Command | undefined;
  if (!command || !['run', 'plan', 'status'].includes(command)) {
    fail(`unknown command "${command ?? ''}" (use run | plan | status)`);
  }
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) fail(`unexpected positional argument "${arg}"`);
    const name = arg.slice(2);
    if (!VALUE_FLAGS.has(name) && !BOOLEAN_FLAGS.has(name)) fail(`unknown flag --${name}`);
    if (!ALLOWED_BY_COMMAND[command].has(name)) fail(`--${name} is not valid for ${command}`);
    if (values.has(name) || booleans.has(name)) fail(`duplicate flag --${name}`);
    if (BOOLEAN_FLAGS.has(name)) {
      booleans.add(name);
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) fail(`--${name} requires a value`);
    values.set(name, value);
  }

  const platformsRaw = values.get('platforms') ?? 'ios,android';
  const platforms = platformsRaw.split(',').filter(Boolean) as Platform[];
  if (
    platforms.length === 0 ||
    platforms.some((platform) => !PLATFORMS.includes(platform)) ||
    new Set(platforms).size !== platforms.length
  ) {
    fail(`--platforms must be a unique subset of ${PLATFORMS.join(',')} (order = execution order)`);
  }
  const intFlag = (name: string): number | undefined => {
    const raw = values.get(name);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`--${name} must be a positive integer`);
    return parsed;
  };

  return {
    command,
    platforms,
    lane: values.get('lane'),
    only: values.get('only')?.split(',').filter(Boolean),
    approveDestructiveReset: booleans.has('i-approve-destructive-reset'),
    acceptTestFundLoss: booleans.has('i-accept-test-fund-loss'),
    resume: values.get('resume'),
    dir: values.get('dir'),
    retriesFail: intFlag('retries-fail'),
    retriesInfra: intFlag('retries-infra'),
    noRecord: booleans.has('no-record'),
    skipCovered: booleans.has('skip-covered'),
  };
}

const nowIso = (): string => new Date().toISOString();

function resolveCampaignDirName(ref: string): string {
  if (ref !== 'latest') {
    const name = ref.startsWith('orchestrate-') ? ref : `orchestrate-${ref}`;
    if (!existsSync(join(ARTIFACTS, name)))
      fail(`campaign dir not found: ${join(ARTIFACTS, name)}`);
    return name;
  }
  const candidates = existsSync(ARTIFACTS)
    ? readdirSync(ARTIFACTS)
        .filter((name) => name.startsWith('orchestrate-'))
        .sort()
    : [];
  if (candidates.length === 0) fail('no orchestrate-* campaign dirs under e2e/artifacts');
  return candidates.at(-1)!;
}

function requirePlan(options: OrchestrateOptions): ChunkPlan {
  const plan = buildChunkPlan({ platforms: options.platforms, lane: options.lane });
  if (plan.isErr()) fail(plan.error);
  return plan.value;
}

function printPlan(plan: ChunkPlan, options: OrchestrateOptions): void {
  console.log(
    `[orchestrate] full suite: ${plan.scenarioCount} scenarios, ${plan.expectedPairKeys.length} platform pairs`
  );
  for (const platform of options.platforms) {
    const chunks = plan.chunks.filter((chunk) => chunk.platform === platform);
    const funded = chunks.filter((chunk) => chunk.funded).length;
    const pairs = chunks.reduce((sum, chunk) => sum + chunk.expectedPairKeys.length, 0);
    console.log(
      `  ${platform}: ${chunks.length} chunk(s) (${funded} funded) proving ${pairs} pair(s)`
    );
  }
  if (options.lane) console.log(`  lane filter: ${options.lane}`);
  for (const chunk of plan.chunks) {
    const members = chunk.memberIds.length > 1 ? ` [group: ${chunk.memberIds.join(' → ')}]` : '';
    console.log(`    ${chunk.chunkId}${chunk.funded ? ' (funded)' : ''}${members}`);
  }
}

function guardFingerprint(state: OrchestratorState, campaignDir: string): void {
  const current = captureSourceFingerprint(E2E_ROOT);
  if (current === state.sourceFingerprint) return;
  state.status = 'source-drift';
  saveState(campaignDir, state, nowIso());
  writeSummary(campaignDir, state);
  fail(
    'source changed mid-campaign — fresh-matrix compares run manifests against the CURRENT fingerprint, so prior evidence is now invalid. Commit/stash, then start a new campaign.',
    3
  );
}

function applyPreflight(result: PreflightResult, label: string): void {
  if (result.isErr()) fail(`${label} preflight: ${result.error}`);
  for (const warning of result.value) console.warn(`⚠ ${label} preflight: ${warning}`);
}

async function markAuditCoveredChunks(
  state: OrchestratorState,
  campaignDir: string
): Promise<void> {
  console.log('[orchestrate] auditing existing coverage (fresh-matrix)…');
  const audit = await runWorkspaceFreshMatrixAudit(state.createdAt);
  if (audit.isErr()) {
    console.warn(`⚠ skip-covered audit unavailable: ${audit.error.message}`);
    return;
  }
  const covered = new Set(
    audit.value.coverage.map((item) => `${item.scenarioId}|${item.platform}`)
  );
  let marked = 0;
  for (const chunk of state.chunks) {
    if (isTerminalChunkStatus(chunk.status)) continue;
    if (chunk.expectedPairKeys.every((key) => covered.has(key))) {
      chunk.status = 'passed';
      chunk.coveredByAudit = true;
      marked += 1;
    }
  }
  if (marked > 0) {
    console.log(`[orchestrate] ${marked} chunk(s) already covered by fresh evidence — skipping`);
    saveState(campaignDir, state, nowIso());
    writeSummary(campaignDir, state);
  }
}

async function finalize(state: OrchestratorState, campaignDir: string): Promise<void> {
  const audit = await runWorkspaceFreshMatrixAudit(state.createdAt);
  if (audit.isOk()) {
    state.finalAudit = {
      covered: audit.value.covered,
      expected: audit.value.expected,
      complete: audit.value.complete,
      missing: audit.value.missing.map((pair) => ({
        pairKey: `${pair.scenarioId}|${pair.platform}`,
        reasons: pair.reasons,
      })),
    };
  } else {
    console.warn(`⚠ finalizing fresh-matrix audit unavailable: ${audit.error.message}`);
  }
  const unfinished = state.chunks.some(
    (chunk) => chunk.status === 'pending' || chunk.status === 'running'
  );
  if (state.status === 'running' && !unfinished) {
    state.status = state.chunks.some((chunk) => chunk.status === 'funded-blocked')
      ? 'funded-halted'
      : 'complete';
  }
  saveState(campaignDir, state, nowIso());
  writeSummary(campaignDir, state);
}

async function commandRun(options: OrchestrateOptions): Promise<void> {
  if (!options.approveDestructiveReset) {
    fail('run requires --i-approve-destructive-reset (forwarded to every chunk)');
  }
  const plan = requirePlan(options);
  if (options.only) {
    const known = new Set(plan.chunks.map((chunk) => chunk.chunkId));
    const unknown = options.only.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      fail(
        `--only references unknown chunk id(s): ${unknown.join(', ')} (see \`bun e2e/orchestrate.ts plan\`)`
      );
    }
  }

  let state: OrchestratorState;
  let campaignId: string;
  if (options.resume) {
    campaignId = resolveCampaignDirName(options.resume);
    const loaded = loadState(join(ARTIFACTS, campaignId));
    if (loaded.isErr()) fail(loaded.error);
    state = loaded.value;
    const current = captureSourceFingerprint(E2E_ROOT);
    if (current !== state.sourceFingerprint) {
      fail(
        `cannot resume ${campaignId}: source fingerprint changed since the campaign started — prior evidence is invalid under fresh-matrix; start a new campaign`
      );
    }
    if (state.status === 'source-drift') fail(`campaign ${campaignId} stopped on source drift`);
    state.status = 'running';
    // A funded halt (locked cocod, quarantine, missing consent) is terminal
    // within a session but must be retryable across resumes once the operator
    // fixed the cause — otherwise unlocking cocod could never unblock the lane.
    if (options.acceptTestFundLoss) {
      state.config.acceptTestFundLoss = true;
      for (const chunk of state.chunks) {
        if (
          chunk.status === 'funded-blocked' ||
          (chunk.status === 'skipped' && chunk.skipReason?.startsWith('funded'))
        ) {
          chunk.status = 'pending';
          chunk.skipReason = undefined;
        }
      }
    }
  } else {
    const fingerprint = captureSourceFingerprint(E2E_ROOT);
    if (!fingerprint) fail('cannot capture source fingerprint (is this a git checkout?)');
    const startedAt = nowIso();
    campaignId = `orchestrate-${startedAt.replace(/[:.]/g, '-')}`;
    state = createState({
      campaignId,
      nowIso: startedAt,
      sourceFingerprint: fingerprint,
      plan,
      config: {
        platforms: options.platforms,
        lane: options.lane,
        noRecord: options.noRecord,
        acceptTestFundLoss: options.acceptTestFundLoss,
        retries: {
          scenarioFail: options.retriesFail ?? DEFAULT_RETRIES.scenarioFail,
          infraAbort: {
            ios: options.retriesInfra ?? DEFAULT_RETRIES.infraAbort.ios,
            android: options.retriesInfra ?? DEFAULT_RETRIES.infraAbort.android,
          },
        },
      },
    });
  }
  const campaignDir = join(ARTIFACTS, campaignId);
  const logFile = join(campaignDir, 'orchestrator.log');

  for (const warning of diskPreflight()) console.warn(`⚠ ${warning}`);

  // Funded chunks need the stronger consent up front — mark, never silently drop.
  if (!state.config.acceptTestFundLoss) {
    for (const chunk of state.chunks) {
      if (chunk.funded && !isTerminalChunkStatus(chunk.status)) {
        chunk.status = 'skipped';
        chunk.skipReason = 'funded scenarios need --i-accept-test-fund-loss';
      }
    }
  }

  // A chunk left `running` by a killed orchestrator: classify its last attempt now.
  for (const chunk of chunksNeedingReconciliation(state)) {
    const last = chunk.attempts.at(-1);
    if (last && !last.endedAt) {
      const classification = classifyRunDir(ARTIFACTS, last.runId);
      last.endedAt = nowIso();
      last.outcome = classification.outcome === 'passed' ? 'passed' : 'infra-aborted';
      last.failure = classification.failure;
      last.artifacts = classification.artifacts;
    }
    chunk.status = 'pending';
  }

  saveState(campaignDir, state, nowIso());
  writeSummary(campaignDir, state);
  console.log(`[orchestrate] campaign ${campaignId}`);
  console.log(`[orchestrate] state: ${join(campaignDir, 'state.json')}`);
  console.log(`[orchestrate] summary: ${join(campaignDir, 'SUMMARY.md')}`);

  if (options.skipCovered || options.resume) await markAuditCoveredChunks(state, campaignDir);

  let currentHandle: ChildHandle | undefined;
  let shuttingDown = false;
  const onSignal = () => {
    if (shuttingDown) process.exit(130);
    shuttingDown = true;
    console.error('\n[orchestrate] interrupt — stopping child and checkpointing…');
    if (currentHandle) currentHandle.terminate();
    else {
      state.status = 'interrupted';
      saveState(campaignDir, state, nowIso());
      writeSummary(campaignDir, state);
      process.exit(130);
    }
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const preflighted = new Set<Platform>();
  let fundedPreflighted = false;
  let fundedHalted = false;

  for (const chunk of state.chunks) {
    if (isTerminalChunkStatus(chunk.status)) continue;
    if (options.only && !options.only.includes(chunk.chunkId)) continue;
    if (fundedHalted && chunk.funded) {
      chunk.status = 'skipped';
      chunk.skipReason = 'funded-halted: earlier funded chunk quarantined or blocked';
      saveState(campaignDir, state, nowIso());
      continue;
    }

    if (!preflighted.has(chunk.platform)) {
      applyPreflight(
        chunk.platform === 'ios' ? await iosPreflight() : androidPreflight(),
        chunk.platform
      );
      preflighted.add(chunk.platform);
    }
    if (chunk.funded && !fundedPreflighted) {
      const funded = await fundedPreflight();
      if (funded.isErr()) {
        fundedHalted = true;
        chunk.status = 'funded-blocked';
        chunk.skipReason = funded.error;
        saveState(campaignDir, state, nowIso());
        writeSummary(campaignDir, state);
        console.error(
          `✗ funded preflight: ${funded.error} — funded chunks blocked, continuing simulator chunks`
        );
        continue;
      }
      for (const warning of funded.value) console.warn(`⚠ funded preflight: ${warning}`);
      fundedPreflighted = true;
    }

    // Attempt loop with per-kind budgets.
    for (;;) {
      guardFingerprint(state, campaignDir);
      chunk.status = 'running';
      saveState(campaignDir, state, nowIso());
      writeSummary(campaignDir, state);

      const attemptNumber = chunk.attempts.length + 1;
      const argv = chunkArgv(
        {
          chunkId: chunk.chunkId,
          platform: chunk.platform,
          driver: chunk.driver,
          targetScenarioId: chunk.targetScenarioId,
          memberIds: chunk.memberIds,
          supportedMemberIds: chunk.supportedMemberIds,
          expectedPairKeys: chunk.expectedPairKeys,
          funded: chunk.funded,
        },
        {
          acceptTestFundLoss: state.config.acceptTestFundLoss,
          noRecord: state.config.noRecord,
        }
      );
      console.log(`\n[orchestrate] ${chunk.chunkId} attempt ${attemptNumber}: ${argv.join(' ')}`);
      const startedAt = nowIso();
      currentHandle = spawnChunkChild(argv, { cwd: APP_ROOT, logFile });
      const result = await currentHandle.done;
      currentHandle = undefined;

      const classification = classifyRunDir(ARTIFACTS, result.runDirName, {
        interrupted: result.interrupted,
      });
      chunk.attempts.push({
        attempt: attemptNumber,
        startedAt,
        endedAt: nowIso(),
        runId: result.runDirName,
        exitCode: result.exitCode,
        outcome: classification.outcome,
        failure: classification.failure,
        artifacts: classification.artifacts,
      });

      if (classification.outcome === 'interrupted' || shuttingDown) {
        chunk.status = 'pending';
        state.status = 'interrupted';
        saveState(campaignDir, state, nowIso());
        writeSummary(campaignDir, state);
        console.error(
          `[orchestrate] interrupted — resume with: bun e2e/orchestrate.ts run --resume ${campaignId} --i-approve-destructive-reset${state.config.acceptTestFundLoss ? ' --i-accept-test-fund-loss' : ''}`
        );
        process.exit(130);
      }

      if (classification.outcome === 'passed') {
        chunk.status = attemptNumber > 1 ? 'flaky-pass' : 'passed';
      } else if (classification.outcome === 'funded-quarantined') {
        chunk.status = 'funded-blocked';
        chunk.skipReason = 'funds quarantined — run `bun e2e/cli.ts funds-status`';
        fundedHalted = true;
      } else {
        const scenarioFails = chunk.attempts.filter(
          (attempt) => attempt.outcome === 'scenario-failed'
        ).length;
        const infraFails = chunk.attempts.filter(
          (attempt) => attempt.outcome === 'infra-aborted' || attempt.outcome === 'preflight-failed'
        ).length;
        if (scenarioFails >= state.config.retries.scenarioFail) {
          chunk.status = 'consistent-fail';
        } else if (infraFails >= (state.config.retries.infraAbort[chunk.platform] ?? 3)) {
          chunk.status = scenarioFails > 0 ? 'consistent-fail' : 'infra-exhausted';
        } else {
          saveState(campaignDir, state, nowIso());
          writeSummary(campaignDir, state);
          continue; // retry on a factory-fresh ephemeral device
        }
      }
      saveState(campaignDir, state, nowIso());
      writeSummary(campaignDir, state);
      break;
    }
  }

  await finalize(state, campaignDir);
  const failed = state.chunks.filter((chunk) =>
    ['consistent-fail', 'infra-exhausted', 'funded-blocked'].includes(chunk.status)
  );
  console.log(
    `\n[orchestrate] ${state.status} — ${failed.length} problem chunk(s); see ${join(campaignDir, 'SUMMARY.md')}`
  );
  process.exitCode = failed.length === 0 && state.status === 'complete' ? 0 : 1;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'plan') {
    printPlan(requirePlan(options), options);
    return;
  }
  if (options.command === 'status') {
    const campaignId = resolveCampaignDirName(options.dir ?? 'latest');
    const loaded = loadState(join(ARTIFACTS, campaignId));
    if (loaded.isErr()) fail(loaded.error);
    const summaryPath = join(ARTIFACTS, campaignId, 'SUMMARY.md');
    console.log(
      existsSync(summaryPath) ? await Bun.file(summaryPath).text() : '(no SUMMARY.md yet)'
    );
    return;
  }
  await commandRun(options);
}

await main();
