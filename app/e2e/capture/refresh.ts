/* eslint-disable no-console -- native capture CLI */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { appSourceStamp } from '../../../scripts/lib/app-source.mjs';
import { captureSourceFingerprint } from '../core/git';
import {
  buildSummary,
  ensureNativeBuild,
  nativeEnv,
  nativeFingerprint,
  nativeArtifactHash,
  type NativeBuildStamp,
  type RebuildPolicy,
} from '../press/native-build';
import { createPressPlan, nativeArgs } from '../press/plan';
import { importPressRuns } from '../press/import';
import { promoteCandidates } from '../press/promote';
import { checkStorage } from '../press/run';
import { createCapturePlan, ROOT, type CapturePlan, type Platform } from './plan';
import { importCaptureRun, type CaptureAttestation } from './import';

type Invocation = CapturePlan['invocations'][number];
type Session = {
  platform: Platform;
  scenario: string;
  recipeSha256: string;
  status: 'notattempted' | 'running' | 'captured' | 'failed' | 'skipped';
  attempts: number;
  runs: string[];
  reason?: string;
  lastAttemptAt?: string;
  appFingerprint?: string;
  nativeFingerprint?: string;
  artifactSha256?: string;
  captures?: { file: string; sha256: string }[];
};
const ARTIFACTS = join(ROOT, 'app/e2e/artifacts');
const LIBRARY = join(ROOT, 'press/screenshots');
const CHECKPOINT = join(ARTIFACTS, 'screenshot-refresh.json');
/** A focused retry keeps its own checkpoint. The campaign's resume state
 * describes all 54 legs; a one-scenario run must not overwrite it with a
 * one-session report and make every other verified leg look unattempted. */
const checkpointFor = (scenario: string | undefined) =>
  scenario
    ? join(ARTIFACTS, `screenshot-refresh.${scenario.replace(/[^a-z0-9.-]/gi, '-')}.json`)
    : CHECKPOINT;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const atomicJson = (file: string, value: unknown) => {
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
};

export function parseRefreshArgs(args: string[]) {
  const options = {
    platforms: ['ios', 'android'] as Platform[],
    scenario: undefined as string | undefined,
    attempts: 2,
    rebuild: 'auto' as RebuildPolicy,
    downstream: true,
    planOnly: false,
    resume: false,
    renderOnly: false,
    skip: [] as string[],
  };
  const rest = [...args];
  while (rest.length) {
    const arg = rest.shift()!;
    const value = () => {
      const next = rest.shift();
      if (!next || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === 'ios' || arg === 'android') options.platforms = [arg];
    else if (arg === 'both') options.platforms = ['ios', 'android'];
    else if (arg === '--scenario') options.scenario = value();
    else if (arg === '--attempts') {
      options.attempts = Number(value());
      if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 5)
        throw new Error('--attempts must be 1-5');
    } else if (arg === '--rebuild') {
      const policy = value();
      if (policy !== 'auto' && policy !== 'force' && policy !== 'never')
        throw new Error('--rebuild must be auto, force or never');
      options.rebuild = policy;
    } else if (arg === '--no-downstream') options.downstream = false;
    else if (arg === '--plan') options.planOnly = true;
    else if (arg === '--resume') options.resume = true;
    else if (arg === '--render-only') options.renderOnly = true;
    else if (arg === '--skip') {
      // `platform/scenario`, or a bare scenario for both platforms. A skipped
      // leg is recorded as skipped with its reason, never as captured or
      // missing-without-explanation: the gap has to stay visible.
      const target = value();
      if (!/^(?:(?:ios|android)\/)?[a-z][a-z0-9.-]*$/.test(target))
        throw new Error('--skip takes platform/scenario or scenario');
      options.skip.push(target);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.renderOnly && (options.scenario || options.resume || options.planOnly))
    throw new Error('--render-only cannot select or resume captures');
  if (options.skip.length && options.renderOnly)
    throw new Error('--render-only captures nothing to skip');
  return options;
}

function describeRunFailure(runDir: string | undefined, exit: string) {
  if (!runDir) return `Process exited ${exit} before creating an attributed run`;
  try {
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const failed = events.findLast((event) => event.type === 'step.end' && event.ok === false);
    // Step labels can contain data. Only report the authored step ID, not its payload.
    if (failed) return `Step ${failed.stepId} failed; inspect the local run evidence`;
    return events.some((event) => event.type === 'run.end')
      ? `Process exited ${exit}`
      : 'Run interrupted before completion';
  } catch {
    return `Process exited ${exit}; no readable step evidence`;
  }
}

export function resumable(
  session: Session,
  invocation: Invocation,
  {
    appFingerprint,
    nativeFingerprint,
    library = LIBRARY,
  }: { appFingerprint: string; nativeFingerprint: string; library?: string }
) {
  return (
    session.status === 'captured' &&
    session.recipeSha256 === invocation.recipeSha256 &&
    session.appFingerprint === appFingerprint &&
    session.nativeFingerprint === nativeFingerprint &&
    Boolean(session.captures?.length) &&
    session.captures!.every((capture) => {
      if (!/^(ios|android)\/[a-z][a-z0-9-]*\.png$/.test(capture.file)) return false;
      try {
        return hash(readFileSync(join(library, capture.file))) === capture.sha256;
      } catch {
        return false;
      }
    })
  );
}

let child: ReturnType<typeof spawn> | undefined;
let interrupted = false;
/** A campaign must not wedge on one stuck call. Twice now a leg has printed its
 * attempt header and then produced nothing for the rest of the night with no
 * child process alive, so every step that can block gets a deadline and fails
 * its attempt instead of the run. Mirrors the existing nativeFingerprint
 * deadline in press/native-build.ts. */
export async function withDeadline<T>(label: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${Math.round(ms / 1000)}s`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function execute(command: string, args: string[], env = process.env) {
  return new Promise<string>((resolve, reject) => {
    child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', env });
    child.once('error', (error) => {
      child = undefined;
      reject(error);
    });
    child.once('exit', (code, signal) => {
      child = undefined;
      resolve(String(signal ?? code));
    });
  });
}

function attributedRun(id: string) {
  const found = readdirSync(ARTIFACTS)
    .filter((name) => name.startsWith('run-'))
    .filter((name) => {
      try {
        return (
          JSON.parse(readFileSync(join(ARTIFACTS, name, 'manifest.json'), 'utf8'))
            .captureCampaignId === id
        );
      } catch {
        return false;
      }
    });
  if (found.length > 1) throw new Error('Ambiguous capture campaign identity');
  return found[0] ? join(ARTIFACTS, found[0]) : undefined;
}

async function refresh(args: string[]) {
  const options = parseRefreshArgs(args);
  const plan = createCapturePlan(options.platforms);
  const invocations = plan.invocations.filter(
    (item) => !options.scenario || item.scenario === options.scenario
  );
  const scenarioOrder = [...new Set(invocations.map((item) => item.scenario))];
  invocations.sort(
    (a, b) =>
      scenarioOrder.indexOf(a.scenario) - scenarioOrder.indexOf(b.scenario) ||
      options.platforms.indexOf(a.platform) - options.platforms.indexOf(b.platform)
  );
  if (options.scenario && !invocations.length)
    throw new Error(`No approved capture recipe: ${options.scenario}`);
  if (options.planOnly) {
    console.log(
      JSON.stringify(
        {
          baselineDenominator: plan.baselineDenominator,
          captureProfile: plan.captureProfile,
          sessions: invocations.map(({ platform, suite, scenario, recipeSha256 }) => ({
            platform,
            suite,
            scenario,
            recipeSha256,
          })),
          targets: plan.targets,
          blocked: plan.blocked,
        },
        null,
        2
      )
    );
    return 0;
  }
  mkdirSync(ARTIFACTS, { recursive: true });
  const lock = join(ARTIFACTS, 'screenshot-refresh.lock');
  let fd: number;
  try {
    fd = openSync(lock, 'wx');
  } catch {
    throw new Error(
      `A capture campaign owns ${lock}. Inspect its PID before removing a stale lock.`
    );
  }
  writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  closeSync(fd);
  const stop = () => {
    interrupted = true;
    child?.kill('SIGINT');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const startedAt = new Date().toISOString();
  let prior: { sessions: Session[] } | undefined;
  const sessions: Session[] = [];
  const downstream: { step: string; ok: boolean }[] = [];
  let previousTargets: {
    platform: string;
    page: string;
    state: string;
    scenario: string | null;
    status: string;
    latestAttempt?: unknown;
  }[] = [];
  let fatal: string | undefined;
  const report = () => ({
    version: 1,
    pid: process.pid,
    startedAt,
    updatedAt: new Date().toISOString(),
    interrupted,
    fatal,
    baselineDenominator: plan.baselineDenominator,
    sessions,
    blocked: plan.blocked,
    downstream,
  });
  const checkpoint = checkpointFor(options.scenario);
  const save = () => {
    if (options.renderOnly) return;
    atomicJson(checkpoint, report());
    // Always retain both platform denominators, even during focused retries.
    const inventory = createCapturePlan().targets.map((target) => {
      const session = sessions.find(
        (s) => s.platform === target.platform && s.scenario === target.scenario
      );
      const previous = previousTargets.find(
        (t) =>
          t.platform === target.platform &&
          t.page === target.page &&
          t.state === target.state &&
          t.scenario === target.scenario
      );
      return {
        ...target,
        status:
          target.status === 'blocked'
            ? 'blocked'
            : (session?.status ?? previous?.status ?? 'notattempted'),
        latestAttempt: session
          ? {
              at: session.lastAttemptAt,
              status: session.status,
              attempts: session.attempts,
              reason: session.reason,
              runs: session.runs,
            }
          : previous?.latestAttempt,
      };
    });
    atomicJson(join(LIBRARY, 'inventory.json'), {
      version: 1,
      targets: inventory,
      campaign: { startedAt, interrupted, fatal },
    });
  };
  try {
    const inventoryPath = join(LIBRARY, 'inventory.json');
    if (existsSync(inventoryPath)) {
      previousTargets = JSON.parse(readFileSync(inventoryPath, 'utf8')).targets;
      if (!Array.isArray(previousTargets)) throw new Error('Invalid capture inventory');
    }
    if (options.resume) {
      if (!existsSync(checkpoint)) throw new Error('No checkpoint exists to resume');
      prior = JSON.parse(readFileSync(checkpoint, 'utf8'));
      if (!Array.isArray(prior?.sessions)) throw new Error('Invalid refresh checkpoint');
    }
    if (!options.renderOnly) {
      mkdirSync(LIBRARY, { recursive: true });
      const skipped = (invocation: Invocation) =>
        options.skip.find(
          (target) =>
            target === invocation.scenario ||
            target === `${invocation.platform}/${invocation.scenario}`
        );
      for (const invocation of invocations) {
        const skip = skipped(invocation);
        sessions.push({
          platform: invocation.platform,
          scenario: invocation.scenario,
          recipeSha256: invocation.recipeSha256,
          status: skip ? 'skipped' : 'notattempted',
          ...(skip ? { reason: `Skipped by operator: --skip ${skip}` } : {}),
          attempts: 0,
          runs: [],
        });
      }
      save();
      const press = createPressPlan(options.platforms);
      const acceptRun = async (
        run: string,
        invocation: Invocation,
        attestation: CaptureAttestation,
        stamp: NativeBuildStamp
      ) => {
        const imported = await importCaptureRun(run, { plan, attestation });
        if (
          press.captures.some(
            (c) => c.platform === invocation.platform && c.scenario === invocation.scenario
          )
        ) {
          const retained = join(run, 'press');
          const candidates = existsSync(join(retained, 'manifest.json'))
            ? [retained]
            : await importPressRuns([run], press);
          promoteCandidates(candidates, {
            builds: { [invocation.platform]: buildSummary(stamp) },
            appSource: attestation.appSourceBefore,
          });
        }
        return imported.imported.map(({ file, sha256 }) => ({ file, sha256 }));
      };
      const builds = new Map<Platform, NativeBuildStamp>();
      const failedBuilds = new Set<Platform>();
      for (const invocation of invocations) {
        if (interrupted) break;
        if (skipped(invocation)) {
          console.log(`Skip ${invocation.platform} ${invocation.scenario}`);
          continue;
        }
        const platform = invocation.platform;
        if (failedBuilds.has(platform)) continue;
        let stamp = builds.get(platform);
        if (!stamp) {
          try {
            console.log(`Preparing ${platform} native build`);
            checkStorage();
            stamp = await ensureNativeBuild(platform, options.rebuild);
            builds.set(platform, stamp);
          } catch (error) {
            const reason = `Native build failed: ${error instanceof Error ? error.message : 'unknown error'}`;
            failedBuilds.add(platform);
            for (const session of sessions.filter((item) => item.platform === platform))
              Object.assign(session, { status: 'failed', reason });
            save();
            continue;
          }
        }
        if (interrupted) break;
        const session = sessions.find(
          (s) => s.platform === platform && s.scenario === invocation.scenario
        )!;
        const appSource = appSourceStamp(ROOT);
        if (!appSource) throw new Error('App-source fingerprint unavailable');
        const previous = prior?.sessions.find(
          (s) => s.platform === platform && s.scenario === invocation.scenario
        );
        if (
          previous &&
          previous.artifactSha256 === stamp.artifactSha256 &&
          resumable(previous, invocation, {
            appFingerprint: appSource.fingerprint,
            nativeFingerprint: stamp.fingerprint,
          })
        ) {
          Object.assign(session, previous);
          console.log(`Reuse ${platform} ${invocation.scenario}`);
          save();
          continue;
        }
        const previousRun = previous?.runs.at(-1);
        if (previousRun && /^run-[A-Za-z0-9-]+$/.test(previousRun)) {
          const run = join(ARTIFACTS, previousRun);
          const receiptFile = join(run, 'capture-attestation.json');
          if (existsSync(receiptFile)) {
            try {
              const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
              const proof: CaptureAttestation = receipt.attestation;
              if (
                receipt.recipeSha256 !== invocation.recipeSha256 ||
                proof.appSourceAfter.fingerprint !== appSource.fingerprint ||
                proof.nativeBuild.artifactSha256 !== stamp.artifactSha256
              )
                throw new Error('Recorded capture inputs changed');
              const captures = await acceptRun(run, invocation, proof, stamp);
              Object.assign(session, previous, {
                status: 'captured',
                reason: undefined,
                captures,
                appFingerprint: appSource.fingerprint,
                nativeFingerprint: stamp.fingerprint,
                artifactSha256: stamp.artifactSha256,
              });
              console.log(`Imported completed evidence ${previousRun} without recapturing`);
              save();
              continue;
            } catch (error) {
              console.log(
                `Completed evidence needs recapture: ${error instanceof Error ? error.message : 'invalid attestation'}`
              );
            }
          }
        }
        for (let attempt = 1; attempt <= options.attempts && !interrupted; attempt++) {
          checkStorage();
          session.status = 'running';
          session.attempts = attempt;
          session.lastAttemptAt = new Date().toISOString();
          save();
          const id = `capture-${randomUUID()}`;
          const before = appSourceStamp(ROOT);
          const nativeBefore = await nativeFingerprint(platform);
          const sourceFingerprint = captureSourceFingerprint(join(ROOT, 'app/e2e'));
          if (!sourceFingerprint || !before) throw new Error('Capture source unavailable');
          console.log(
            `\nCapture ${platform} ${invocation.scenario}, attempt ${attempt}/${options.attempts}`
          );
          try {
            if (
              !stamp.artifactSha256 ||
              nativeArtifactHash(stamp.artifact) !== stamp.artifactSha256
            )
              throw new Error('Native artifact changed before capture');
            const exit = await withDeadline(
              'Native capture run',
              45 * 60_000,
              execute(process.execPath, nativeArgs(invocation), {
                ...process.env,
                ...nativeEnv(stamp),
                E2E_CAPTURE_PROFILE: 'library-v1',
                E2E_CAPTURE_CAMPAIGN_ID: id,
              })
            ).catch((error: unknown) => {
              child?.kill('SIGINT');
              throw error;
            });
            const run = attributedRun(id);
            if (run) session.runs.push(run.split('/').at(-1)!);
            if (exit !== '0' || !run || interrupted) throw new Error(describeRunFailure(run, exit));
            if (nativeArtifactHash(stamp.artifact) !== stamp.artifactSha256)
              throw new Error('Native artifact changed during capture');
            const after = appSourceStamp(ROOT);
            if (!after) throw new Error('App source unavailable after capture');
            const attestation: CaptureAttestation = {
              sourceFingerprint,
              appSourceBefore: before,
              appSourceAfter: after,
              nativeBuild: { ...buildSummary(stamp), artifactSha256: stamp.artifactSha256 },
              nativeFingerprintBefore: nativeBefore,
              nativeFingerprintAfter: await nativeFingerprint(platform),
            };
            atomicJson(join(run, 'capture-attestation.json'), {
              version: 1,
              recipeSha256: invocation.recipeSha256,
              attestation,
            });
            const captures = await acceptRun(run, invocation, attestation, stamp);
            session.status = 'captured';
            Object.assign(session, {
              reason: undefined,
              appFingerprint: before.fingerprint,
              nativeFingerprint: stamp.fingerprint,
              artifactSha256: stamp.artifactSha256,
              captures,
            });
            console.log(`Captured ${captures.length} views`);
          } catch (error) {
            session.status = 'failed';
            session.reason = error instanceof Error ? error.message : 'Capture failed';
            console.error(`${platform} ${invocation.scenario}: ${session.reason}`);
          }
          save();
          if (session.status === 'captured') break;
        }
      }
    }
    if (options.downstream && !interrupted) {
      for (const [step, command, commandArgs] of [
        ['logos', 'node', ['scripts/brand-assets.mjs']],
        ['website assets', 'node', ['site/scripts/website-assets.mjs']],
        ['site build', 'bun', ['run', 'site:build']],
      ] as const) {
        const exit = await execute(command, [...commandArgs]);
        downstream.push({ step, ok: exit === '0' });
        save();
        if (interrupted) break;
      }
    }
  } catch (error) {
    fatal = error instanceof Error ? error.message : 'Refresh failed';
    console.error(fatal);
  } finally {
    for (const session of sessions)
      if (session.status === 'running') {
        session.status = 'failed';
        session.reason = 'Interrupted during capture';
      }
    try {
      save();
      atomicJson(
        join(ARTIFACTS, `screenshot-refresh-${startedAt.replace(/[:.]/g, '-')}.json`),
        report()
      );
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      unlinkSync(lock);
    }
  }
  console.log(
    JSON.stringify(
      {
        capturedSessions: sessions.filter((s) => s.status === 'captured').length,
        sessions: sessions.length,
        blockedBaseline: plan.blocked.filter((t) => t.baseline).length,
        baselineDenominator: plan.baselineDenominator,
        report: checkpoint,
        downstream,
        fatal,
        interrupted,
      },
      null,
      2
    )
  );
  return fatal ||
    interrupted ||
    sessions.some((s) => s.status !== 'captured') ||
    downstream.some((s) => !s.ok) ||
    (!options.scenario && !options.renderOnly && plan.blocked.length)
    ? 1
    : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await refresh(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Refresh failed');
    process.exitCode = 1;
  }
}
