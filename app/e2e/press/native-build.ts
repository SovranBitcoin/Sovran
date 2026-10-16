/* eslint-disable no-console -- press CLI boundary */
/**
 * Build-bound native apps for screenshot refreshes.
 *
 * The e2e drivers reuse whatever dev client they can find, which is how iOS
 * captures silently ran on a months-old 0.1.1 binary. Here every refresh
 * resolves a native build whose Expo fingerprint matches the current source:
 * a matching stamped build is reused, anything else is rebuilt locally. The
 * stamp is recorded on every promoted screenshot.
 *
 * The same steps build the end-to-end test app (`--bundled`): the Release
 * configuration, with its JavaScript inside it and logging left on, so it
 * launches without a bundler (ADR 0033). Its JavaScript is part of the
 * artifact, so it is current only for the commit it was built from. On iOS,
 * when only JavaScript has changed, the native part is kept and the bundle
 * inside the app is replaced. Android rebuilds the signed APK through Gradle.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  lstatSync,
  openSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ROOT, type Platform } from './plan';
import type { NativeBuildSummary } from './promote';
import { resolveAndroidSdkRoot } from '../drivers/android/adb';
import { captureGitInfo, captureSourceFingerprint } from '../core/git';

const APP_DIR = join(ROOT, 'app');
const NATIVE_BUILDS = join(APP_DIR, 'e2e/artifacts/native-builds');
const BUNDLE_ID = 'com.sovranbitcoin.dev';
// Continuous Native Generation: ios/ and android/ are generated from config, so
// they are outputs of the fingerprinted inputs, never inputs themselves.
const GENERATED_NATIVE_DIRS = ['ios/**', 'android/**'];

/** `dev` loads its JavaScript from a bundler; `bundled` carries it. */
export type BuildKind = 'dev' | 'bundled';

const nativeBuildStampSchema = z.object({
  version: z.literal(1),
  platform: z.enum(['ios', 'android']),
  kind: z.enum(['dev', 'bundled']).optional(),
  appVariant: z.literal('development'),
  gitDirty: z.boolean(),
  bundleId: z.string().min(1),
  artifact: z.string().min(1),
  toolchain: z.string(),
  fingerprint: z.string().min(1),
  appVersion: z.string(),
  buildNumber: z.string(),
  gitSha: z.string().regex(/^[a-f0-9]{40}$/),
  builtAt: z.string(),
  artifactSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  // Older cache records remain readable, but cannot certify bundled source.
  sourceFingerprint: z.string().optional(),
  edition: z.string().optional(),
});
export type NativeBuildStamp = z.infer<typeof nativeBuildStampSchema>;

export type RebuildPolicy = 'auto' | 'force' | 'never';

/** A bundled story observes ordinary app timing without inherited fixture controls. */
export function nativeBuildEnvironment(
  kind: BuildKind,
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source, CI: '1', APP_VARIANT: 'development' };
  // EAS takes precedence over APP_VARIANT in app.config.js.
  delete env.EAS_BUILD_PROFILE;
  if (kind === 'bundled') {
    for (const key of Object.keys(env)) if (key.startsWith('EXPO_PUBLIC_E2E_')) delete env[key];
    delete env.DEBUG_MNEMONIC;
    env.EXPO_NO_DOTENV = '1';
    env.EXPO_PUBLIC_E2E_LOGS = '1';
  }
  return env;
}

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

/** Compare installed contents without weakening the stamped artifact hash. CoreSimulator
 * was observed to remove execute permission from embedded framework binaries only. */
export function inspectInstalledIosApp(selected: string, installed: string) {
  const selectedPath = realpathSync(selected);
  const installedPath = realpathSync(installed);
  if (selectedPath === installedPath) throw new Error('Installed app must be a separate payload');
  const mismatches: string[] = [];
  const normalizedModes: { path: string; selected: number; installed: number }[] = [];
  const buffer = Buffer.allocUnsafe(HASH_CHUNK);
  const fileHash = (path: string) => {
    const hash = createHash('sha256');
    const file = openSync(path, 'r');
    try {
      for (let n = readSync(file, buffer); n > 0; n = readSync(file, buffer))
        hash.update(buffer.subarray(0, n));
      return hash.digest('hex');
    } finally {
      closeSync(file);
    }
  };
  const visit = (path: string) => {
    const a = join(selectedPath, path),
      b = join(installedPath, path);
    // lstat distinguishes dangling links from absent entries; never follow links.
    const left = lstatSync(a, { throwIfNoEntry: false });
    const right = lstatSync(b, { throwIfNoEntry: false });
    if (!left || !right) {
      mismatches.push(`${path}: missing entry`);
      return;
    }
    if (left.mode !== right.mode) {
      if (
        left.isFile() &&
        right.isFile() &&
        left.mode === 0o100755 &&
        right.mode === 0o100644 &&
        /^Frameworks\/([^/]+)\.framework\/\1$/.test(path)
      )
        normalizedModes.push({ path, selected: left.mode, installed: right.mode });
      else mismatches.push(`${path}: mode or type differs`);
    }
    if (left.isDirectory() && right.isDirectory()) {
      for (const child of [...new Set([...readdirSync(a), ...readdirSync(b)])].sort())
        visit(path ? `${path}/${child}` : child);
    } else if (left.isFile() && right.isFile()) {
      if (fileHash(a) !== fileHash(b)) mismatches.push(`${path}: bytes differ`);
    } else if (left.isSymbolicLink() && right.isSymbolicLink()) {
      if (readlinkSync(a) !== readlinkSync(b)) mismatches.push(`${path}: link target differs`);
    } else mismatches.push(`${path}: unsupported or different entry types`);
  };
  visit('');
  return {
    selectedPath,
    installedPath,
    selectedSha256: nativeArtifactHash(selectedPath),
    installedSha256: nativeArtifactHash(installedPath),
    normalizedModes,
    mismatches,
  };
}

/** Read-only selection: never rebuild or silently select a different edition. */
export async function selectBundledIosStoryApp(artifact: string) {
  const build = nativeBuildStampSchema.parse(
    JSON.parse(readFileSync(join(dirname(artifact), 'build.json'), 'utf8'))
  );
  if (
    build.platform !== 'ios' ||
    build.kind !== 'bundled' ||
    build.bundleId !== BUNDLE_ID ||
    !build.artifactSha256 ||
    realpathSync(build.artifact) !== realpathSync(artifact)
  )
    throw new Error('Selected app is not the stamped bundled iOS development build');
  const assertCurrent = async () => {
    if (
      !bundledJavaScriptIsCurrent(build) ||
      nativeArtifactHash(artifact) !== build.artifactSha256 ||
      (await nativeFingerprint('ios', 'bundled')) !== build.fingerprint ||
      !bundledJavaScriptIsCurrent(build)
    )
      throw new Error(
        'Selected iOS build no longer matches current clean source or stamped artifact'
      );
  };
  await assertCurrent();
  let baseline: ReturnType<typeof inspectInstalledIosApp> | undefined;
  return {
    build,
    async inspect(installed: string) {
      await assertCurrent();
      const payload = inspectInstalledIosApp(artifact, installed);
      if (payload.selectedSha256 !== build.artifactSha256)
        payload.mismatches.push('Selected artifact changed during inspection');
      if (
        baseline &&
        (payload.installedPath !== baseline.installedPath ||
          payload.installedSha256 !== baseline.installedSha256)
      )
        payload.mismatches.push('Installed app changed since the pre-launch inspection');
      if (!baseline && payload.mismatches.length === 0) baseline = payload;
      return payload;
    },
  };
}

export async function nativeFingerprint(
  platform: Platform,
  kind: BuildKind = 'dev'
): Promise<string> {
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
      env: nativeBuildEnvironment(kind),
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
  // The same native sources can select a different Release network policy.
  return platform === 'android' && kind === 'bundled'
    ? createHash('sha256').update(`${output}\0android-bundled-e2e`).digest('hex')
    : output;
}

const buildDir = (platform: Platform, kind: BuildKind) =>
  join(NATIVE_BUILDS, kind === 'bundled' ? `${platform}-bundled` : platform);
const stampPath = (platform: Platform, kind: BuildKind) =>
  join(buildDir(platform, kind), 'build.json');

function readStamp(platform: Platform, kind: BuildKind = 'dev'): NativeBuildStamp | undefined {
  try {
    const stamp = nativeBuildStampSchema.parse(
      JSON.parse(readFileSync(stampPath(platform, kind), 'utf8'))
    );
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

/** Build outputs cannot be attributed to a commit observed only after compilation. */
export async function withStableBuildSource<T extends object>(
  root: string,
  build: () => Promise<T>
): Promise<T & { sourceFingerprint: string }> {
  const before = captureGitInfo(root);
  const source = captureSourceFingerprint(root);
  if (!before || !source) throw new Error('Build source identity unavailable');
  const result = await build();
  const after = captureGitInfo(root);
  if (
    !after ||
    before.sha !== after.sha ||
    before.dirty !== after.dirty ||
    source !== captureSourceFingerprint(root)
  )
    throw new Error('Source changed during the build; refusing to stamp it');
  return { ...result, sourceFingerprint: source };
}

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
  const path = stampPath(stamp.platform, stamp.kind ?? 'dev');
  writeFileSync(`${path}.tmp`, `${JSON.stringify(stamp, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

function plistValue(app: string, key: string) {
  return execFileSync('plutil', ['-extract', key, 'raw', join(app, 'Info.plist')], {
    encoding: 'utf8',
  }).trim();
}

function retainIosApp(out: string, configuration: 'Debug' | 'Release') {
  const products = join(out, `DerivedData/Build/Products/${configuration}-iphonesimulator`);
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

function iosStamp(artifact: string, fingerprint: string, kind: BuildKind): NativeBuildStamp {
  const bundleId = plistValue(artifact, 'CFBundleIdentifier');
  if (bundleId !== BUNDLE_ID) throw new Error(`Built ${bundleId}, expected ${BUNDLE_ID}`);
  return {
    version: 1,
    platform: 'ios',
    ...(kind === 'bundled' ? { kind } : {}),
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

async function buildIos(fingerprint: string, kind: BuildKind): Promise<NativeBuildStamp> {
  const out = buildDir('ios', kind);
  mkdirSync(out, { recursive: true });
  const log = join(out, 'build.log');
  writeFileSync(log, '');
  const configuration = kind === 'bundled' ? 'Release' : 'Debug';
  const env = nativeBuildEnvironment(kind);
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
    `xcodebuild (${configuration}, iOS Simulator)`,
    'xcodebuild',
    [
      '-workspace',
      join('ios', workspace),
      '-scheme',
      scheme,
      '-configuration',
      configuration,
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
  return iosStamp(retainIosApp(out, configuration), fingerprint, kind);
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

async function buildAndroid(fingerprint: string, kind: BuildKind): Promise<NativeBuildStamp> {
  const out = buildDir('android', kind);
  const configuration = kind === 'bundled' ? 'release' : 'debug';
  const task = kind === 'bundled' ? 'assembleRelease' : 'assembleDebug';
  mkdirSync(out, { recursive: true });
  const log = join(out, 'build.log');
  writeFileSync(log, '');
  const javaHome = resolveJdk17();
  // prebuild regenerates android/ without local.properties, so gradle needs the SDK path here.
  const sdk = resolveAndroidSdkRoot();
  const env = {
    ...nativeBuildEnvironment(kind),
    JAVA_HOME: javaHome,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
  };
  // A bundled build is evidence of the source: regenerate android/ (ignored by Git
  // and by the native fingerprint) so nothing left in it reaches the APK.
  if (kind === 'bundled' && git(['ls-files', '--', 'app/android']).length)
    throw new Error('Refusing to clean tracked Android sources');
  await step(
    'expo prebuild (android)',
    'node',
    [
      require.resolve('expo/bin/cli'),
      'prebuild',
      '--platform',
      'android',
      ...(kind === 'bundled' ? ['--clean'] : []),
    ],
    APP_DIR,
    env,
    log
  );
  // Gradle's app-local JS inputs omit sibling workspace code and some assets.
  // Once this owner requires a rebuild, Metro must traverse its actual graph.
  const tasks = [
    ...(kind === 'bundled'
      ? ['-PsovranBundledE2e=true', ':app:createBundleReleaseJsAndAssets', '--rerun']
      : []),
    task,
  ];
  await step(`gradle ${task}`, './gradlew', tasks, join(APP_DIR, 'android'), env, log);
  const built = join(
    APP_DIR,
    `android/app/build/outputs/apk/${configuration}/app-${configuration}.apk`
  );
  const artifact = join(out, `app-${configuration}.apk`);
  copyFileSync(built, artifact);
  const badging = apkBadging(artifact);
  if (badging.bundleId !== BUNDLE_ID)
    throw new Error(`Built ${badging.bundleId}, expected ${BUNDLE_ID} (APP_VARIANT not applied)`);
  return {
    version: 1,
    platform: 'android',
    ...(kind === 'bundled' ? { kind } : {}),
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

/** The JavaScript inside a bundled build is the tree it was built from, so it
 *  stands only for a clean tree at that same commit. */
export function bundledJavaScriptIsCurrent(
  stamp: Pick<NativeBuildStamp, 'gitSha' | 'gitDirty' | 'sourceFingerprint'>,
  head = git(['rev-parse', 'HEAD']),
  dirty = git(['status', '--porcelain']).length > 0,
  source = captureSourceFingerprint(ROOT)
): boolean {
  return (
    !stamp.gitDirty &&
    !dirty &&
    stamp.gitSha === head &&
    source !== undefined &&
    stamp.sourceFingerprint === source
  );
}

/**
 * Replace the JavaScript inside a bundled build whose native part still matches,
 * with the two commands Xcode's bundling phase runs: Metro's embed export, then
 * the Hermes compiler. The app is signed again because its contents changed;
 * the entitlements SecureStore needs are kept.
 */
/** The Hermes compiler React Native itself depends on and Xcode's bundling phase runs. */
function hermesCompiler(): string {
  const fromReactNative = createRequire(require.resolve('react-native/package.json'));
  const packageJson = fromReactNative.resolve(['hermes-compiler', 'package.json'].join('/'));
  return join(dirname(packageJson), 'hermesc/osx-bin/hermesc');
}

async function refreshBundledJavaScript(
  stamp: NativeBuildStamp,
  other?: { out: string; edition: string }
): Promise<NativeBuildStamp> {
  return withStableBuildSource(ROOT, async () => {
    const out = other?.out ?? buildDir('ios', 'bundled');
    const log = join(out, 'build.log');
    const plain = join(out, 'main.js');
    // Metro's cache does not know which edition a file was transformed for: the
    // default edition's cached copy would be used again. Another edition keeps its own.
    const cache = other ? join(out, 'metro-cache') : undefined;
    if (cache) mkdirSync(cache, { recursive: true });
    const env = {
      ...nativeBuildEnvironment('bundled'),
      ...(other ? { EXPO_PUBLIC_SOVRAN_EDITION: other.edition, TMPDIR: cache } : {}),
    };
    try {
      await step(
        'expo export:embed (ios)',
        'node',
        [
          require.resolve('expo/bin/cli'),
          'export:embed',
          '--entry-file',
          join(APP_DIR, 'index.js'),
          '--platform',
          'ios',
          '--dev',
          'false',
          '--minify',
          'false',
          '--bundle-output',
          plain,
          '--assets-dest',
          stamp.artifact,
        ],
        APP_DIR,
        env,
        log
      );
      await step(
        'hermesc',
        hermesCompiler(),
        ['-emit-binary', '-O', '-out', join(stamp.artifact, 'main.jsbundle'), plain],
        APP_DIR,
        env,
        log
      );
    } finally {
      rmSync(plain, { force: true });
      if (cache) rmSync(cache, { recursive: true, force: true });
    }
    await step(
      'codesign',
      'codesign',
      ['--force', '--sign', '-', '--preserve-metadata=entitlements', stamp.artifact],
      APP_DIR,
      env,
      log
    );
    return {
      ...stamp,
      gitSha: git(['rev-parse', 'HEAD']),
      gitDirty: git(['status', '--porcelain']).length > 0,
      builtAt: new Date().toISOString(),
      artifactSha256: nativeArtifactHash(stamp.artifact),
    };
  });
}

/**
 * The bundled iOS test build with another edition's JavaScript in it
 * (ADR 0021): a copy beside it, `ios-bundled-<edition>`, for the stories about
 * pages the default edition leaves out. The native part is the same app.
 */
async function bundledEdition(edition: string): Promise<NativeBuildStamp> {
  const stamp = readStamp('ios', 'bundled');
  if (!stamp) throw new Error('Build the bundled test build first: native-build.ts ios --bundled');
  const out = join(NATIVE_BUILDS, `ios-bundled-${edition}`);
  const artifact = join(out, 'Sovran.app');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(stamp.artifact, artifact, { recursive: true });
  const made = await refreshBundledJavaScript({ ...stamp, artifact }, { out, edition });
  writeFileSync(join(out, 'build.json'), `${JSON.stringify({ ...made, edition }, null, 2)}\n`);
  return made;
}

/** Reuse a stamped build whose fingerprint matches current source, else rebuild. */
export async function ensureNativeBuild(
  platform: Platform,
  policy: RebuildPolicy = 'auto',
  kind: BuildKind = 'dev'
): Promise<NativeBuildStamp> {
  const fingerprint = await nativeFingerprint(platform, kind);
  const stamp = readStamp(platform, kind);
  const nativeCurrent =
    stamp?.fingerprint === fingerprint &&
    existsSync(stamp.artifact) &&
    Boolean(stamp.artifactSha256) &&
    nativeArtifactHash(stamp.artifact) === stamp.artifactSha256;
  const current = nativeCurrent && (kind === 'dev' || bundledJavaScriptIsCurrent(stamp));
  if (current && policy !== 'force') {
    console.log(
      `${platform}: reusing native build ${stamp.appVersion} (${stamp.buildNumber}) from ${stamp.builtAt}`
    );
    return stamp;
  }
  if (nativeCurrent && platform === 'ios' && kind === 'bundled' && policy !== 'force') {
    console.log(`${platform}: native part unchanged; replacing the JavaScript inside the build`);
    const refreshed = await refreshBundledJavaScript(stamp);
    writeStamp(refreshed);
    return refreshed;
  }
  if (policy === 'never')
    throw new Error(
      `${platform}: no native build matches the current fingerprint ${fingerprint.slice(0, 12)}; rerun without --rebuild never`
    );
  console.log(
    `${platform}: ${stamp ? 'native inputs changed' : 'no stamped native build'}; building locally (this takes a while)`
  );
  const built = await withStableBuildSource(ROOT, () =>
    platform === 'ios' ? buildIos(fingerprint, kind) : buildAndroid(fingerprint, kind)
  );
  // Source must not change under the build, or the stamp would lie.
  if ((await nativeFingerprint(platform, kind)) !== fingerprint)
    throw new Error(`${platform}: native inputs changed during the build; rerun once edits settle`);
  built.artifactSha256 = nativeArtifactHash(built.artifact);
  writeStamp(built);
  return built;
}

if (import.meta.main) {
  try {
    const [platform, ...flags] = process.argv.slice(2);
    const kind: BuildKind = flags.includes('--bundled') ? 'bundled' : 'dev';
    const editionAt = flags.indexOf('--edition');
    const edition = editionAt === -1 ? undefined : flags[editionAt + 1];
    const [flag] = flags.filter(
      (value, index) => value !== '--bundled' && index !== editionAt && index !== editionAt + 1
    );
    if (platform !== 'ios' && platform !== 'android')
      throw new Error(
        'Usage: bun app/e2e/press/native-build.ts ios|android [--bundled [--edition full]] [--force|--status]'
      );
    if (edition !== undefined) {
      if (platform !== 'ios' || kind !== 'bundled' || flag !== undefined)
        throw new Error('--edition goes with `ios --bundled` and nothing else');
      await ensureNativeBuild('ios', 'auto', 'bundled');
      console.log(JSON.stringify(await bundledEdition(edition), null, 2));
    } else if (flag === '--status') {
      const fingerprint = await nativeFingerprint(platform, kind);
      const stamp = readStamp(platform, kind);
      console.log(
        JSON.stringify(
          {
            fingerprint,
            stamp,
            current:
              stamp?.fingerprint === fingerprint &&
              Boolean(stamp?.artifactSha256) &&
              nativeArtifactHash(stamp!.artifact) === stamp!.artifactSha256 &&
              (kind === 'dev' || bundledJavaScriptIsCurrent(stamp!)),
          },
          null,
          2
        )
      );
    } else {
      if (flag !== undefined && flag !== '--force') throw new Error('Choose --force or --status');
      const stamp = await ensureNativeBuild(platform, flag === '--force' ? 'force' : 'auto', kind);
      console.log(JSON.stringify(stamp, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Native build failed');
    process.exitCode = 1;
  }
}
