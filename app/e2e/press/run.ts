/* eslint-disable no-console -- press CLI boundary */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPressPlan,
  nativeArgs,
  NATIVE_FRESHNESS,
  ROOT,
  selectPressScenario,
  type Platform,
} from './plan';
import { importPressRuns } from './import';

// Conservative reserve above Android's 7.3 GiB boot floor, on every relevant volume.
export const MIN_FREE_BYTES = 10 * 1024 ** 3;
export function checkStorage(
  paths = [ROOT, tmpdir(), homedir()],
  freeBytes = (path: string) => {
    const stats = statfsSync(path);
    return stats.bavail * stats.bsize;
  }
) {
  for (const path of paths) {
    const free = freeBytes(path);
    if (!Number.isFinite(free) || free < MIN_FREE_BYTES)
      throw new Error(
        `Press capture needs 10 GiB free before Metro; ${path}: ${(free / 1024 ** 3).toFixed(1)} GiB. Free space and rerun; nothing is deleted automatically.`
      );
  }
}

export function parsePressArgs(args: string[]) {
  args = [...args];
  let scenario: string | undefined;
  const index = args.indexOf('--scenario');
  if (index !== -1) {
    scenario = args[index + 1];
    if (!scenario || scenario.startsWith('--'))
      throw new Error('--scenario requires an exact scenario ID');
    args.splice(index, 2);
  }
  const positionals = args.filter((arg) => !arg.startsWith('--'));
  if (
    positionals.length > 1 ||
    args.some((arg) => arg.startsWith('--') && arg !== '--plan') ||
    args.filter((arg) => arg === '--plan').length > 1
  )
    throw new Error('Usage: bun app/e2e/press/run.ts [ios|android|both] [--scenario ID] [--plan]');
  const target = positionals[0] ?? 'both';
  if (target !== 'ios' && target !== 'android' && target !== 'both')
    throw new Error('Choose ios, android or both');
  const platforms: Platform[] = target === 'both' ? ['ios', 'android'] : [target];
  return { platforms, planOnly: args.includes('--plan'), ...(scenario ? { scenario } : {}) };
}

/** The child CLI, not this wrapper, owns device and Metro cleanup. Forward a
 * single signal and wait for its finally blocks; never SIGKILL its resources. */
async function runPress(args: string[]) {
  const options = parsePressArgs(args);
  const plan = selectPressScenario(createPressPlan(options.platforms), options.scenario);
  if (options.planOnly) {
    writeFileSync(1, JSON.stringify(plan, null, 2) + '\n');
    return;
  }
  console.log(
    `Press candidates only. Native freshness ${NATIVE_FRESHNESS}. Disposable resets approved; no funding or publication.`
  );
  console.log(`Unsupported registrations (not captured): ${plan.unsupportedRegistered.join(', ')}`);
  checkStorage();
  // Check every requested platform before the first CLI can start Metro.
  for (const platform of options.platforms) {
    if (platform === 'ios') {
      const { findInstallableApp, resolveServeSimBin } = await import('../drivers/simctl');
      resolveServeSimBin();
      await findInstallableApp();
    } else {
      const { findInstallableApk } = await import('../drivers/android/android-session');
      const { resolveAndroidSdkRoot, emulatorBin } = await import('../drivers/android/adb');
      findInstallableApk();
      const sdk = resolveAndroidSdkRoot();
      for (const path of [
        emulatorBin(sdk),
        join(sdk, 'system-images/android-36.1/google_apis_playstore/arm64-v8a/system.img'),
      ])
        if (!existsSync(path)) throw new Error(`Missing native artifact: ${path}`);
    }
  }
  const artifacts = join(ROOT, 'app/e2e/artifacts');
  let child: ReturnType<typeof spawn> | undefined;
  let interrupted: NodeJS.Signals | undefined;
  const forward = (signal: NodeJS.Signals) => {
    if (interrupted) return;
    interrupted = signal;
    child?.kill(signal);
  };
  const onInt = () => forward('SIGINT');
  const onTerm = () => forward('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    for (const invocation of plan.invocations) {
      if (interrupted) throw new Error('Press capture interrupted; no further sessions started');
      if (
        JSON.stringify(
          selectPressScenario(createPressPlan(options.platforms), options.scenario)
        ) !== JSON.stringify(plan)
      )
        throw new Error('Press selection changed during capture; inspect changes and rerun');
      checkStorage();
      const before = new Set(existsSync(artifacts) ? readdirSync(artifacts) : []);
      await new Promise<void>((resolve, reject) => {
        child = spawn(process.execPath, nativeArgs(invocation), { cwd: ROOT, stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', (code, signal) =>
          code === 0 && !signal && !interrupted
            ? resolve()
            : reject(
                new Error(
                  `Native capture stopped (${signal ?? code}); inspect its run, no candidates imported`
                )
              )
        );
      });
      child = undefined;
      const runs = readdirSync(artifacts)
        .filter((name) => !before.has(name) && name.startsWith('run-'))
        .map((name) => join(artifacts, name))
        .filter((dir) => {
          if (!existsSync(join(dir, 'manifest.json'))) return false;
          const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
          return (
            manifest.suite === invocation.suite &&
            manifest.driver === (invocation.platform === 'ios' ? 'sim' : 'android')
          );
        });
      if (runs.length !== 1)
        throw new Error('Ambiguous capture output; import explicit run directories instead');
      if (interrupted) throw new Error('Press capture interrupted before import');
      console.log(`Unreviewed candidates: ${(await importPressRuns(runs, plan)).join(', ')}`);
    }
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }
}

if (import.meta.main) {
  try {
    await runPress(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Press capture failed');
    process.exitCode = 1;
  }
}
