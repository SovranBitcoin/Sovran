#!/usr/bin/env bun
/* eslint-disable no-console -- this file is the human-facing CLI boundary */
/** Strict JSON-native E2E entrypoint. Suite manifests own selection and order;
 * filters may narrow a suite but can never silently broaden it or select zero. */
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { EventBus, type FundsState, type RunProof } from './core/events';
import { captureGitInfo } from './core/git';
import { loadE2E } from './core/loader';
import { expandScenario, formatDryRunPlan } from './core/plan';
import {
  assertDriverLaneCompatibility,
  assertFundedSelectionAuthorized,
  formatScenarioListLine,
  parseCliArgs,
  selectSuiteScenarios,
} from './core/selection';
import { runScenario, type RunDeps } from './core/run';
import { PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY } from './schema';
import { FakeCommandRunner, FakeDriver } from './drivers/driver';
import { FileArtifactSink, RealCommandRunner, SecureAppendSink } from './drivers/real';
import {
  SimulatorRunInterrupted,
  withEphemeralSimulatorSession,
} from './drivers/simulator-session';
import { SimulatorDriver } from './drivers/simulator';
import { createSimVideoRecorder } from './drivers/video';
import { generateControlledP2PKKeypair } from './funded';
import { withBoundedCashuRequests } from './funded-runtime/cashu-request-boundary';
import {
  connectUnlockedCurrentCocod,
  CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT,
  type LiveCocodBoundary,
} from './funded-runtime/cocod-live';
import {
  auditLegacyFundedArtifacts,
  describeRequiredLegacyDeferrals,
  recoverLegacyFundedArtifacts,
} from './funded-runtime/legacy-recovery';
import { resolveLightningAddressInvoice } from './funded-runtime/lightning-address';
import {
  acquireFundedRunLock,
  clearStaleFundedRunLock,
  getFundedRunLockStatus,
  type FundedRunLock,
} from './funded-runtime/lock';
import { createFundedScenarioRuntime } from './funded-runtime/runtime';
import {
  auditFundedRecoverySessions,
  recoverStaleFundedSessions,
} from './funded-runtime/startup-recovery';
import { parseLedgerText, RunLedger } from './ledger/ledger';
import { auditStartupLiabilities } from './ledger/startup';
import { JsonlReporter, PlainReporter, StreamTerm, TtyReporter } from './reporting/reporters';

const E2E = dirname(new URL(import.meta.url).pathname);
const ARTIFACTS = join(E2E, 'artifacts');
const STDOUT = { write: (value: string) => process.stdout.write(value) };

const SIMULATOR_LANE_CAPS = new Set([
  'fresh-install',
  'mock.offline',
  PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY,
  'unit.sat',
]);
const LEGACY_RECOVERY_DEADLINE_MS = 45_000;
const LEGACY_RECOVERY_REQUEST_TIMEOUT_MS = 5_000;

function fail(message: string, code = 2): never {
  console.error(`✗ ${message}`);
  process.exit(code);
}

function fundsStatus(): never {
  const audit = auditStartupLiabilities(ARTIFACTS);
  const managed = auditFundedRecoverySessions(ARTIFACTS);
  const legacy = auditLegacyFundedArtifacts({ artifactsRoot: ARTIFACTS });
  const lock = getFundedRunLockStatus(ARTIFACTS);
  if (
    audit.status === 'clean' &&
    managed.status === 'clean' &&
    legacy.status === 'clean' &&
    lock.status === 'none'
  ) {
    console.log('[e2e] funds status: clean (0 blockers)');
    process.exit(0);
  }
  const byStatus = new Map<string, number>();
  for (const blocker of audit.blockers)
    byStatus.set(blocker.status, (byStatus.get(blocker.status) ?? 0) + 1);
  const knownRuns = new Set(
    audit.blockers.map((blocker) => blocker.runId).filter((id) => id !== 'unknown')
  ).size;
  const knownLegs = audit.blockers.filter((blocker) => blocker.legId !== 'unknown').length;
  console.log(
    `[e2e] funds status: BLOCKED (${audit.blockers.length} legacy/ledger blocker(s), ${knownRuns} known run(s), ${knownLegs} known leg(s))`
  );
  for (const [status, count] of [...byStatus].sort(([a], [b]) => a.localeCompare(b)))
    console.log(`  ${status}: ${count}`);
  if (managed.status !== 'clean') console.log(`  managed-funded: ${managed.status}`);
  if (legacy.status !== 'clean') {
    const custodians = legacy.deferredAssets.reduce((sum, asset) => sum + asset.custodyCount, 0);
    console.log(
      `  legacy-funded: ${legacy.status} (${legacy.deferredAssets.length} asset(s), ${custodians} deferred custodian(s), ${legacy.retainedCombinedCustodies} retained combined custodian(s))`
    );
  }
  if (lock.status !== 'none') console.log(`  funded-lock: ${lock.status}`);
  process.exit(2);
}

/** Operator loss acceptance for one stranded leg (RunLedger.writeOff). The
 * write-off only records the acceptance — the next funded preflight's stale
 * recovery reconciles the leg and releases the lock, keeping every fail-closed
 * check on that path intact. */
function fundsWriteOff(options: {
  runId: string;
  leg: string;
  amount: number;
  reason: string;
}): never {
  const runDir = join(ARTIFACTS, `run-${options.runId}`);
  if (!existsSync(runDir)) fail(`unknown run "${options.runId}" (no ${runDir})`);
  const sessions = readdirSync(runDir).filter(
    (name) =>
      name.startsWith('session-') &&
      existsSync(join(runDir, name, 'funded-liability', 'ledger.jsonl'))
  );
  if (sessions.length === 0) fail(`run "${options.runId}" has no funded liability ledger`);
  for (const session of sessions) {
    const liabilityDir = join(runDir, session, 'funded-liability');
    const entries = parseLedgerText(readFileSync(join(liabilityDir, 'ledger.jsonl'), 'utf8'));
    const intent = entries.find(
      (entry) => entry.kind === 'intent' && entry.legId === options.leg
    );
    if (!intent) continue;
    const ledger = new RunLedger(liabilityDir, entries[0]!.runId);
    const status = ledger.status().get(options.leg);
    if (status === 'reconciled' || status === 'cancelled') {
      fail(`leg "${options.leg}" is already terminal (${status})`);
    }
    const legEntries = entries.filter((entry) => entry.legId === options.leg);
    const funded = legEntries.find(
      (entry): entry is Extract<(typeof entries)[number], { kind: 'funded' }> =>
        entry.kind === 'funded'
    );
    if (!funded) fail(`leg "${options.leg}" was never funded — nothing to write off`);
    const accounted = legEntries.reduce(
      (sum, entry) =>
        entry.kind === 'outflow'
          ? sum + entry.amount + entry.fees
          : entry.kind === 'written-off'
            ? sum + entry.amount
            : sum,
      0
    );
    const residual = funded.amount - accounted;
    // Partial write-offs are legitimate: a prior recovery attempt may have
    // durably restored part of the principal into its own custody state, which
    // the ledger cannot see. Only over-writing-off is blocked; reconciliation
    // still enforces exact conservation against the recovery report.
    if (options.amount > residual) {
      fail(
        `--amount exceeds the unexplained residual for leg "${options.leg}": ${residual} (funded ${funded.amount}, accounted ${accounted})`
      );
    }
    ledger.writeOff(options.leg, { amount: options.amount, reason: options.reason });
    console.log(
      `[e2e] wrote off ${options.amount} for ${options.runId}/${session} leg "${options.leg}"; the next funded preflight will reconcile the leg and release the lock`
    );
    process.exit(0);
  }
  fail(`leg "${options.leg}" not found in run "${options.runId}"`);
}

let options: ReturnType<typeof parseCliArgs>;
try {
  options = parseCliArgs(process.argv.slice(2));
} catch (error) {
  fail((error as Error).message);
}

if (options.command === 'funds-status') fundsStatus();
if (options.command === 'funds-write-off') {
  fundsWriteOff({
    runId: options.runId!,
    leg: options.leg!,
    amount: options.amount!,
    reason: options.reason!,
  });
}

const loaded = loadE2E(E2E);
if (options.command === 'validate') {
  for (const { file, issue } of loaded.issues)
    console.log(`  ✗ ${file} — ${issue.path}: ${issue.message}`);
  console.log(
    loaded.issues.length
      ? `\n✗ ${loaded.issues.length} issue(s)`
      : '✓ all e2e JSON valid + compact + suite-complete'
  );
  process.exit(loaded.issues.length ? 1 : 0);
}
if (loaded.issues.length)
  fail(`${loaded.issues.length} validation issue(s) — run \`bun e2e/cli.ts validate\``, 1);

let selection: ReturnType<typeof selectSuiteScenarios>;
try {
  selection = selectSuiteScenarios(loaded.suites, loaded.scenarios, options);
} catch (error) {
  fail((error as Error).message);
}
const { suite, scenarios, sessionGroups } = selection;
const caps = new Set(options.caps ?? SIMULATOR_LANE_CAPS);
const selectedFunded = scenarios.some((scenario) => scenario.lane === 'funded');

if (options.command === 'list') {
  console.log(`[e2e] suite ${suite.name}: ${scenarios.length} scenario(s)`);
  for (const scenario of scenarios) console.log(formatScenarioListLine(scenario, loaded.fixtures));
  process.exit(0);
}

if (options.command === 'dry-run') {
  let deferred = 0;
  for (const scenario of scenarios) {
    const plan = expandScenario(scenario, loaded.fixtures, { capabilities: caps });
    console.log(`\n${formatDryRunPlan(plan)}`);
    if (plan.availability === 'deferred') deferred++;
  }
  console.log(
    `\n[e2e] dry-run: suite ${suite.name}, ${scenarios.length} scenario(s), ${deferred} plan-deferred; no product execution performed`
  );
  process.exit(0);
}

if (options.command !== 'run') fail(`unsupported command "${options.command}"`);

const git = captureGitInfo(E2E);
if (options.requireCleanGit) {
  if (!git) fail('--require-clean-git: git state unavailable (not a repo, or git missing)');
  if (git.dirty) fail('--require-clean-git: working tree is dirty — commit or stash first');
}

if (options.driver === 'sim') {
  // Simulator destruction and fund-loss acceptance are independent approvals.
  // Both gates run before artifacts, Metro, cocod effects, or device creation.
  try {
    assertFundedSelectionAuthorized(scenarios, options.acceptTestFundLoss);
    assertDriverLaneCompatibility(options.driver, scenarios);
  } catch (error) {
    fail((error as Error).message);
  }
  if (!options.approveDestructiveReset) {
    fail('ephemeral simulator creation/deletion requires --i-approve-destructive-reset');
  }
}

const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
let liveCocod: LiveCocodBoundary | undefined;
let fundedRunLock: FundedRunLock | undefined;
if (
  options.driver === 'sim' &&
  selectedFunded &&
  scenarios.some((scenario) => scenario.lane === 'funded' && !scenario.deferredReason)
) {
  try {
    liveCocod = await connectUnlockedCurrentCocod({
      currentWalletAcknowledgement: CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT,
      env: {
        ...process.env,
        COCOD_BIN: process.env.COCOD_BIN ?? join(homedir(), '.bun', 'bin', 'cocod'),
      },
    });
    for (const capability of liveCocod.capabilities) caps.add(capability);
    const startupCocod = liveCocod.cocod;

    const lockStatus = getFundedRunLockStatus(ARTIFACTS);
    if (lockStatus.status === 'active') {
      throw new Error(`funded run ${lockStatus.runId} is already active`);
    }
    if (lockStatus.status === 'stale') {
      await recoverStaleFundedSessions({
        artifactsRoot: ARTIFACTS,
        cocod: liveCocod.cocod,
        staleOwnerIsDead: true,
        acceptedTestFundLoss: options.acceptTestFundLoss,
      });
      clearStaleFundedRunLock(ARTIFACTS, true);
    }
    fundedRunLock = acquireFundedRunLock(ARTIFACTS, runId);
    await recoverStaleFundedSessions({
      artifactsRoot: ARTIFACTS,
      cocod: liveCocod.cocod,
      acceptedTestFundLoss: options.acceptTestFundLoss,
    });

    const legacyMints = new Set<string>();
    for (const scenario of loaded.scenarios.values()) {
      for (const asset of scenario.funds?.assets ?? []) {
        if (asset.unit === 'sat' && asset.accountIndex === 0) legacyMints.add(asset.mintUrl);
      }
    }
    const allLegacyAssets = [...legacyMints].sort().map((mintUrl) => ({
      mintUrl,
      unit: 'sat' as const,
      accountIndex: 0 as const,
      maxPrincipal: 10_000,
    }));
    const requiredLegacyAssets = new Map<string, (typeof allLegacyAssets)[number]>();
    for (const scenario of scenarios) {
      if (scenario.lane !== 'funded' || scenario.deferredReason) continue;
      for (const asset of scenario.funds?.assets ?? []) {
        const declared = allLegacyAssets.find(
          (candidate) =>
            candidate.mintUrl === asset.mintUrl &&
            candidate.unit === asset.unit &&
            candidate.accountIndex === asset.accountIndex
        );
        if (declared) {
          requiredLegacyAssets.set(
            `${declared.mintUrl}\u0000${declared.unit}\u0000${declared.accountIndex}`,
            declared
          );
        }
      }
    }
    console.log(
      `[e2e] checking required legacy custody (Cashu recovery deadline ${LEGACY_RECOVERY_DEADLINE_MS / 1_000}s)`
    );
    const legacy = await withBoundedCashuRequests(
      {
        deadlineMs: LEGACY_RECOVERY_DEADLINE_MS,
        requestTimeoutMs: LEGACY_RECOVERY_REQUEST_TIMEOUT_MS,
      },
      () =>
        recoverLegacyFundedArtifacts({
          artifactsRoot: ARTIFACTS,
          cocod: startupCocod,
          assets: allLegacyAssets,
          requiredAssets: [...requiredLegacyAssets.values()],
        })
    );
    const legacyAudit = auditLegacyFundedArtifacts({
      artifactsRoot: ARTIFACTS,
      requiredAssets: [...requiredLegacyAssets.values()],
    });
    if (!legacyAudit.canRunRequiredAssets) {
      const deferred = describeRequiredLegacyDeferrals(legacyAudit, [
        ...requiredLegacyAssets.values(),
      ]);
      if (deferred) {
        throw new Error(
          `legacy recovery deferred for selected funded asset: ${deferred}; private custody retained, retry when the mint is reachable`
        );
      }
      throw new Error('selected funded assets still have unresolved legacy custody');
    }
    const startupAudit = auditStartupLiabilities(ARTIFACTS);
    if (startupAudit.status !== 'clean') {
      throw new Error(
        `${startupAudit.blockers.length} unresolved legacy or funded liabilities remain after recovery`
      );
    }
    const legacyStatus = legacy.summary
      ? `; ${legacy.summary.uniqueSeeds} legacy seed(s), ${legacy.summary.deferredAssets.length} deferred legacy asset(s)`
      : '';
    console.log(
      `[e2e] cocod ${liveCocod.metadata.version} UNLOCKED; startup recovery clean${legacyStatus}`
    );
  } catch (error) {
    if (fundedRunLock) {
      try {
        if (auditFundedRecoverySessions(ARTIFACTS).status === 'clean') {
          fundedRunLock.release();
        }
      } catch {
        // The ownership record is deliberately retained when safe release fails.
      }
      fundedRunLock = undefined;
    }
    fail(error instanceof Error ? error.message : 'cocod preflight failed');
  }
}

const hasRunnableProductScenario = scenarios.some(
  (scenario) =>
    expandScenario(scenario, loaded.fixtures, { capabilities: caps }).availability === 'ready'
);
const proof: RunProof =
  options.driver === 'sim' && hasRunnableProductScenario ? 'product-run' : 'orchestration-smoke';
const runDir = join(ARTIFACTS, `run-${runId}`);
const artifacts = new FileArtifactSink(runDir);
const transcript = new SecureAppendSink(join(runDir, 'events.jsonl'));
artifacts.write(
  'manifest.json',
  'log',
  JSON.stringify({
    version: 1,
    runId,
    suite: suite.name,
    driver: options.driver,
    proof,
    recording: options.driver === 'sim' && !options.noRecord,
    startedAt: new Date().toISOString(),
    scenarios: scenarios.map((scenario) => scenario.id),
    ...(git ? { git } : {}),
    filters: {
      scenario: options.scenario,
      tag: options.tag,
      lane: options.lane,
      shuffle: options.shuffle,
      seed: options.seed,
    },
    ...(liveCocod
      ? {
          funded: {
            acceptedTestFundLoss: true,
            cocod: liveCocod.metadata,
          },
        }
      : {}),
  })
);

const bus = new EventBus();
bus.subscribe(new JsonlReporter(transcript).on);
if (process.stdout.isTTY)
  bus.subscribe(
    new TtyReporter(new StreamTerm(STDOUT), { width: process.stdout.columns ?? 80 }).on
  );
else bus.subscribe(new PlainReporter(STDOUT).on);

function interruptionCode(error: unknown): number | undefined {
  if (error instanceof SimulatorRunInterrupted) return error.exitCode;
  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      const code = interruptionCode(nested);
      if (code !== undefined) return code;
    }
  }
  return undefined;
}

try {
  let passed = 0;
  let failed = 0;
  let deferred = 0;
  let artifactSeq = 0;
  let fundedFundsSafe = true;
  const started = Date.now();
  const scenarioIndexes = new Map(scenarios.map((scenario, index) => [scenario.id, index + 1]));
  bus.emit({
    type: 'run.begin',
    runId,
    proof,
    suite: suite.name,
    totalScenarios: scenarios.length,
  });
  bus.emit({ type: 'suite.begin', suite: suite.name });
  let stopAfterFailure = false;
  const recordStatus = (status: Awaited<ReturnType<typeof runScenario>>) => {
    if (status === 'passed') passed++;
    else if (status === 'failed') failed++;
    else deferred++;
  };
  for (const [groupIndex, group] of sessionGroups.entries()) {
    if (stopAfterFailure) break;
    const groupPlans = group.map(({ scenario }) =>
      expandScenario(scenario, loaded.fixtures, { capabilities: caps })
    );
    const statuses: Awaited<ReturnType<typeof runScenario>>[] = [];
    const runGroup = async (
      deps: Omit<RunDeps, 'scenarioIndex' | 'totalScenarios' | 'nextArtifactSeq'>
    ) => {
      for (const [memberIndex, { ref, scenario }] of group.entries()) {
        const predecessor = statuses.at(-1);
        if (memberIndex > 0 && !ref.newInstance && predecessor !== 'passed') break;
        const status = await runScenario(scenario, loaded.fixtures, {
          ...deps,
          scenarioIndex: scenarioIndexes.get(scenario.id)!,
          totalScenarios: scenarios.length,
          nextArtifactSeq: () => ++artifactSeq,
        });
        statuses.push(status);
        if (status === 'failed') break;
      }
    };

    if (options.driver === 'fake' || groupPlans.every((plan) => plan.availability === 'deferred')) {
      await runGroup({
        driver: new FakeDriver({ permissive: true, currentState: 'wallet' }),
        runner: new FakeCommandRunner(),
        bus,
        artifacts,
        capabilities: caps,
      });
    } else {
      const sessionIndex = groupIndex + 1;
      const sessionId = `${runId}-${String(sessionIndex).padStart(2, '0')}`;
      const sessionDir = join(runDir, `session-${sessionIndex}`);
      const groupScenarios = group.map(({ scenario }) => scenario);
      const scenario = groupScenarios[0]!;
      const funded = scenario.lane === 'funded';
      if (funded && groupScenarios.length !== 1) {
        throw new Error('funded scenarios must own a fresh simulator session');
      }
      const controlledP2PK =
        funded && scenario.tags.includes('p2pk') ? generateControlledP2PKKeypair() : undefined;
      const mockFailPaymentRequest =
        funded &&
        groupPlans[0]?.requires.includes(PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY) === true;
      let runtime: ReturnType<typeof createFundedScenarioRuntime> | undefined;
      let pendingMnemonic: string | undefined;
      await withEphemeralSimulatorSession(
        {
          runId: sessionId,
          runDir: sessionDir,
          onLifecycle: (message) => bus.emit({ type: 'lifecycle', message }),
          ...(funded
            ? {
                ...(controlledP2PK ? { controlledP2PKPubkey: controlledP2PK.publicKey } : {}),
                ...(mockFailPaymentRequest ? { mockFailPaymentRequest: true } : {}),
                fundedAssets: scenario.funds!.assets.map(({ mintUrl, unit }) => ({
                  mintUrl,
                  unit,
                })),
                onSeedExport: (mnemonic: string) => {
                  if (runtime) runtime.captureMnemonic(mnemonic);
                  else pendingMnemonic = mnemonic;
                },
              }
            : {}),
        },
        async (session, signal) => {
          artifacts.write(
            `session-${sessionIndex}.json`,
            'log',
            JSON.stringify({
              version: 1,
              ephemeral: true,
              seedExport: funded,
              scenarios: groupScenarios.map(({ id }) => id),
              simulator: {
                udid: session.udid,
                name: session.name,
                runtime: session.runtimeName,
                runtimeVersion: session.runtimeVersion,
                deviceType: session.deviceTypeName,
              },
              metro: { url: session.metroUrl, port: session.metroPort, pid: session.metroPid },
              simulatorBridge: {
                port: session.serveSimPort,
                pid: session.serveSimPid,
                logPath: session.serveSimLogPath,
                videoCapture: false,
              },
            })
          );
          const simulator = new SimulatorDriver(
            {
              udid: session.udid,
              axEndpoint: session.axEndpoint,
              touchEndpoint: session.touchEndpoint,
              signal,
            },
            {
              install: session.install,
              reportInfrastructureFailure: session.reportInfrastructureFailure,
            }
          );
          if (funded) {
            if (!liveCocod || !scenario.funds) {
              throw new Error('funded simulator session lacks its approved runtime boundary');
            }
            runtime = createFundedScenarioRuntime({
              runDir: sessionDir,
              runId: sessionId,
              assets: scenario.funds.assets,
              cocod: liveCocod.cocod,
              ...(controlledP2PK ? { p2pkPrivateKey: controlledP2PK.privateKey } : {}),
              resolveLightningAddress: ({ address, amountSats, timeoutMs }) =>
                resolveLightningAddressInvoice(address, amountSats, undefined, timeoutMs),
              refreshApp: async () => {
                if (signal.aborted) return;
                await simulator.homeAfterFundedSweep(
                  scenario.funds!.assets.map(({ mintUrl, unit }) => ({ mintUrl, unit }))
                );
              },
            });
            if (pendingMnemonic) {
              runtime.captureMnemonic(pendingMnemonic);
              pendingMnemonic = undefined;
            }
          }
          const video = options.noRecord
            ? undefined
            : createSimVideoRecorder({
                udid: session.udid,
                runDir,
                onWarning: (message) => bus.emit({ type: 'lifecycle', message }),
              });
          simulator.start();
          try {
            await runGroup({
              driver: simulator,
              runner: new RealCommandRunner(),
              bus,
              artifacts,
              capabilities: caps,
              signal,
              ...(video ? { video } : {}),
              ...(runtime ? { counterparty: runtime, reconcile: () => runtime!.reconcile() } : {}),
            });
          } finally {
            await video?.dispose();
            await simulator.dispose();
          }
        }
      );
      if (funded && !runtime?.fundsReconciled) fundedFundsSafe = false;
    }

    statuses.forEach(recordStatus);
    if (statuses.includes('failed') || statuses.length < group.length) stopAfterFailure = true;
  }
  const durationMs = Date.now() - started;
  bus.emit({ type: 'suite.end', suite: suite.name, durationMs });
  bus.emit({
    type: 'run.end',
    runId,
    passed,
    failed,
    skipped: scenarios.length - passed - failed - deferred,
    deferred,
    durationMs,
    funds: (liveCocod
      ? fundedFundsSafe
        ? 'reconciled'
        : 'quarantined'
      : 'n/a') satisfies FundsState,
    proof,
  });
  if (options.driver === 'fake')
    console.log('\n[e2e] fake driver: orchestration smoke only, never product proof');
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  const code = interruptionCode(error) ?? 1;
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = code;
} finally {
  transcript.close();
  if (fundedRunLock) {
    try {
      const managed = auditFundedRecoverySessions(ARTIFACTS);
      const all = auditStartupLiabilities(ARTIFACTS);
      if (managed.status === 'clean' && all.status === 'clean') {
        fundedRunLock.release();
      } else {
        console.error('⚠ funded liabilities remain; global lock retained for startup recovery');
        process.exitCode = process.exitCode || 1;
      }
    } catch {
      console.error('⚠ funded lock release failed closed');
      process.exitCode = process.exitCode || 1;
    }
  }
}
