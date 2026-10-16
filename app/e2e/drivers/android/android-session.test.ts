import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { SimulatorInfrastructureError } from '../simulator-session';
import { Adb } from './adb';
import {
  androidFailureText,
  assertOwnedAndroidAvdSafe,
  ANDROID_BOOT_MIN_FREE_BYTES,
  waitForAndroidDiskSpace,
  buildEmulatorLaunchArgs,
  buildOwnedAndroidEmulatorEnv,
  createOwnedAndroidAvd,
  EMULATOR_BOOT_TIMEOUT_MS,
  installOwnedAndroidApp,
  isOwnedAndroidAvdMetadata,
  ownedAndroidAvdName,
  ownedAndroidAvdRootPrefix,
  prepareAndroidCapture,
  prepareEmulator,
  removeOwnedAndroidAvd,
  runAndroidInstallAsInfrastructure,
  throwIfAndroidInfrastructureUnavailable,
  withAndroidEmulatorSession,
} from './android-session';

it.each([
  'success',
  'root reply lost',
  'note write',
  'unroot',
  'cancel after root',
  'receipt write',
  'readiness failure',
  'wrong device',
  'cancel and unroot',
  'receipt and unroot',
])('bundled session restores privileges and preserves launch-once: %s', async (fault) => {
  const parent = mkdtempSync(join(tmpdir(), 'bundled-session-'));
  const calls: string[] = [];
  const note = { run: 'session-test', url: 'ws://127.0.0.1:40123' };
  const receipt = join(parent, 'provisioning.json');
  let uid = '2000';
  let disposed = false;
  const handlers = new Map<string, () => void>();
  class Device extends Adb {
    readonly runSignal?: AbortSignal;
    constructor(options: ConstructorParameters<typeof Adb>[0]) {
      super(options);
      this.runSignal = options.signal;
    }
    override async raw(args: string[]): Promise<string> {
      this.runSignal?.throwIfAborted();
      const command = args.join(' ');
      calls.push(command);
      if (command === 'root') {
        uid = '0';
        if (fault === 'root reply lost') throw new Error('injected root reply loss');
        if (fault.startsWith('cancel')) handlers.get('SIGTERM')?.();
        if (fault.startsWith('receipt')) {
          rmSync(receipt);
          mkdirSync(receipt);
        }
      }
      if (command === 'unroot') {
        if (fault.includes('unroot')) throw new Error('injected unroot failure');
        uid = '2000';
      }
      if (fault === 'note write' && command.startsWith('shell mkdir'))
        throw new Error('injected note write failure');
      if (command === 'shell id -u') return uid;
      if (command === 'shell getenforce') return 'Enforcing';
      if (command.startsWith('shell stat -c')) return '10150:10150';
      if (command.startsWith('shell ls -Zd'))
        return 'u:object_r:app_data_file:s0:c150,c256,c512,c768';
      if (command.startsWith('shell cat ')) return JSON.stringify(note);
      if (command === 'shell settings get global airplane_mode_on') return '0';
      if (command.startsWith('shell monkey')) expect(uid).toBe('2000');
      return '';
    }
  }
  try {
    let failure: unknown;
    try {
      await withAndroidEmulatorSession(
        {
          runId: note.run,
          runDir: parent,
          application: { kind: 'bundled', apk: '/fixture/app.apk' },
          onLifecycle: () => {},
        },
        async (session) => {
          expect(session.runtime).toEqual({ kind: 'bundled' });
          await session.install('erase', () => session.writeRunnerNote(note, receipt));
          if (fault === 'readiness failure') throw new Error('injected missing app hello');
        },
        {
          signals: {
            on: (name, callback) => {
              handlers.set(name, callback);
            },
            off: (name) => {
              handlers.delete(name);
            },
          },
          startMetro: async () => {
            throw new Error('Bundled session attempted to start Metro');
          },
          createAdb: (options) => new Device({ ...options, bin: '/unused-fake-adb' }),
          boot: async (options) => {
            expect(options.kind).toBe('bundled');
            return {
              serial: 'emulator-5554',
              consolePort: 5554,
              avd: 'owned-fixture',
              avdRoot: parent,
              logPath: join(parent, 'emulator.log'),
              assertRunningAndOwned: async () => {
                if (fault === 'wrong device') throw new Error('serial belongs to another AVD');
                return 'owned-fixture';
              },
              dispose: async () => {
                disposed = true;
              },
            };
          },
        }
      );
    } catch (error) {
      failure = error;
    }
    if (fault === 'success' || fault === 'readiness failure') {
      if (fault === 'success') expect(failure).toBeUndefined();
      else expect(String(failure)).toContain('missing app hello');
      expect(calls.filter((call) => call.startsWith('shell monkey'))).toEqual([
        'shell monkey -p com.sovranbitcoin.dev -c android.intent.category.LAUNCHER 1',
      ]);
      expect(calls.indexOf('unroot')).toBeLessThan(
        calls.findIndex((call) => call.startsWith('shell monkey'))
      );
    } else {
      expect(failure).toBeDefined();
      expect(calls.some((call) => call.startsWith('shell monkey'))).toBe(false);
    }
    expect(
      calls.some(
        (call) =>
          call.includes('pm grant') ||
          call.includes('run-as') ||
          call.includes('expo-development-client')
      )
    ).toBe(false);
    expect(uid).toBe(fault.includes('unroot') ? '0' : '2000');
    if (fault.includes('unroot'))
      expect(androidFailureText(failure)).toContain('injected unroot failure');
    if (fault.startsWith('cancel')) expect(androidFailureText(failure)).toContain('SIGTERM');
    if (fault.startsWith('receipt')) expect(androidFailureText(failure)).toContain('EISDIR');
    expect(disposed).toBe(true);
    expect(handlers.size).toBe(0);
    if (fault === 'wrong device') {
      expect(calls).toEqual([]);
      expect(existsSync(receipt)).toBe(false);
      return;
    }
    if (fault.startsWith('receipt')) {
      expect(failure).toBeDefined();
      return;
    }
    const evidence = JSON.parse(readFileSync(receipt, 'utf8'));
    if (fault === 'success' || fault === 'readiness failure') expect(evidence.failures).toEqual([]);
    else
      expect(evidence.failures.join(' ')).toContain(
        fault.startsWith('cancel')
          ? 'SIGTERM'
          : `injected ${fault === 'root reply lost' ? 'root reply loss' : fault + ' failure'}`
      );
    if (!fault.includes('unroot'))
      expect(evidence.observations).toContainEqual({ step: 'unroot-uid', output: '2000' });
    if (fault === 'success')
      expect(evidence.observations).toContainEqual({ step: 'note-readback', output: 'matched' });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

describe('Android capture profile', () => {
  async function captureAdb(overrides: Record<string, string | undefined> = {}) {
    const calls: string[][] = [];
    const png = await sharp({
      create: { width: 1080, height: 2400, channels: 3, background: 'black' },
    })
      .png()
      .toBuffer();
    const responses: Record<string, string | undefined> = {
      'wm density': 'Physical density: 320\nOverride density: 420',
      'settings get system font_scale': '1',
      'settings get global animator_duration_scale': '0.0',
      'cmd uimode night': 'Night mode: no',
      'cmd activity get-config': 'config: en-rUS-ldltr-sw411dp',
      ...overrides,
    };
    return {
      calls,
      shell: async (args: string[]) => {
        calls.push(args);
        return responses[args.join(' ')] ?? '';
      },
      screenSize: async () => ({ width: 1080, height: 2400 }),
      screencapPng: async () => png,
      getprop: async (name: string) =>
        ({
          'ro.product.model': 'sdk_gphone64_arm64',
          'ro.build.version.release': '16',
          'ro.build.fingerprint': 'pinned-image-build',
        })[name] ?? '',
    };
  }

  it('never lets store-suite dimensions override the library profile and records effective configuration', async () => {
    const adb = await captureAdb();
    const metadata = await prepareAndroidCapture(adb, {
      captureProfile: 'library-v1',
      storeScreenshots: true,
    });
    expect(adb.calls).toContainEqual(['wm', 'size', '1080x2400']);
    expect(adb.calls).not.toContainEqual(['wm', 'size', '1080x1920']);
    expect(adb.calls).toContainEqual(['settings', 'put', 'global', 'animator_duration_scale', '0']);
    expect(metadata).toMatchObject({
      profile: 'library-v1',
      model: 'sdk_gphone64_arm64',
      runtime: '16',
      resolution: { width: 1080, height: 2400 },
      density: { dpi: 420 },
      motion: 'reduced',
      locale: 'en-US',
      fontScale: 1,
      appearance: 'light',
    });
  });

  it('preserves ordinary and legacy store defaults when the profile is absent', async () => {
    const adb = await captureAdb();
    expect(await prepareAndroidCapture(adb, {})).toBeUndefined();
    expect(adb.calls).toEqual([]);
    await prepareAndroidCapture(adb, { storeScreenshots: true });
    expect(adb.calls).toEqual([
      ['wm', 'size', '1080x1920'],
      ['wm', 'density', '320'],
    ]);
    expect(adb.calls.some((call) => call.includes('animator_duration_scale'))).toBe(false);
  });

  it('keeps the display awake, so a long wait cannot turn a capture black', async () => {
    const adb = await captureAdb();
    await prepareEmulator({ ...adb, setAirplaneMode: async () => {} } as unknown as Parameters<
      typeof prepareEmulator
    >[0]);
    const timeout = adb.calls.find(
      (call) => call[0] === 'settings' && call[3] === 'screen_off_timeout'
    );
    expect(timeout?.at(-1)).toBe('2147483647');
    expect(adb.calls).toContainEqual(['svc', 'power', 'stayon', 'true']);
  });

  it.each([
    { 'wm density': 'Physical density: 420\nOverride density: 320' },
    { 'settings get system font_scale': '1.2' },
    { 'settings get global animator_duration_scale': '1.0' },
    { 'cmd uimode night': 'Night mode: yes' },
    { 'cmd activity get-config': 'config: fr-rFR-ldltr-sw411dp' },
  ])('rejects effective settings mismatch %j', async (override) => {
    await expect(
      prepareAndroidCapture(await captureAdb(override), { captureProfile: 'library-v1' })
    ).rejects.toThrow(/presentation profile unmet/);
  });
});

describe('owned Android emulator AVD', () => {
  it('allows factory-fresh first-boot provisioning to exceed three minutes', () => {
    expect(EMULATOR_BOOT_TIMEOUT_MS).toBeGreaterThanOrEqual(300_000);
  });

  it('launches only by its unique private AVD name', () => {
    const args = buildEmulatorLaunchArgs({
      emulator: '/sdk/emulator',
      avdName: 'Sovran_E2E_Test1234',
      consolePort: 5560,
    });

    const avdIndex = args.indexOf('-avd');
    expect(args.slice(avdIndex, avdIndex + 2)).toEqual(['-avd', 'Sovran_E2E_Test1234']);
    expect(args).toContain('-wipe-data');
    expect(args).toContain('-no-cache');
    expect(args).toContain('-no-snapstorage');
    expect(args).not.toContain('-data');
    expect(args).not.toContain('-datadir');
    expect(args.join(' ')).not.toContain('Medium_Phone');
    expect(args.join(' ')).not.toContain('.android/avd');
  });

  it('derives the owned AVD name from the exact session run id', () => {
    expect(ownedAndroidAvdName('2026-07-21T02-00-00-000Z-12345678-01')).toBe(
      'Sovran_E2E_00000Z1234567801'
    );
    expect(ownedAndroidAvdName('2026-07-21T02-00-00-000Z-12345678-02')).not.toBe(
      ownedAndroidAvdName('2026-07-21T02-00-00-000Z-12345678-01')
    );
  });

  it('proves recorded ownership only for the exact run-bound private root', () => {
    const runId = '2026-07-21T02-00-00-000Z-12345678-01';
    const avd = ownedAndroidAvdName(runId);
    const temporaryParent = realpathSync(tmpdir());
    expect(
      isOwnedAndroidAvdMetadata({
        runId,
        avd,
        avdRoot: join(temporaryParent, `${ownedAndroidAvdRootPrefix(runId)}ABC123`),
      })
    ).toBe(true);
    expect(
      isOwnedAndroidAvdMetadata({
        runId,
        avd: ownedAndroidAvdName(`${runId}-other`),
        avdRoot: join(temporaryParent, `${ownedAndroidAvdRootPrefix(runId)}ABC123`),
      })
    ).toBe(false);
    expect(
      isOwnedAndroidAvdMetadata({
        runId,
        avd,
        avdRoot: join(homedir(), '.android', 'sovran-e2e-android-avd-shared'),
      })
    ).toBe(false);
    expect(
      isOwnedAndroidAvdMetadata({
        runId,
        avd,
        avdRoot: join(homedir(), 'shared', 'sovran-e2e-android-avd-shared'),
      })
    ).toBe(false);
    expect(
      isOwnedAndroidAvdMetadata({
        runId,
        avd,
        avdRoot: '/opt/persistent/sovran-e2e-android-avd-shared',
      })
    ).toBe(false);
  });

  it('generates an isolated descriptor and config with private permissions', () => {
    const parent = mkdtempSync(join(tmpdir(), 'sovran-e2e-android-session-test-'));
    try {
      const owned = createOwnedAndroidAvd({ parent, uniqueId: 'test-owned-01' });
      const descriptor = readFileSync(owned.descriptorPath, 'utf8');
      const config = readFileSync(owned.configPath, 'utf8');

      expect(owned.avdName).toBe('Sovran_E2E_testowned01');
      expect(statSync(owned.root).mode & 0o777).toBe(0o700);
      expect(statSync(owned.contentDir).mode & 0o777).toBe(0o700);
      expect(statSync(owned.descriptorPath).mode & 0o777).toBe(0o600);
      expect(statSync(owned.configPath).mode & 0o777).toBe(0o600);
      for (const path of [owned.root, owned.contentDir, owned.descriptorPath, owned.configPath]) {
        expect(lstatSync(path).isSymbolicLink()).toBe(false);
      }
      expect(descriptor).toContain(`path=${owned.contentDir}`);
      expect(`${descriptor}\n${config}`).not.toMatch(
        /(?:\.android\/avd|Medium_Phone|userdata|snapshot|\bdata(?:dir)?=)/i
      );
      expect(config).toContain(
        'image.sysdir.1=system-images/android-36.1/google_apis_playstore/arm64-v8a/'
      );
      expect(() => assertOwnedAndroidAvdSafe(owned)).not.toThrow();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('scopes emulator discovery to the owned root', () => {
    const parent = mkdtempSync(join(tmpdir(), 'sovran-e2e-android-session-test-'));
    try {
      const owned = createOwnedAndroidAvd({ parent, uniqueId: 'env-owned-01' });
      const env = buildOwnedAndroidEmulatorEnv(owned, '/sdk', {
        ANDROID_AVD_HOME: '/shared/avds',
        KEEP_ME: 'yes',
        OMIT_ME: undefined,
      });

      expect(env.ANDROID_AVD_HOME).toBe(owned.root);
      expect(env.ANDROID_HOME).toBe('/sdk');
      expect(env.ANDROID_SDK_ROOT).toBe('/sdk');
      expect(env.KEEP_ME).toBe('yes');
      expect(env).not.toHaveProperty('OMIT_ME');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('creates a private AOSP device for bundled apps without changing development defaults', () => {
    const parent = mkdtempSync(join(tmpdir(), 'sovran-e2e-bundled-avd-'));
    try {
      const owned = createOwnedAndroidAvd({
        parent,
        uniqueId: 'bundled-owned-01',
        kind: 'bundled',
      });
      const config = readFileSync(owned.configPath, 'utf8');
      expect(config).toContain('image.sysdir.1=system-images/android-36/default/arm64-v8a/');
      expect(config).toContain('PlayStore.enabled=false');
      expect(config).toContain('tag.id=default');
      expect(readFileSync(owned.descriptorPath, 'utf8')).toContain('target=android-36\n');
      expect(() => assertOwnedAndroidAvdSafe(owned)).not.toThrow();
      removeOwnedAndroidAvd(owned);
      expect(existsSync(owned.root)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('keeps emulator temporary files inside the owned root', () => {
    const parent = mkdtempSync(join(tmpdir(), 'sovran-e2e-android-session-test-'));
    const inheritedSpillPath = '/private/tmp/android-kelbie/shared';
    try {
      const owned = createOwnedAndroidAvd({ parent, uniqueId: 'temp-owned-01' });
      const env = buildOwnedAndroidEmulatorEnv(owned, '/sdk', {
        ANDROID_TMP: inheritedSpillPath,
        TMPDIR: inheritedSpillPath,
      });

      expect(env.ANDROID_TMP).toStartWith(`${owned.root}/`);
      expect(env.TMPDIR).toBe(env.ANDROID_TMP);
      expect(env.ANDROID_TMP).not.toBe(inheritedSpillPath);
      expect(realpathSync(env.ANDROID_TMP)).toBe(env.ANDROID_TMP);
      expect(statSync(env.ANDROID_TMP).mode & 0o777).toBe(0o700);

      writeFileSync(join(env.ANDROID_TMP, 'emulator-owned.qcow2'), 'owned scratch');
      removeOwnedAndroidAvd(owned);
      expect(existsSync(owned.root)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('fails closed when an authored AVD path becomes a symlink', () => {
    const parent = mkdtempSync(join(tmpdir(), 'sovran-e2e-android-session-test-'));
    try {
      const owned = createOwnedAndroidAvd({ parent, uniqueId: 'symlink-owned-01' });
      const target = join(owned.contentDir, 'target.ini');
      writeFileSync(target, readFileSync(owned.configPath));
      rmSync(owned.configPath);
      symlinkSync(target, owned.configPath);

      expect(() => assertOwnedAndroidAvdSafe(owned)).toThrow('must not be a symlink');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('fails closed when config names shared or persistent state', () => {
    const parent = mkdtempSync(join(tmpdir(), 'sovran-e2e-android-session-test-'));
    try {
      const owned = createOwnedAndroidAvd({ parent, uniqueId: 'shared-ref-01' });
      writeFileSync(
        owned.configPath,
        `${readFileSync(owned.configPath, 'utf8')}userdata.path=/tmp/shared.img\n`
      );

      expect(() => assertOwnedAndroidAvdSafe(owned)).toThrow(
        'contains a shared or persistent-data reference'
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('removes only the exact owned root and leaves siblings intact', () => {
    const parent = mkdtempSync(join(tmpdir(), 'sovran-e2e-android-session-test-'));
    const sibling = join(parent, 'keep');
    mkdirSync(sibling);
    try {
      const owned = createOwnedAndroidAvd({ parent, uniqueId: 'remove-owned-01' });

      removeOwnedAndroidAvd(owned);

      expect(existsSync(owned.root)).toBe(false);
      expect(existsSync(sibling)).toBe(true);
      expect(() => removeOwnedAndroidAvd({ ...owned, root: parent })).toThrow(
        'refusing to remove unowned Android AVD root'
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

function fakeLifecycleAdb(calls: string[]) {
  return {
    async forceStop() {
      calls.push('forceStop');
    },
    async uninstall() {
      calls.push('uninstall');
    },
    async install(apkPath: string) {
      calls.push(`install:${apkPath}`);
    },
    async pmGrant(permission: string) {
      calls.push(`grant:${permission}`);
    },
    async shell() {
      calls.push('suppress-dev-menu');
      return '';
    },
    async openUrl() {
      calls.push('openUrl');
    },
    async uiautomatorDumpXml() {
      calls.push('dump');
      return '<hierarchy><node package="com.sovranbitcoin.dev" text="Sovran" /></hierarchy>';
    },
  };
}

describe('owned Android app lifecycle', () => {
  it('prepares the installed app once before any launch, including launch recovery', async () => {
    const calls: string[] = [];
    const adb = fakeLifecycleAdb(calls);
    let prepared = 0;
    let launches = 0;
    adb.openUrl = async () => {
      expect(prepared).toBe(1);
      launches++;
    };
    adb.uiautomatorDumpXml = async () =>
      launches === 1 ? '' : '<node package="com.sovranbitcoin.dev" />';
    await installOwnedAndroidApp({
      adb,
      reset: 'erase',
      apkPath: '/build/app-debug.apk',
      metroUrl: 'http://localhost:8081',
      onLifecycle: () => undefined,
      wait: async () => undefined,
      beforeLaunch: async () => {
        expect(calls).toContain('install:/build/app-debug.apk');
        expect(calls).toContain('suppress-dev-menu');
        prepared++;
      },
    });
    expect(launches).toBe(2);
    expect(prepared).toBe(1);
  });

  for (const reset of ['erase', 'reinstall'] as const) {
    it(`${reset} installs the dev client into an initially empty data image`, async () => {
      const calls: string[] = [];
      await installOwnedAndroidApp({
        adb: fakeLifecycleAdb(calls),
        reset,
        apkPath: '/build/app-debug.apk',
        metroUrl: 'http://localhost:8081',
        onLifecycle: () => undefined,
        wait: async () => undefined,
      });

      expect(calls.slice(0, 3)).toEqual(['forceStop', 'uninstall', 'install:/build/app-debug.apk']);
      expect(calls.at(-2)).toBe('openUrl');
      expect(calls.at(-1)).toBe('dump');
    });
  }

  it('a no-reset launch does not reinstall the app', async () => {
    const calls: string[] = [];
    await installOwnedAndroidApp({
      adb: fakeLifecycleAdb(calls),
      reset: 'none',
      apkPath: '/build/app-debug.apk',
      metroUrl: 'http://localhost:8081',
      onLifecycle: () => undefined,
      wait: async () => undefined,
    });

    expect(calls).not.toContain('uninstall');
    expect(calls.some((call) => call.startsWith('install:'))).toBe(false);
    expect(calls[0]).toBe('forceStop');
  });

  it('does not launch when installed-app preparation fails', async () => {
    const calls: string[] = [];
    await expect(
      installOwnedAndroidApp({
        adb: fakeLifecycleAdb(calls),
        reset: 'erase',
        apkPath: '/build/app-debug.apk',
        metroUrl: 'http://localhost:8081',
        onLifecycle: () => undefined,
        wait: async () => undefined,
        beforeLaunch: async () => {
          throw new Error('installed payload mismatch');
        },
      })
    ).rejects.toThrow('installed payload mismatch');
    expect(calls).not.toContain('openUrl');
  });

  it('promotes install loss to a terminal infrastructure failure', async () => {
    let reported: SimulatorInfrastructureError | undefined;

    await expect(
      runAndroidInstallAsInfrastructure(
        async () => {
          throw new Error('INSTALL_FAILED_INSUFFICIENT_STORAGE');
        },
        (error) => {
          reported = error;
        }
      )
    ).rejects.toThrow('android app lifecycle unavailable');

    expect(reported).toBeInstanceOf(SimulatorInfrastructureError);
    const abort = new AbortController();
    abort.abort(reported);
    expect(() => throwIfAndroidInfrastructureUnavailable(abort.signal)).toThrow(reported);
  });

  it('does not mistake ordinary session completion for infrastructure loss', () => {
    const abort = new AbortController();
    abort.abort(new Error('android session complete'));
    expect(() => throwIfAndroidInfrastructureUnavailable(abort.signal)).not.toThrow();
  });
});

it('reopens the dev client when Android is still showing its home launcher', async () => {
  const calls: string[] = [];
  const adb = fakeLifecycleAdb(calls);
  let dumps = 0;
  adb.uiautomatorDumpXml = async () =>
    ++dumps === 1
      ? '<hierarchy><node package="com.google.android.apps.nexuslauncher" text="Sovran" /></hierarchy>'
      : '<hierarchy><node package="com.sovranbitcoin.dev" resource-id="tab-wallet" /></hierarchy>';
  await installOwnedAndroidApp({
    adb,
    reset: 'none',
    apkPath: '/build/app-debug.apk',
    metroUrl: 'http://localhost:8081',
    onLifecycle: () => undefined,
    wait: async () => undefined,
  });
  expect(calls.filter((call) => call === 'openUrl')).toHaveLength(2);
});

it('does not restart a bundle download already visible in the app window', async () => {
  const calls: string[] = [];
  const adb = fakeLifecycleAdb(calls);
  adb.uiautomatorDumpXml = async () =>
    '<hierarchy><node package="com.sovranbitcoin.dev" text="Downloading JavaScript bundle" /></hierarchy>';
  await installOwnedAndroidApp({
    adb,
    reset: 'none',
    apkPath: '/build/app-debug.apk',
    metroUrl: 'http://localhost:8081',
    onLifecycle: () => undefined,
    wait: async () => undefined,
  });
  expect(calls.filter((call) => call === 'openUrl')).toHaveLength(1);
});

it('waits for delayed disk reclamation and stops without booting if space never recovers', async () => {
  let reads = 0;
  let waits = 0;
  const signal = new AbortController().signal;
  await waitForAndroidDiskSpace(
    signal,
    () => {},
    () => (++reads === 1 ? 0 : ANDROID_BOOT_MIN_FREE_BYTES),
    async () => {
      waits++;
    }
  );
  expect(waits).toBe(1);
  await expect(
    waitForAndroidDiskSpace(
      signal,
      () => {},
      () => 0,
      async () => {}
    )
  ).rejects.toThrow(/7.3 GiB/);
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await expect(
    waitForAndroidDiskSpace(
      controller.signal,
      () => {},
      () => ANDROID_BOOT_MIN_FREE_BYTES
    )
  ).rejects.toThrow('cancelled');
});
