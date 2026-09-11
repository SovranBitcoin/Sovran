import { describe, expect, it } from 'bun:test';
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
import {
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
  removeOwnedAndroidAvd,
  runAndroidInstallAsInfrastructure,
  throwIfAndroidInfrastructureUnavailable,
} from './android-session';

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
