/**
 * The sole owner of real Android emulator resources for JSON-native E2E runs.
 * Mirrors simulator-session.ts: every session owns a unique Metro process and
 * a cold-booted emulator on an allocated console port, reached over
 * `adb reverse` so the SAME localhost dev-client URL works unchanged. Callers
 * get only a bound install operation plus a NetworkChannel; no arbitrary
 * device crosses this boundary. Airplane-mode restore is the highest-priority
 * cleanup — a leaked offline device would poison everything after it.
 */
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { NetworkChannel } from '../driver';
import type { E2EReadyProofAsset } from '../../../shared/lib/cashu/e2eProofReconciliationConfig';
import { APP_DIR, log, preparePrivateLog, run, sleep } from '../simctl';
import {
  SimulatorInfrastructureError,
  SimulatorRunInterrupted,
  startOwnedMetro,
  type RunSignal,
} from '../simulator-session';
import { Adb, adbBin, ANDROID_PACKAGE_ID, emulatorBin, resolveAndroidSdkRoot } from './adb';

type ResetMode = 'erase' | 'reinstall' | 'none';

/** The dev-client APK is a prebuilt gradle artifact, never built by the
 * harness (a gradle build mid-run would dwarf every scenario timeout).
 * APP_VARIANT=development is LOAD-BEARING: without it app.config.js emits the
 * PRODUCTION applicationId (com.sovranbitcoin), the APK silently installs
 * under the wrong package, and the harness keeps driving whatever stale
 * com.sovranbitcoin.dev build is already on the emulator. */
export function findInstallableApk(appDir = APP_DIR): string {
  const apk = join(appDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!existsSync(apk)) {
    throw new Error(
      `Android dev-client APK not found at ${apk} — run \`APP_VARIANT=development bun expo run:android\` once (JDK 17) to produce it`
    );
  }
  return apk;
}

/** Android dev clients register `exp+<slug>://` (spike-verified via dumpsys:
 * sovran, cashu, exp+sovran — NOT the iOS-style bundle-id scheme that
 * buildDevClientUrl emits), so the bundle URL rides the slug scheme here. */
function buildAndroidDevClientUrl(metroUrl: string, slug = 'sovran'): string {
  const url = new URL(`exp+${slug}://expo-development-client/`);
  url.searchParams.set('url', metroUrl);
  return url.toString();
}

/** Location grants mirror the iOS install's `simctl privacy grant location`. */
const DEFAULT_GRANTS = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
];

interface EmulatorBootOptions {
  runId: string;
  runDir: string;
  signal?: AbortSignal;
  onLifecycle?: (message: string) => void;
}

interface BootedEmulator {
  readonly serial: string;
  readonly consolePort: number;
  readonly avd: string;
  readonly avdRoot: string;
  readonly logPath: string;
  dispose(): Promise<void>;
}

const OWNED_AVD_ROOT_PREFIX = 'sovran-e2e-android-avd-';
const OWNED_AVD_NAME_PREFIX = 'Sovran_E2E_';
const E2E_SYSTEM_IMAGE = 'system-images/android-36.1/google_apis_playstore/arm64-v8a';
/** A factory-fresh image performs Android's first-boot provisioning and can
 * exceed the old 180s persistent-image budget, especially beside an iOS run. */
export const EMULATOR_BOOT_TIMEOUT_MS = 360_000;

function ownedAndroidAvdSuffix(uniqueId: string): string {
  const suffix = uniqueId.replace(/[^A-Za-z0-9]/g, '').slice(-16);
  if (!suffix) throw new Error('owned Android AVD id must contain an alphanumeric character');
  return suffix;
}

interface OwnedAndroidAvd {
  readonly parent: string;
  readonly root: string;
  readonly avdName: string;
  readonly contentDir: string;
  readonly tempDir: string;
  readonly descriptorPath: string;
  readonly configPath: string;
}

export function ownedAndroidAvdName(uniqueId: string): string {
  return `${OWNED_AVD_NAME_PREFIX}${ownedAndroidAvdSuffix(uniqueId)}`;
}

export function ownedAndroidAvdRootPrefix(uniqueId: string): string {
  return `${OWNED_AVD_ROOT_PREFIX}${ownedAndroidAvdSuffix(uniqueId)}-`;
}

/** Post-run proof for session metadata. The private root is deleted during
 * cleanup, so this validates the canonical path and run-bound name without
 * pretending the ephemeral directory should still exist. */
export function isOwnedAndroidAvdMetadata(metadata: {
  runId: string;
  avd: string;
  avdRoot: string;
}): boolean {
  const root = resolve(metadata.avdRoot);
  const temporaryParent = realpathSync(tmpdir());
  const userAndroid = resolve(homedir(), '.android');
  const expectedRootPrefix = ownedAndroidAvdRootPrefix(metadata.runId);
  return (
    isAbsolute(metadata.avdRoot) &&
    root === metadata.avdRoot &&
    dirname(root) === temporaryParent &&
    basename(root).startsWith(expectedRootPrefix) &&
    basename(root).length === expectedRootPrefix.length + 6 &&
    root !== userAndroid &&
    !isWithin(userAndroid, root) &&
    metadata.avd === ownedAndroidAvdName(metadata.runId)
  );
}

function ownedAvdConfig(avdName: string): string {
  return [
    `AvdId=${avdName}`,
    'PlayStore.enabled=true',
    'abi.type=arm64-v8a',
    `avd.ini.displayname=${avdName}`,
    'avd.ini.encoding=UTF-8',
    'disk.dataPartition.size=6G',
    'fastboot.forceColdBoot=yes',
    'fastboot.forceFastBoot=no',
    'hw.accelerometer=yes',
    'hw.audioInput=no',
    'hw.battery=yes',
    'hw.camera.back=virtualscene',
    'hw.camera.front=emulated',
    'hw.cpu.arch=arm64',
    'hw.cpu.ncore=4',
    'hw.dPad=no',
    'hw.device.manufacturer=Generic',
    'hw.device.name=pixel_7_pro',
    'hw.gps=yes',
    'hw.gpu.enabled=yes',
    'hw.gpu.mode=auto',
    'hw.gyroscope=yes',
    'hw.initialOrientation=portrait',
    'hw.keyboard=yes',
    'hw.lcd.density=420',
    'hw.lcd.height=2400',
    'hw.lcd.width=1080',
    'hw.mainKeys=no',
    'hw.ramSize=6144',
    // Emulated shared storage still lives inside the owned /data image. A
    // separate persistent sdcard image would add another state-leak seam.
    'hw.sdCard=no',
    'hw.sensors.light=yes',
    'hw.sensors.magnetic_field=yes',
    'hw.sensors.orientation=yes',
    'hw.sensors.pressure=yes',
    'hw.sensors.proximity=yes',
    'hw.trackBall=no',
    `image.sysdir.1=${E2E_SYSTEM_IMAGE}/`,
    'runtime.network.latency=none',
    'runtime.network.speed=full',
    'showDeviceFrame=no',
    'skin.dynamic=yes',
    'skin.name=1080x2400',
    'skin.path=1080x2400',
    'tag.display=Google Play',
    'tag.id=google_apis_playstore',
    'target=android-36.1',
    'vm.heapSize=768',
    '',
  ].join('\n');
}

/** Generate a complete AVD descriptor and content root from a sanitized
 * allowlist. No file or path is copied from ~/.android, so user-installed apps
 * and persistent emulator state can never enter the E2E device. */
export function createOwnedAndroidAvd(
  options: {
    parent?: string;
    uniqueId?: string;
  } = {}
): OwnedAndroidAvd {
  const parent = realpathSync(options.parent ?? tmpdir());
  const uniqueId = options.uniqueId ?? randomUUID();
  const root = realpathSync(mkdtempSync(join(parent, ownedAndroidAvdRootPrefix(uniqueId))));
  const avdName = ownedAndroidAvdName(uniqueId);
  const contentDir = join(root, `${avdName}.avd`);
  const tempDir = join(root, 'tmp');
  const descriptorPath = join(root, `${avdName}.ini`);
  const configPath = join(contentDir, 'config.ini');
  const owned = { parent, root, avdName, contentDir, tempDir, descriptorPath, configPath };
  try {
    chmodSync(root, 0o700);
    mkdirSync(contentDir, { mode: 0o700 });
    mkdirSync(tempDir, { mode: 0o700 });
    chmodSync(tempDir, 0o700);
    writeFileSync(
      descriptorPath,
      [
        'avd.ini.encoding=UTF-8',
        `path=${contentDir}`,
        `path.rel=${avdName}.avd`,
        'target=android-36.1',
        '',
      ].join('\n'),
      { mode: 0o600 }
    );
    writeFileSync(configPath, ownedAvdConfig(avdName), { mode: 0o600 });
    assertOwnedAndroidAvdSafe(owned);
    return owned;
  } catch (error) {
    try {
      removeOwnedAndroidAvd(owned);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'owned Android AVD creation failed and cleanup also failed'
      );
    }
    throw error;
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return (
    path !== '' &&
    path !== '..' &&
    !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(path)
  );
}

/** Pre-launch ownership fence. This is intentionally redundant with the
 * generator: a symlink swap or later refactor must fail before `-wipe-data`
 * can be evaluated by the emulator. */
export function assertOwnedAndroidAvdSafe(owned: OwnedAndroidAvd): void {
  const parent = realpathSync(owned.parent);
  if (lstatSync(owned.root).isSymbolicLink()) {
    throw new Error(`owned Android AVD path must not be a symlink: ${owned.root}`);
  }
  const root = realpathSync(owned.root);
  const userAndroid = resolve(homedir(), '.android');
  if (
    dirname(root) !== parent ||
    !basename(root).startsWith(OWNED_AVD_ROOT_PREFIX) ||
    root === userAndroid ||
    isWithin(userAndroid, root)
  ) {
    throw new Error(`unsafe owned Android AVD root: ${owned.root}`);
  }
  if (!owned.avdName.startsWith(OWNED_AVD_NAME_PREFIX)) {
    throw new Error(`unsafe owned Android AVD name: ${owned.avdName}`);
  }
  for (const path of [
    root,
    owned.contentDir,
    owned.tempDir,
    owned.descriptorPath,
    owned.configPath,
  ]) {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`owned Android AVD path must not be a symlink: ${path}`);
    }
    const resolved = realpathSync(path);
    if (resolved !== root && !isWithin(root, resolved)) {
      throw new Error(`owned Android AVD path escaped its root: ${path}`);
    }
  }
  if (
    realpathSync(owned.contentDir) !== join(root, `${owned.avdName}.avd`) ||
    realpathSync(owned.tempDir) !== join(root, 'tmp') ||
    realpathSync(owned.descriptorPath) !== join(root, `${owned.avdName}.ini`) ||
    realpathSync(owned.configPath) !== join(root, `${owned.avdName}.avd`, 'config.ini')
  ) {
    throw new Error('owned Android AVD layout does not match its unique name');
  }
  const authored = `${readFileSync(owned.descriptorPath, 'utf8')}\n${readFileSync(
    owned.configPath,
    'utf8'
  )}`;
  const forbiddenReference = authored.match(
    /(?:\.android\/avd|Medium_Phone|userdata|snapshot|\bdata(?:dir)?=)/i
  );
  if (forbiddenReference) {
    throw new Error(
      `owned Android AVD config contains a shared or persistent-data reference: ${forbiddenReference[0]}`
    );
  }
  if (!authored.includes(`path=${owned.contentDir}`)) {
    throw new Error('owned Android AVD descriptor does not resolve to its private content root');
  }
}

/** Remove only the exact direct-child root created above. Cleanup runs after
 * qemu exits, so no writable image handle can outlive the ownership fence. */
export function removeOwnedAndroidAvd(owned: OwnedAndroidAvd): void {
  const parent = realpathSync(owned.parent);
  if (lstatSync(owned.root).isSymbolicLink()) {
    throw new Error(`refusing to remove unowned Android AVD root: ${owned.root}`);
  }
  const root = realpathSync(owned.root);
  if (dirname(root) !== parent || !basename(root).startsWith(OWNED_AVD_ROOT_PREFIX)) {
    throw new Error(`refusing to remove unowned Android AVD root: ${owned.root}`);
  }
  rmSync(root, { recursive: true, force: true });
}

export function buildEmulatorLaunchArgs(options: {
  emulator: string;
  avdName: string;
  consolePort: number;
}): string[] {
  const { emulator, avdName, consolePort } = options;
  return [
    emulator,
    '-avd',
    avdName,
    '-port',
    String(consolePort),
    // Safe only because ANDROID_AVD_HOME resolves this unique name to the
    // generated E2E-owned content root. Never add -data or -datadir: with an
    // AVD name those flags can still fall through to the shared content dir.
    '-wipe-data',
    '-no-cache',
    '-no-snapstorage',
    '-no-snapshot',
    '-no-boot-anim',
    '-no-audio',
    '-no-window',
    // Generous RAM/cores: the default AVD (~2GB) OOM-kills the heavy dev
    // client (37MB JS bundle + coco + nostr) mid-setup, and the restart is
    // ruinous — the relaunched app process gets an ISOLATED storage mount
    // namespace that run-as no longer shares, so the clipboard bridge's
    // host→app writes stop surfacing (io heartbeat: setExists never flips).
    // Keeping one stable process keeps the namespace aligned and SET working.
    '-memory',
    '6144',
    '-cores',
    '4',
  ];
}

export function buildOwnedAndroidEmulatorEnv(
  owned: OwnedAndroidAvd,
  sdkRoot: string,
  inherited: Record<string, string | undefined> = process.env
): Record<string, string> {
  assertOwnedAndroidAvdSafe(owned);
  return {
    ...Object.fromEntries(
      Object.entries(inherited).filter((entry): entry is [string, string] => entry[1] !== undefined)
    ),
    ANDROID_HOME: sdkRoot,
    ANDROID_SDK_ROOT: sdkRoot,
    ANDROID_AVD_HOME: owned.root,
    ANDROID_TMP: owned.tempDir,
    TMPDIR: owned.tempDir,
  };
}

/** Even console ports 5554–5680; the serial is emulator-<port>. Collisions are
 * detected against `adb devices` (single-host runs; races are not a concern). */
async function allocateConsolePort(adb: string): Promise<number> {
  const devices = await run([adb, 'devices'], { allowFail: true });
  for (let port = 5554; port <= 5680; port += 2) {
    if (!devices.includes(`emulator-${port}`)) return port;
  }
  throw new Error('no free emulator console port in 5554–5680');
}

async function bootEmulator(options: EmulatorBootOptions): Promise<BootedEmulator> {
  const sdkRoot = resolveAndroidSdkRoot();
  const adb = adbBin(sdkRoot);
  const onLifecycle = options.onLifecycle ?? log;
  const consolePort = await allocateConsolePort(adb);
  const serial = `emulator-${consolePort}`;
  const logPath = join(options.runDir, 'emulator.log');
  preparePrivateLog(logPath);
  const systemImage = join(sdkRoot, E2E_SYSTEM_IMAGE, 'system.img');
  if (!existsSync(systemImage)) {
    throw new Error(
      `Android E2E system image not found at ${systemImage} — install ${E2E_SYSTEM_IMAGE}`
    );
  }
  const owned = createOwnedAndroidAvd({ uniqueId: options.runId });
  onLifecycle(
    `booting emulator ${owned.avdName} on ${serial} (factory-fresh private AVD, no snapshot, headless)`
  );
  // Headless by default: every evidence path rides adb (screencap/uiautomator),
  // and a visible window invites a desktop close that tears the session down
  // mid-run (observed: window close → graceful emulator shutdown).
  let child: ReturnType<typeof Bun.spawn>;
  try {
    // Re-check immediately before evaluating -wipe-data. This catches a
    // symlink swap or config mutation after generation, before qemu starts.
    assertOwnedAndroidAvdSafe(owned);
    child = Bun.spawn(
      buildEmulatorLaunchArgs({
        emulator: emulatorBin(sdkRoot),
        avdName: owned.avdName,
        consolePort,
      }),
      {
        stdout: Bun.file(logPath),
        stderr: Bun.file(logPath),
        stdin: 'ignore',
        env: buildOwnedAndroidEmulatorEnv(owned, sdkRoot),
      }
    );
  } catch (error) {
    try {
      removeOwnedAndroidAvd(owned);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'emulator launch failed and owned AVD cleanup also failed'
      );
    }
    throw error;
  }

  let disposePromise: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      await run([adb, '-s', serial, 'emu', 'kill'], { allowFail: true });
      const exited = await Promise.race([
        child.exited.then(() => true),
        sleep(15_000).then(() => false),
      ]);
      if (!exited) {
        child.kill('SIGKILL');
        await child.exited;
      }
      // The emulator process must release every qcow2 handle before its exact
      // owned directory is removed. The user's shared AVD is never touched.
      removeOwnedAndroidAvd(owned);
      onLifecycle(`emulator ${serial} shut down`);
    })();
    return disposePromise;
  };

  try {
    const deadline = Date.now() + EMULATOR_BOOT_TIMEOUT_MS;
    const probe = new Adb({ serial, bin: adb, signal: options.signal });
    let exitCode: number | undefined;
    void child.exited.then((code) => {
      exitCode = code;
    });
    while (true) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (exitCode !== undefined)
        throw new Error(`emulator exited with code ${exitCode} before boot (see ${logPath})`);
      if (Date.now() > deadline)
        throw new Error(
          `emulator ${serial} did not boot within ${EMULATOR_BOOT_TIMEOUT_MS / 1000}s`
        );
      if (await probe.bootCompleted()) break;
      await sleep(2_000);
    }
    return {
      serial,
      consolePort,
      avd: owned.avdName,
      avdRoot: owned.root,
      logPath,
      dispose,
    };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `emulator boot failed and cleanup also failed`
      );
    }
    throw error;
  }
}

/** Determinism prep: animation scales pinned to 1 and SysUI demo mode for a
 * fixed status bar — the Android analog of the iOS session's
 * `simctl status_bar override`.
 *
 * Scales must be 1, never 0: Android reports a 0 animator/transition scale as
 * REDUCE MOTION, which makes Reanimated complete every withTiming instantly —
 * product behavior visibly diverges (the onboarding carousel chain-skipped to
 * its last slide before flow.onboard could see slide 1). The scales persist
 * in the AVD's userdata, so pin them explicitly rather than trusting
 * defaults. */
async function prepareEmulator(adb: Adb): Promise<void> {
  await adb.setAirplaneMode(false); // known-good baseline, whatever the AVD persisted
  for (const scale of [
    'window_animation_scale',
    'transition_animation_scale',
    'animator_duration_scale',
  ]) {
    await adb.shell(['settings', 'put', 'global', scale, '1']);
  }
  // Turn device location fully ON (high accuracy) so the app's location
  // request does not trigger GMS's "Location Accuracy" resolution dialog,
  // which would steal the top window and hide the whole app tree from
  // uiautomator. The driver still dismisses the dialog defensively if it
  // slips through (Google-account consent lives outside settings).
  await adb.shell(['settings', 'put', 'secure', 'location_mode', '3']);
  await adb.shell(['settings', 'put', 'global', 'sysui_demo_allowed', '1']);
  await adb.shell(
    ['am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'enter'],
    {
      allowFail: true,
    }
  );
  await adb.shell(
    [
      'am',
      'broadcast',
      '-a',
      'com.android.systemui.demo',
      '-e',
      'command',
      'clock',
      '-e',
      'hhmm',
      '0941',
    ],
    { allowFail: true }
  );
  await adb.shell(
    [
      'am',
      'broadcast',
      '-a',
      'com.android.systemui.demo',
      '-e',
      'command',
      'battery',
      '-e',
      'level',
      '100',
      '-e',
      'plugged',
      'false',
    ],
    { allowFail: true }
  );
}

/** The dev client's first-run "This is the developer menu… Continue" sheet
 * occludes the app and eats onboarding taps (the Android analog of the iOS
 * session's EXDevMenuIsOnboardingFinished plist write). The keys are the
 * Kotlin property names persisted by expo-dev-menu's DevMenuPreferences
 * delegate; showFab/showsAtLaunch are disabled too so no floating chrome
 * pollutes screenshots. Written via run-as (debug build) after every
 * erase/install, before launch. */
interface AndroidAppLifecycleAdb {
  forceStop(): Promise<void>;
  uninstall(): Promise<void>;
  install(apkPath: string): Promise<void>;
  pmGrant(permission: string): Promise<void>;
  shell(args: string[]): Promise<string>;
  openUrl(url: string): Promise<void>;
  uiautomatorDumpXml(): Promise<string>;
}

async function suppressDevMenuChrome(adb: Pick<AndroidAppLifecycleAdb, 'shell'>): Promise<void> {
  const xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <boolean name="isOnboardingFinished" value="true" />\n    <boolean name="showFab" value="false" />\n    <boolean name="showsAtLaunch" value="false" />\n</map>\n`;
  const encoded = Buffer.from(xml, 'utf8').toString('base64');
  await adb.shell([
    `echo '${encoded}' | base64 -d | run-as ${ANDROID_PACKAGE_ID} sh -c 'mkdir -p shared_prefs; cat > shared_prefs/expo.modules.devmenu.sharedpreferences.xml'`,
  ]);
}

/** The dev-launcher home screen's unmistakable copy. The bundle-loading
 * overlay must NOT match — re-firing the deep link mid-download restarts the
 * load and can live-lock the launch. */
const DEV_LAUNCHER_HOME = /DEVELOPMENT SERVERS|Fetch development servers|npx expo start/i;

export async function installOwnedAndroidApp(options: {
  adb: AndroidAppLifecycleAdb;
  reset: ResetMode;
  apkPath: string;
  metroUrl: string;
  onLifecycle: (message: string) => void;
  wait?: (ms: number) => Promise<void>;
}): Promise<void> {
  const { adb, reset, apkPath, metroUrl, onLifecycle, wait = sleep } = options;
  const devClientUrl = buildAndroidDevClientUrl(metroUrl);
  if (reset !== 'none') {
    onLifecycle(
      `${reset === 'reinstall' ? 'reinstalling' : 'installing fresh'} dev client from ${apkPath}`
    );
    await adb.forceStop();
    await adb.uninstall();
    await adb.install(apkPath);
  } else {
    await adb.forceStop();
  }
  if (reset !== 'none') {
    for (const permission of DEFAULT_GRANTS) {
      await adb.pmGrant(permission).catch(() => undefined);
    }
    await suppressDevMenuChrome(adb);
  }
  // Deep-link-first launch: the VIEW intent both starts the app and hands it
  // the bundle URL. A cold dev client can drop the deep link while it is
  // still initializing, which strands it on the dev-launcher home — detect
  // that exact state in the AX dump and re-fire with backoff.
  for (let attempt = 0; attempt < 6; attempt++) {
    await adb.openUrl(devClientUrl);
    await wait(4_000 + attempt * 2_000);
    const xml = await adb.uiautomatorDumpXml().catch(() => '');
    if (xml && !DEV_LAUNCHER_HOME.test(xml)) return;
    onLifecycle(
      `dev client still on launcher home — re-firing bundle deep link (${attempt + 1}/6)`
    );
  }
  throw new Error(
    'dev client never left the dev-launcher home — Metro bundle deep link not taking'
  );
}

function asAndroidInfrastructureError(error: unknown): SimulatorInfrastructureError {
  if (error instanceof SimulatorInfrastructureError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new SimulatorInfrastructureError(`android app lifecycle unavailable: ${detail}`, {
    cause: error,
  });
}

/** App installation and launch are session infrastructure: once uninstall has
 * happened, a failure leaves no package for this or any later scenario to
 * drive. Abort the session instead of emitting a cascade of false product
 * failures. */
export async function runAndroidInstallAsInfrastructure(
  operation: () => Promise<void>,
  report: (error: SimulatorInfrastructureError) => void
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const infrastructureError = asAndroidInfrastructureError(error);
    report(infrastructureError);
    throw infrastructureError;
  }
}

export function throwIfAndroidInfrastructureUnavailable(signal: AbortSignal): void {
  if (signal.aborted && signal.reason instanceof SimulatorInfrastructureError) {
    throw signal.reason;
  }
}

class AndroidNetworkChannel implements NetworkChannel {
  #adb: Adb;
  constructor(adb: Adb) {
    this.#adb = adb;
  }
  async set(mode: 'airplane' | 'online'): Promise<void> {
    await this.#adb.setAirplaneMode(mode === 'airplane');
  }
}

interface AndroidEmulatorSession {
  readonly serial: string;
  readonly avd: string;
  readonly avdRoot: string;
  readonly metroUrl: string;
  readonly metroPort: number;
  readonly metroPid: number;
  readonly adb: Adb;
  readonly network: NetworkChannel;
  reportInfrastructureFailure(error: Error): void;
  install(reset: ResetMode): Promise<void>;
}

interface SignalSource {
  on(signal: RunSignal, listener: () => void): void;
  off(signal: RunSignal, listener: () => void): void;
}

const processSignals: SignalSource = {
  on: (signal, listener) => process.on(signal, listener),
  off: (signal, listener) => process.off(signal, listener),
};

interface AndroidSessionDependencies {
  findApk?: typeof findInstallableApk;
  startMetro?: typeof startOwnedMetro;
  boot?: typeof bootEmulator;
  signals?: SignalSource;
}

export async function withAndroidEmulatorSession<T>(
  options: {
    runId: string;
    runDir: string;
    onLifecycle?: (message: string) => void;
    /** Funded sessions: the Metro spawns a private seed-export server (adb-
     * reversed so the emulator app can POST to the same 127.0.0.1 endpoint)
     * and declares the funded assets for in-app reconciliation. */
    onSeedExport?: (mnemonic: string) => void;
    fundedAssets?: readonly E2EReadyProofAsset[];
  },
  callback: (session: AndroidEmulatorSession, signal: AbortSignal) => Promise<T>,
  dependencies: AndroidSessionDependencies = {}
): Promise<T> {
  const findApk = dependencies.findApk ?? findInstallableApk;
  const startMetro = dependencies.startMetro ?? startOwnedMetro;
  const boot = dependencies.boot ?? bootEmulator;
  const signals = dependencies.signals ?? processSignals;
  const onLifecycle = options.onLifecycle ?? log;
  const abort = new AbortController();
  const cleanups: { priority: number; run: () => Promise<void> }[] = [];
  const cleanupErrors: unknown[] = [];
  let interrupted: SimulatorRunInterrupted | undefined;
  const handlers = new Map<RunSignal, () => void>();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    const handler = () => {
      interrupted ??= new SimulatorRunInterrupted(signal);
      abort.abort(interrupted);
    };
    handlers.set(signal, handler);
    signals.on(signal, handler);
  }

  let result: T | undefined;
  let failure: unknown;
  try {
    const apkPath = findApk();
    if (abort.signal.aborted) throw abort.signal.reason;
    const metro = await startMetro(options.runDir, abort.signal, {
      onLifecycle,
      ...(options.onSeedExport ? { onSeedExport: options.onSeedExport } : {}),
      ...(options.fundedAssets ? { fundedAssets: options.fundedAssets } : {}),
      // Android AX polls are uiautomator dumps (~1-3s each) and every step
      // carries a screenshot bracket, so fixture legs run several times
      // slower than on iOS. The 20s iOS slide pacing lets the onboarding
      // carousel finish all four slides before flow.onboard reaches its
      // slide-1 wait (the carousel does not loop) — park slides for 3
      // minutes so the first slide is still on screen whenever the leg
      // arrives; taps advance slides regardless.
      extraEnv: {
        EXPO_PUBLIC_E2E_ONBOARDING_SLIDE_MS: '180000',
        // UIAutomator evidence between taps is slower than iOS. Keep the
        // dev-mode triple-tap reachable without changing production timing.
        EXPO_PUBLIC_E2E_TRIPLE_TAP_WINDOW_MS: '180000',
      },
    });
    cleanups.push({ priority: 20, run: () => metro.stop() });
    const emulator = await boot({
      runId: options.runId,
      runDir: options.runDir,
      signal: abort.signal,
      onLifecycle,
    });
    cleanups.push({ priority: 10, run: () => emulator.dispose() });
    const adb = new Adb({
      serial: emulator.serial,
      bin: adbBin(resolveAndroidSdkRoot()),
      signal: abort.signal,
    });
    // Cleanups run AFTER the session-complete abort fires, and the shared
    // run() throws the abort reason before its allowFail check — so teardown
    // uses a signal-less adb, not the driver's signal-bound one. Airplane
    // restore outranks everything: run it FIRST even on failure so nothing
    // later (or a reused AVD) inherits a dead network.
    const cleanupAdb = new Adb({ serial: emulator.serial, bin: adbBin(resolveAndroidSdkRoot()) });
    cleanups.push({
      priority: 50,
      run: async () => {
        await cleanupAdb.setAirplaneMode(false).catch(() => undefined);
      },
    });
    cleanups.push({ priority: 30, run: () => cleanupAdb.reverseRemoveAll() });
    await prepareEmulator(adb);
    await adb.reverse(metro.port);
    // Funded sessions: reverse the seed-export server too, so the emulator
    // app's POST to http://127.0.0.1:<seedPort>/seed reaches the host server
    // (which validates a 127.0.0.1 origin — adb reverse preserves that).
    if (metro.seedExportPort) {
      await adb.reverse(metro.seedExportPort);
      onLifecycle(`adb reverse seed-export port ${metro.seedExportPort}`);
    }
    const session: AndroidEmulatorSession = {
      serial: emulator.serial,
      avd: emulator.avd,
      avdRoot: emulator.avdRoot,
      metroUrl: metro.url,
      metroPort: metro.port,
      metroPid: metro.pid,
      adb,
      network: new AndroidNetworkChannel(adb),
      reportInfrastructureFailure(error) {
        abort.abort(asAndroidInfrastructureError(error));
      },
      install: (reset) =>
        runAndroidInstallAsInfrastructure(
          () => installOwnedAndroidApp({ adb, reset, apkPath, metroUrl: metro.url, onLifecycle }),
          (error) => abort.abort(error)
        ),
    };
    result = await callback(session, abort.signal);
    throwIfAndroidInfrastructureUnavailable(abort.signal);
  } catch (error) {
    failure = error;
  } finally {
    abort.abort(interrupted ?? new Error('android session complete'));
    for (const cleanup of cleanups.sort((a, b) => b.priority - a.priority)) {
      try {
        await cleanup.run();
      } catch (error) {
        onLifecycle(`cleanup step failed: ${(error as Error).message}`);
        cleanupErrors.push(error);
      }
    }
    for (const [signal, handler] of handlers) signals.off(signal, handler);
  }

  if (interrupted) failure = interrupted;
  if (failure !== undefined && cleanupErrors.length)
    throw new AggregateError([failure, ...cleanupErrors], 'android run and cleanup failed');
  if (failure !== undefined) throw failure;
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, 'android emulator cleanup failed');
  return result as T;
}
