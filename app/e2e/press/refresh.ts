/* eslint-disable no-console -- press CLI boundary */
/**
 * One command for every screenshot on /screenshots:
 *
 *   bun run screenshots:refresh [ios|android|both] [--scenario ID]
 *     [--attempts N] [--rebuild auto|force|never] [--no-downstream] [--plan]
 *
 * Per platform: resolve a native build matching current source (building it
 * locally when needed), run every press capture session with retries, import
 * and promote each passing session immediately, and record why anything was
 * not recaptured. Then regenerate artwork, mockups, variants and the site.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importPressRuns } from './import';
import {
  buildSummary,
  ensureNativeBuild,
  nativeEnv,
  nativeFingerprint,
  readStamp,
  type NativeBuildStamp,
  type RebuildPolicy,
} from './native-build';
import {
  createPressPlan,
  nativeArgs,
  ROOT,
  selectPressScenario,
  type Platform,
  type PressPlan,
} from './plan';
import { appSourceStamp } from '../../../scripts/lib/app-source.mjs';
import { promoteCandidates, recordRefreshFailures } from './promote';
import { checkStorage } from './run';

type Invocation = PressPlan['invocations'][number];
type SessionResult =
  | { status: 'captured'; invocation: Invocation; run: string; keys: string[]; attempts: number }
  | {
      status: 'failed';
      invocation: Invocation;
      runs: string[];
      keys: string[];
      reason: string;
      attempts: number;
      /** A machine condition (low disk) that stops the whole refresh. */
      halt?: boolean;
    };

const ARTIFACTS = join(ROOT, 'app/e2e/artifacts');

export function parseRefreshArgs(args: string[]) {
  const options = {
    platforms: ['ios', 'android'] as Platform[],
    scenario: undefined as string | undefined,
    attempts: 2,
    rebuild: 'auto' as RebuildPolicy,
    downstream: true,
    planOnly: false,
  };
  const usage =
    'Usage: bun run screenshots:refresh [ios|android|both] [--scenario ID] [--attempts N] [--rebuild auto|force|never] [--no-downstream] [--plan]';
  const rest = [...args];
  while (rest.length) {
    const arg = rest.shift()!;
    const value = () => {
      const next = rest.shift();
      if (!next || next.startsWith('--')) throw new Error(`${arg} needs a value. ${usage}`);
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
      if (policy !== 'auto' && policy !== 'force' && policy !== 'never') throw new Error(usage);
      options.rebuild = policy;
    } else if (arg === '--no-downstream') options.downstream = false;
    else if (arg === '--plan') options.planOnly = true;
    else throw new Error(usage);
  }
  return options;
}

/**
 * One session per scenario. A suite session only imports when every scenario
 * passes, so one flaky scenario used to discard the others' captures. The
 * importer already accepts focused runs (`filters.scenario`).
 */
export function splitPerScenario(plan: PressPlan): PressPlan {
  return {
    ...plan,
    invocations: plan.invocations.flatMap((invocation) =>
      invocation.scenarios.length > 1
        ? invocation.scenarios.map((scenario) => ({
            ...invocation,
            scenario: scenario.id,
            scenarios: [scenario],
          }))
        : [invocation]
    ),
  };
}

/** The last failed step of a run, in words, for the report and the registry. */
export function describeRunFailure(runDir: string | undefined, exit: string): string {
  if (!runDir) return `session exited ${exit} before creating a run`;
  try {
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const failed = events.filter((event) => event.type === 'step.end' && event.ok === false).at(-1);
    const run = runDir.split('/').at(-1);
    if (failed) return `${failed.stepId} ${failed.label} failed (${run})`;
    if (!events.some((event) => event.type === 'run.end'))
      return `interrupted before finishing (${run})`;
    return `session exited ${exit} (${run})`;
  } catch {
    return `session exited ${exit}; no readable events`;
  }
}

function newRuns(before: Set<string>, invocation: Invocation) {
  if (!existsSync(ARTIFACTS)) return [];
  return readdirSync(ARTIFACTS)
    .filter((name) => name.startsWith('run-') && !before.has(name))
    .map((name) => join(ARTIFACTS, name))
    .filter((dir) => {
      try {
        const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
        return (
          manifest.suite === invocation.suite &&
          manifest.driver === (invocation.platform === 'ios' ? 'sim' : 'android')
        );
      } catch {
        return false;
      }
    });
}

let child: ReturnType<typeof spawn> | undefined;
let interrupted: NodeJS.Signals | undefined;

function runSession(invocation: Invocation, stamp: NativeBuildStamp) {
  const before = new Set(existsSync(ARTIFACTS) ? readdirSync(ARTIFACTS) : []);
  return new Promise<{ ok: boolean; exit: string; runs: string[] }>((resolve, reject) => {
    child = spawn(process.execPath, nativeArgs(invocation), {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...nativeEnv(stamp) },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = undefined;
      resolve({
        ok: code === 0 && !signal,
        exit: String(signal ?? code),
        runs: newRuns(before, invocation),
      });
    });
  });
}

async function captureSession(
  invocation: Invocation,
  plan: PressPlan,
  stamp: NativeBuildStamp,
  attempts: number
): Promise<SessionResult> {
  const ids = new Set(invocation.scenarios.map((scenario) => scenario.id));
  const keys = plan.captures
    .filter((capture) => capture.platform === invocation.platform && ids.has(capture.scenario))
    .map((capture) => capture.key);
  const runs: string[] = [];
  let reason = 'not attempted';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (interrupted) break;
    const label = `${invocation.platform} ${invocation.scenario ?? invocation.suite}`;
    try {
      checkStorage();
    } catch (error) {
      // Low disk is a machine condition, not a capture failure: stop cleanly.
      reason = error instanceof Error ? error.message : String(error);
      console.log(`✖ ${label}: ${reason}`);
      return {
        status: 'failed',
        invocation,
        runs,
        keys,
        reason,
        attempts: attempt - 1,
        halt: true,
      };
    }
    console.log(`\n▶ ${label} — attempt ${attempt}/${attempts}`);
    // App source must be identical before and after the session, or the stamp would lie.
    const appSource = appSourceStamp(ROOT);
    const session = await runSession(invocation, stamp);
    runs.push(...session.runs);
    const appSourceAfter = appSourceStamp(ROOT);
    if (
      session.ok &&
      session.runs.length === 1 &&
      appSource?.fingerprint !== appSourceAfter?.fingerprint
    ) {
      reason = 'app source changed during capture; not promoted';
    } else if (session.ok && session.runs.length === 1) {
      try {
        const [pressDir] = await importPressRuns(session.runs, plan);
        promoteCandidates([pressDir], {
          builds: { [invocation.platform]: buildSummary(stamp) },
          appSource,
        });
        console.log(`✔ ${label}: promoted ${keys.join(', ')}`);
        return { status: 'captured', invocation, run: session.runs[0], keys, attempts: attempt };
      } catch (error) {
        reason = `capture rejected: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else {
      reason =
        session.runs.length > 1
          ? 'ambiguous run output (another e2e run was active)'
          : describeRunFailure(session.runs[0], session.exit);
    }
    console.log(`✖ ${label}: ${reason}`);
  }
  return { status: 'failed', invocation, runs, keys, reason, attempts };
}

function runDownstream(command: string, args: string[]) {
  console.log(`\n▶ ${command} ${args.join(' ')}`);
  return new Promise<boolean>((resolve) => {
    child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
    child.once('error', () => resolve(false));
    child.once('exit', (code, signal) => {
      child = undefined;
      resolve(code === 0 && !signal);
    });
  });
}

async function refresh(args: string[]) {
  const options = parseRefreshArgs(args);
  const plan = splitPerScenario(
    selectPressScenario(createPressPlan(options.platforms), options.scenario)
  );
  if (options.planOnly) {
    const builds = [];
    for (const platform of options.platforms) {
      const fingerprint = await nativeFingerprint(platform);
      const stamp = readStamp(platform);
      builds.push({
        platform,
        fingerprint,
        stamped: stamp?.fingerprint ?? null,
        current: stamp?.fingerprint === fingerprint,
      });
    }
    console.log(
      JSON.stringify(
        {
          builds,
          sessions: plan.invocations.map((invocation) => ({
            platform: invocation.platform,
            suite: invocation.suite,
            scenario: invocation.scenario ?? null,
            keys: plan.captures
              .filter(
                (c) =>
                  c.platform === invocation.platform &&
                  invocation.scenarios.some((s) => s.id === c.scenario)
              )
              .map((c) => c.key),
          })),
          notCapturable: plan.unsupportedRegistered,
        },
        null,
        2
      )
    );
    return 0;
  }

  const startedAt = new Date().toISOString();
  const onInt = () => {
    interrupted ??= 'SIGINT';
    child?.kill('SIGINT');
  };
  const onTerm = () => {
    interrupted ??= 'SIGTERM';
    child?.kill('SIGTERM');
  };
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  const results: SessionResult[] = [];
  const buildFailures: { platform: Platform; reason: string }[] = [];
  let halted: string | undefined;
  try {
    for (const platform of options.platforms) {
      if (interrupted || halted) break;
      console.log(`\n══ ${platform} ══`);
      let stamp: NativeBuildStamp;
      try {
        checkStorage();
        stamp = await ensureNativeBuild(platform, options.rebuild);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.log(`✖ ${platform} native build: ${reason}`);
        buildFailures.push({ platform, reason });
        continue;
      }
      for (const invocation of plan.invocations.filter((item) => item.platform === platform)) {
        if (interrupted || halted) break;
        let result: SessionResult;
        try {
          result = await captureSession(invocation, plan, stamp, options.attempts);
        } catch (error) {
          const reason = `refresh error: ${error instanceof Error ? error.message : String(error)}`;
          console.log(
            `✖ ${invocation.platform} ${invocation.scenario ?? invocation.suite}: ${reason}`
          );
          result = { status: 'failed', invocation, runs: [], keys: [], reason, attempts: 0 };
        }
        results.push(result);
        if (result.status === 'failed' && result.halt) halted = result.reason;
        else if (result.status === 'failed' && result.keys.length)
          recordRefreshFailures(
            result.keys.map((key) => ({ key, reason: result.reason })),
            startedAt
          );
      }
    }
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }

  const captured = results.flatMap((result) => (result.status === 'captured' ? result.keys : []));
  const downstream: { step: string; ok: boolean }[] = [];
  if (options.downstream && captured.length && !interrupted) {
    const steps: [string, string, string[]][] = [
      // --variants keeps /dev layout variants in step with the new captures.
      ['artwork', 'node', ['scripts/artwork.mjs', '--allow-missing', '--variants']],
      ['mockups', 'bun', ['run', 'press:mockups']],
      // The homepage serves its own copies of the scenes and the OG image.
      [
        'site mockups',
        'bun',
        [
          'run',
          '--cwd',
          'site',
          'scripts/visual.mjs',
          '--export',
          join(ROOT, 'site/public/mockups'),
        ],
      ],
      [
        'site og image',
        'bun',
        [
          'run',
          '--cwd',
          'site',
          'scripts/visual.mjs',
          '--export',
          join(ROOT, 'site/public/social'),
          '--og-only',
        ],
      ],
      ['variants', 'bun', ['run', 'press:variants', '--export', '../press/exports/normalized']],
      ['site build', 'bun', ['run', 'site:build']],
    ];
    for (const [name, command, commandArgs] of steps) {
      // Variants never overwrite a batch; the superseded batch is removed first.
      if (name === 'variants')
        rmSync(join(ROOT, 'press/exports/normalized'), { recursive: true, force: true });
      const ok = await runDownstream(command, commandArgs);
      downstream.push({ step: name, ok });
      if (!ok) break;
    }
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    interrupted: interrupted ?? null,
    halted: halted ?? null,
    builds: options.platforms.map((platform) => ({ platform, stamp: readStamp(platform) ?? null })),
    buildFailures,
    sessions: results.map((result) => ({
      platform: result.invocation.platform,
      selection: result.invocation.scenario ?? result.invocation.suite,
      status: result.status,
      attempts: result.attempts,
      keys: result.keys,
      ...(result.status === 'captured'
        ? { run: result.run }
        : { reason: result.reason, runs: result.runs }),
    })),
    downstream,
    notCapturable: plan.unsupportedRegistered,
  };
  const reportPath = join(ARTIFACTS, `screenshot-refresh-${startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const failed = results.filter((result) => result.status === 'failed');
  console.log('\n══ Screenshot refresh summary ══');
  for (const result of results)
    console.log(
      `${result.status === 'captured' ? '✔' : '✖'} ${result.invocation.platform} ${result.invocation.scenario ?? result.invocation.suite}: ${result.keys.length} screenshots${result.status === 'failed' ? ` — ${result.reason}` : ''}`
    );
  for (const failure of buildFailures)
    console.log(`✖ ${failure.platform} native build — ${failure.reason}`);
  if (halted) console.log(`Stopped early: ${halted}`);
  for (const step of downstream) console.log(`${step.ok ? '✔' : '✖'} ${step.step}`);
  console.log(
    `Captured ${captured.length} screenshots; ${failed.length} sessions failed. Report: ${reportPath}`
  );
  if (plan.unsupportedRegistered.length)
    console.log(`No capture journey exists for: ${plan.unsupportedRegistered.join(', ')}`);
  return failed.length ||
    buildFailures.length ||
    halted ||
    interrupted ||
    downstream.some((step) => !step.ok)
    ? 1
    : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await refresh(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Screenshot refresh failed');
    process.exitCode = 1;
  }
}
