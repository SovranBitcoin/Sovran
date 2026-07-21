/**
 * Fail-fast campaign preflight. Every check either passes (possibly with
 * warnings the operator should read) or fails with the exact action needed —
 * a multi-hour campaign must never burn its first hour discovering a stale
 * APK or a locked cocod wallet.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';

import { err, ok, type Result } from 'neverthrow';

import { findInstallableApk } from '../drivers/android/android-session';
import { resolveAndroidSdkRoot } from '../drivers/android/adb';
import { findInstallableApp } from '../drivers/simctl';
import {
  CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT,
  connectUnlockedCurrentCocod,
} from '../funded-runtime/cocod-live';
import { getFundedRunLockStatus } from '../funded-runtime/lock';
import { auditStartupLiabilities } from '../ledger/startup';
import { APP_ROOT, ARTIFACTS } from '../viewer/lib/paths';

export type PreflightResult = Result<string[], string>;

const LOW_DISK_BYTES = 20 * 1024 ** 3;

/** Disk headroom is advisory (warn), never blocking — --no-record is the fix. */
export function diskPreflight(root: string = ARTIFACTS): string[] {
  try {
    const stats = statfsSync(root);
    const free = stats.bavail * stats.bsize;
    if (free < LOW_DISK_BYTES) {
      return [
        `low disk: ${(free / 1024 ** 3).toFixed(1)} GiB free under ${root} — consider --no-record`,
      ];
    }
  } catch {
    return [`could not stat free disk under ${root}`];
  }
  return [];
}

export function androidPreflight(appRoot: string = APP_ROOT): PreflightResult {
  const warnings: string[] = [];
  let apk: string;
  try {
    apk = findInstallableApk(appRoot);
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : String(cause));
  }

  const packageName = readApkPackageName(apk);
  if (packageName === undefined) {
    warnings.push('aapt not found under the Android SDK build-tools — APK variant not verified');
  } else if (packageName !== 'com.sovranbitcoin.dev') {
    return err(
      `APK at ${apk} has applicationId "${packageName}" (expected com.sovranbitcoin.dev) — the stale-variant trap. Rebuild with \`APP_VARIANT=development bun expo run:android\` (JDK 17)`
    );
  }

  try {
    const apkMtime = statSync(apk).mtimeMs;
    const configMtime = statSync(join(appRoot, 'app.config.js')).mtimeMs;
    if (apkMtime < configMtime) {
      warnings.push(
        'APK is older than app.config.js — if native config changed, rebuild with `APP_VARIANT=development bun expo run:android` (JDK 17)'
      );
    }
  } catch {
    // mtime comparison is best-effort only
  }
  return ok(warnings);
}

/** aapt/aapt2 `dump badging` package name, or undefined when no build-tools
 * aapt is available (warn path — never block on a missing inspector). */
function readApkPackageName(apk: string): string | undefined {
  let sdkRoot: string;
  try {
    sdkRoot = resolveAndroidSdkRoot();
  } catch {
    return undefined;
  }
  const buildTools = join(sdkRoot, 'build-tools');
  let versions: string[];
  try {
    versions = readdirSync(buildTools).sort().reverse();
  } catch {
    return undefined;
  }
  for (const version of versions) {
    for (const bin of ['aapt2', 'aapt']) {
      const candidate = join(buildTools, version, bin);
      if (!existsSync(candidate)) continue;
      try {
        const output = execFileSync(candidate, ['dump', 'badging', apk], {
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
        });
        const match = /package: name='([^']+)'/.exec(output);
        if (match) return match[1];
      } catch {
        // fall through to the next candidate binary
      }
    }
  }
  return undefined;
}

export async function iosPreflight(): Promise<PreflightResult> {
  try {
    const output = execFileSync('xcrun', ['simctl', 'list', '-j', 'runtimes'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(output) as { runtimes?: { isAvailable?: boolean; name?: string }[] };
    const available = (parsed.runtimes ?? []).filter(
      (runtime) => runtime.isAvailable && runtime.name?.startsWith('iOS')
    );
    if (available.length === 0)
      return err('no available iOS simulator runtime (xcrun simctl list)');
  } catch (cause) {
    return err(`simctl unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  try {
    await findInstallableApp();
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : String(cause));
  }
  return ok([]);
}

/** Funded preflight verifies the operator-side prerequisites the child CLI
 * would otherwise discover minutes into a chunk: global lock free (or stale,
 * which the child recovers itself), liabilities clean, cocod unlocked. */
export async function fundedPreflight(): Promise<PreflightResult> {
  const warnings: string[] = [];
  const lock = getFundedRunLockStatus(ARTIFACTS);
  if (lock.status === 'active') {
    return err('funded run lock is ACTIVE (another funded run is live) — wait or investigate');
  }
  if (lock.status === 'stale') {
    warnings.push('stale funded run lock present — the next funded chunk will recover it');
  }
  const audit = auditStartupLiabilities(ARTIFACTS);
  if (audit.status !== 'clean') {
    warnings.push(
      `startup liabilities are ${audit.status} (${audit.blockers.length} blocker(s)) — funded chunks will attempt recovery; run \`bun e2e/cli.ts funds-status\` for detail`
    );
  }
  try {
    await connectUnlockedCurrentCocod({
      currentWalletAcknowledgement: CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT,
    });
  } catch (cause) {
    return err(
      `cocod is not ready: ${cause instanceof Error ? cause.message : String(cause)} — unlock the current cocod wallet and re-run`
    );
  }
  return ok(warnings);
}
