/* eslint-disable no-console -- press CLI boundary */
/**
 * Build-bound native apps for screenshot refreshes.
 *
 * The e2e drivers reuse whatever dev client they can find, which is how iOS
 * captures silently ran on a months-old 0.1.1 binary. Here every refresh
 * resolves a native build whose Expo fingerprint matches the current source:
 * a matching stamped build is reused, anything else is rebuilt locally. The
 * stamp is recorded on every promoted screenshot.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  lstatSync,
  openSync,
  readlinkSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ROOT, type Platform } from './plan';
import type { NativeBuildSummary } from './promote';
import { resolveAndroidSdkRoot } from '../drivers/android/adb';

const APP_DIR = join(ROOT, 'app');
const NATIVE_BUILDS = join(APP_DIR, 'e2e/artifacts/native-builds');
const BUNDLE_ID = 'com.sovranbitcoin.dev';
// Continuous Native Generation: ios/ and android/ are generated from config, so
// they are outputs of the fingerprinted inputs, never inputs themselves.
const GENERATED_NATIVE_DIRS = ['ios/**', 'android/**'];

export type NativeBuildStamp = NativeBuildSummary & {
  version: 1;
  platform: Platform;
  appVariant: 'development';
  gitDirty: boolean;
  bundleId: string;
  artifact: string;
  toolchain: string;
};

export type RebuildPolicy = 'auto' | 'force' | 'never';

/** Fixed-size reads, not stream async-iteration: iterating a read stream under
 * Bun took over five minutes on the 385 MB debug APK that `shasum` hashes in
 * about a second, which is what stalled whole capture campaigns before the
 * attempt deadline existed. Constant memory, so a large artifact cannot trade
 * the stall for a spike. */
const HASH_CHUNK = 8 * 1024 * 1024;
export function nativeArtifactHash(artifact: string): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK);
  const visit = (path: string, name: string) => {
    const stat = lstatSync(path);
    hash.update(`${name}\0${stat.mode}\0`);
    if (stat.isSymbolicLink()) hash.update(readlinkSync(path));
    else if (stat.isDirectory())
      for (const entry of readdirSync(path).sort()) visit(join(path, entry), `${name}/${entry}`);
    else if (stat.isFile()) {
      const file = openSync(path, 'r');
      try {
        for (let read = readSync(file, buffer, 0, HASH_CHUNK, null); read > 0;)
          (hash.update(buffer.subarray(0, read)),
            (read = readSync(file, buffer, 0, HASH_CHUNK, null)));
      } finally {
        closeSync(file);
      }
    } else throw new Error('Unsupported native artifact entry');
  };
  visit(artifact, 'artifact');
  return hash.digest('hex');
}

export async function nativeFingerprint(platform: Platform): Promise<string> {
  // Keep Expo's config loader outside Bun's capture/import module graph and put
  // a hard deadline around it: a stuck config must not hang an entire campaign.
  const output = execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import { createFingerprintAsync } from '@expo/fingerprint';
     const result = await createFingerprintAsync(process.cwd(), { platforms: [process.argv[1]], ignorePaths: ${JSON.stringify(GENERATED_NATIVE_DIRS)}, silent: true });
     process.stdout.write(result.hash);`,
      platform,
    ],
    {
      cwd: APP_DIR,
      env: { ...process.env, APP_VARIANT: 'development' },
      encoding: 'utf8',
      // Bounded so a stuck config cannot hang a campaign, but generous: under
      // campaign load (emulator + Metro + simulator) this loader has exceeded
      // 60s and thrown `spawnSync node ETIMEDOUT`, discarding a capture that
      // had already passed — a 650s Android leg lost to a fingerprint check.
      timeout: 240_000,
      maxBuffer: 1024 * 1024,
    }
  ).trim();
  if (!/^[a-f0-9]{40,64}$/.test(output)) throw new Error('Invalid native fingerprint output');
  return output;
}

const stampPath = (platform: Platform) => join(NATIVE_BUILDS, platform, 'build.json');

function readStamp(platform: Platform): NativeBuildStamp | undefined {
  try {
    const stamp = JSON.parse(readFileSync(stampPath(platform), 'utf8')) as NativeBuildStamp;
    return stamp.version === 1 && stamp.platform === platform ? stamp : undefined;
  } catch {
    return undefined;
  }
}

export function buildSummary(stamp: NativeBuildStamp): NativeBuildSummary {
  const { fingerprint, appVersion, buildNumber, gitSha, builtAt, artifactSha256 } = stamp;
  return {
    fingerprint,
    appVersion,
    buildNumber,
    gitSha,
    builtAt,
    ...(artifactSha256 ? { artifactSha256 } : {}),
  };
}

export function nativeEnv(stamp: NativeBuildStamp): Record<string, string> {
  return stamp.platform === 'ios'
    ? { SOVRAN_E2E_APP_PATH: stamp.artifact }
    : { SOVRAN_E2E_APK_PATH: stamp.artifact };
}

const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/** Run a long build step, streaming its full output to a log file. */
function step(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  log: string
) {
  console.log(`  ${label}…`);
  return new Promise<void>((resolve, reject) => {
    const out = createWriteStream(log, { flags: 'a' });
    out.write(`\n== ${label}: ${command} ${args.join(' ')}\n`);
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => child.kill('SIGINT');
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    child.once('close', () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      out.end();
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${signal ?? code}); see ${log}`));
    });
  });
}

function writeStamp(stamp: NativeBuildStamp) {
  const path = stampPath(stamp.platform);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(stamp, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

function plistValue(app: string, key: string) {
  return execFileSync('plutil', ['-extract', key, 'raw', join(app, 'Info.plist')], {
    encoding: 'utf8',
  }).trim();
}

function retainIosApp(out: string) {
  const products = join(out, 'DerivedData/Build/Products/Debug-iphonesimulator');
  const app = existsSync(products)
    ? readdirSync(products).find((name) => name.endsWith('.app'))
    : undefined;
  if (!app) throw new Error(`No simulator .app under ${products}`);
  const retained = join(out, 'Sovran.app');
  rmSync(retained, { recursive: true, force: true });
  // ditto preserves the signature and baked entitlements SecureStore needs.
  execFileSync('ditto', [join(products, app), retained]);
  rmSync(join(out, 'DerivedData'), { recursive: true, force: true });
  return retained;
}

function iosStamp(artifact: string, fingerprint: string): NativeBuildStamp {
  const bundleId = plistValue(artifact, 'CFBundleIdentifier');
  if (bundleId !== BUNDLE_ID) throw new Error(`Built ${bundleId}, expected ${BUNDLE_ID}`);
  return {
    version: 1,
    platform: 'ios',
    appVariant: 'development',
    fingerprint,
    appVersion: plistValue(artifact, 'CFBundleShortVersionString'),
    buildNumber: plistValue(artifact, 'CFBundleVersion'),
    gitSha: git(['rev-parse', 'HEAD']),
    gitDirty: git(['status', '--porcelain']).length > 0,
    bundleId,
    artifact,
    toolchain: execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).split('\n')[0],
    builtAt: new Date().toISOString(),
  };
}

async function buildIos(fingerprint: string): Promise<NativeBuildStamp> {
  const out = join(NATIVE_BUILDS, 'ios');
  mkdirSync(out, { recursive: true });
  const log = join(out, 'build.log');
  writeFileSync(log, '');
  const env = { ...process.env, CI: '1', APP_VARIANT: 'development' };
  if (git(['ls-files', '--', 'app/ios']).length)
    throw new Error('Refusing to clean tracked iOS sources');
  await step(
    'expo prebuild (ios)',
    'node',
    [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'ios', '--clean'],
    APP_DIR,
    env,
    log
  );
  const workspace = readdirSync(join(APP_DIR, 'ios')).find((name) => name.endsWith('.xcworkspace'));
  if (!workspace) throw new Error('expo prebuild produced no .xcworkspace');
  const scheme = workspace.replace(/\.xcworkspace$/, '');
  await step(
    'xcodebuild (Debug, iOS Simulator)',
    'xcodebuild',
    [
      '-workspace',
      join('ios', workspace),
      '-scheme',
      scheme,
      '-configuration',
      'Debug',
      '-sdk',
      'iphonesimulator',
      '-destination',
      'generic/platform=iOS Simulator',
      '-derivedDataPath',
      join(out, 'DerivedData'),
      '-jobs',
      '4',
      `ARCHS=${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`,
      'ONLY_ACTIVE_ARCH=YES',
      'build',
    ],
    APP_DIR,
    env,
    log
  );
  return iosStamp(retainIosApp(out), fingerprint);
}

function apkBadging(apk: string) {
  const buildTools = join(resolveAndroidSdkRoot(), 'build-tools');
  for (const version of readdirSync(buildTools).sort().reverse()) {
    const aapt2 = join(buildTools, version, 'aapt2');
    if (!existsSync(aapt2)) continue;
    const output = execFileSync(aapt2, ['dump', 'badging', apk], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 ** 2,
    });
    const match = /package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/.exec(
      output
    );
    if (match) return { bundleId: match[1], buildNumber: match[2], appVersion: match[3] };
  }
  throw new Error('aapt2 not found under Android SDK build-tools; cannot verify the APK');
}

/** A JDK home whose release file declares Java 17; java_home silently returns the
 * default JDK (with exit 0) when no 17 is registered, so never trust it alone. */
function resolveJdk17(): string {
  const isJdk17 = (home: string) => {
    try {
      return /JAVA_VERSION="17[."]/.test(readFileSync(join(home, 'release'), 'utf8'));
    } catch {
      return false;
    }
  };
  const candidates: string[] = [];
  try {
    candidates.push(
      execFileSync('/usr/libexec/java_home', ['-v', '17'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    );
  } catch {
    // no registered JDKs at all
  }
  for (const prefix of ['/opt/homebrew', '/usr/local'])
    candidates.push(join(prefix, 'opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'));
  const home = candidates.find(isJdk17);
  if (!home) throw new Error('JDK 17 is required for Android builds: brew install openjdk@17');
  return home;
}

async function buildAndroid(fingerprint: string): Promise<NativeBuildStamp> {
  const out = join(NATIVE_BUILDS, 'android');
  mkdirSync(out, { recursive: true });
  const log = join(out, 'build.log');
  writeFileSync(log, '');
  const javaHome = resolveJdk17();
  // prebuild regenerates android/ without local.properties, so gradle needs the SDK path here.
  const sdk = resolveAndroidSdkRoot();
  const env = {
    ...process.env,
    CI: '1',
    APP_VARIANT: 'development',
    JAVA_HOME: javaHome,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
  };
  await step(
    'expo prebuild (android)',
    'node',
    [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'android'],
    APP_DIR,
    env,
    log
  );
  await step(
    'gradle assembleDebug',
    './gradlew',
    ['assembleDebug'],
    join(APP_DIR, 'android'),
    env,
    log
  );
  const built = join(APP_DIR, 'android/app/build/outputs/apk/debug/app-debug.apk');
  const artifact = join(out, 'app-debug.apk');
  copyFileSync(built, artifact);
  const badging = apkBadging(artifact);
  if (badging.bundleId !== BUNDLE_ID)
    throw new Error(`Built ${badging.bundleId}, expected ${BUNDLE_ID} (APP_VARIANT not applied)`);
  return {
    version: 1,
    platform: 'android',
    appVariant: 'development',
    fingerprint,
    ...badging,
    gitSha: git(['rev-parse', 'HEAD']),
    gitDirty: git(['status', '--porcelain']).length > 0,
    artifact,
    toolchain: `JDK 17 (${javaHome})`,
    builtAt: new Date().toISOString(),
  };
}

/** Reuse a stamped build whose fingerprint matches current source, else rebuild. */
export async function ensureNativeBuild(
  platform: Platform,
  policy: RebuildPolicy = 'auto'
): Promise<NativeBuildStamp> {
  const fingerprint = await nativeFingerprint(platform);
  const stamp = readStamp(platform);
  const current =
    stamp?.fingerprint === fingerprint &&
    existsSync(stamp.artifact) &&
    Boolean(stamp.artifactSha256) &&
    nativeArtifactHash(stamp.artifact) === stamp.artifactSha256;
  if (current && policy !== 'force') {
    console.log(
      `${platform}: reusing native build ${stamp.appVersion} (${stamp.buildNumber}) from ${stamp.builtAt}`
    );
    return stamp;
  }
  if (policy === 'never')
    throw new Error(
      `${platform}: no native build matches the current fingerprint ${fingerprint.slice(0, 12)}; rerun without --rebuild never`
    );
  console.log(
    `${platform}: ${stamp ? 'native inputs changed' : 'no stamped native build'}; building locally (this takes a while)`
  );
  const built = platform === 'ios' ? await buildIos(fingerprint) : await buildAndroid(fingerprint);
  // Source must not change under the build, or the stamp would lie.
  if ((await nativeFingerprint(platform)) !== fingerprint)
    throw new Error(`${platform}: native inputs changed during the build; rerun once edits settle`);
  built.artifactSha256 = nativeArtifactHash(built.artifact);
  writeStamp(built);
  return built;
}

if (import.meta.main) {
  try {
    const [platform, flag] = process.argv.slice(2);
    if (platform !== 'ios' && platform !== 'android')
      throw new Error('Usage: bun app/e2e/press/native-build.ts ios|android [--force|--status]');
    if (flag === '--status') {
      const fingerprint = await nativeFingerprint(platform);
      const stamp = readStamp(platform);
      console.log(
        JSON.stringify(
          {
            fingerprint,
            stamp,
            current:
              stamp?.fingerprint === fingerprint &&
              Boolean(stamp?.artifactSha256) &&
              nativeArtifactHash(stamp!.artifact) === stamp!.artifactSha256,
          },
          null,
          2
        )
      );
    } else {
      if (flag !== undefined && flag !== '--force') throw new Error('Choose --force or --status');
      const stamp = await ensureNativeBuild(platform, flag === '--force' ? 'force' : 'auto');
      console.log(JSON.stringify(stamp, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Native build failed');
    process.exitCode = 1;
  }
}
