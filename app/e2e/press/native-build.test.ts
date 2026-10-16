import { describe, expect, test } from 'bun:test';
import {
  bundledJavaScriptIsCurrent,
  inspectInstalledIosApp,
  nativeArtifactHash,
  selectBundledIosStoryApp,
  nativeBuildEnvironment,
} from './native-build';

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.each(['committed change', 'dirty change', 'unchanged'])(
  'build source comparison: %s',
  (mode) => {
    const root = mkdtempSync(join(tmpdir(), 'native-build-source-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
    const source = join(root, 'screen.ts');
    try {
      git('init', '-q');
      git('config', 'user.name', 'Build regression');
      git('config', 'user.email', 'build-regression@example.invalid');
      writeFileSync(source, 'compiled revision A');
      git('add', '.');
      git('commit', '-qm', 'source A');
      if (mode === 'dirty change') writeFileSync(source, 'compiled dirty revision A');
      // Bun 1.3.5's in-test spawnSync can return empty stdout for successful Git
      // reads. Exercise the real producer in a separate Bun process, without mocks.
      const receipt = join(root, 'result.json');
      execFileSync(
        process.execPath,
        [
          '-e',
          `
      import { withStableBuildSource } from ${JSON.stringify(new URL('./native-build.ts', import.meta.url).pathname)};
      import { execFileSync } from 'node:child_process';
      import { readFileSync, writeFileSync } from 'node:fs';
      const root = ${JSON.stringify(root)}, source = ${JSON.stringify(source)};
      const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
      const mode = ${JSON.stringify(mode)};
      let compiled;
      try {
        const result = await withStableBuildSource(root, async () => {
          compiled = readFileSync(source, 'utf8');
          if (mode !== 'unchanged') writeFileSync(source, 'revision B arrived during native compilation');
          if (mode === 'committed change') { git('add', '.'); git('commit', '-qm', 'source B'); }
          return { payload: compiled, gitSha: git('rev-parse', 'HEAD') };
        });
        writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ accepted: true, compiled, result }));
      } catch (error) {
        writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ accepted: false, compiled, cleanAfterCommit: git('status', '--porcelain') === '', error: String(error) }));
      }
    `,
        ],
        { encoding: 'utf8', timeout: 20000 }
      );
      const result = JSON.parse(readFileSync(receipt, 'utf8'));
      if (mode === 'unchanged') {
        expect(result).toMatchObject({
          accepted: true,
          compiled: 'compiled revision A',
          result: { payload: 'compiled revision A' },
        });
        expect(result.result.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
      } else {
        expect(result).toEqual({
          accepted: false,
          compiled: mode === 'dirty change' ? 'compiled dirty revision A' : 'compiled revision A',
          cleanAfterCommit: mode === 'committed change',
          error: 'Error: Source changed during the build; refusing to stamp it',
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

describe('a bundled test build carries its JavaScript', () => {
  const built = { gitSha: 'a'.repeat(40), gitDirty: false, sourceFingerprint: 'source-a' };

  test('it stands for a clean tree at the commit it was built from', () => {
    expect(bundledJavaScriptIsCurrent(built, 'a'.repeat(40), false, 'source-a')).toBe(true);
  });

  test('a later commit needs a new build', () => {
    expect(bundledJavaScriptIsCurrent(built, 'b'.repeat(40), false, 'source-a')).toBe(false);
  });

  test('old caches and changed source cannot certify the bundled code', () => {
    expect(
      bundledJavaScriptIsCurrent(
        { gitSha: built.gitSha, gitDirty: false },
        built.gitSha,
        false,
        'source-a'
      )
    ).toBe(false);
    expect(bundledJavaScriptIsCurrent(built, built.gitSha, false, 'source-b')).toBe(false);
  });

  test('uncommitted changes now need a new build', () => {
    expect(bundledJavaScriptIsCurrent(built, 'a'.repeat(40), true, 'source-a')).toBe(false);
  });

  test('a build made from uncommitted changes is never reused', () => {
    expect(
      bundledJavaScriptIsCurrent({ ...built, gitDirty: true }, 'a'.repeat(40), false, 'source-a')
    ).toBe(false);
  });
});

describe('native build environment', () => {
  const inherited = {
    LANG: 'en_GB.UTF-8',
    NODE_ENV: 'production',
    EAS_BUILD_PROFILE: 'production',
    EXPO_NO_DOTENV: '0',
    DEBUG_MNEMONIC: 'fixture seed must not enter a fresh story',
    EXPO_PUBLIC_E2E_TRIPLE_TAP_WINDOW_MS: '180000',
    EXPO_PUBLIC_E2E_TOAST_DISMISS_MS: '15000',
    EXPO_PUBLIC_E2E_STATE_MIRROR: '1',
    EXPO_PUBLIC_E2E_SEED_EXPORT_TOKEN: 'fixture-token',
    EXPO_PUBLIC_E2E_LOGS: '0',
  } satisfies NodeJS.ProcessEnv;

  test('bundled builds retain logging but exclude inherited timing and fixture controls', () => {
    const env = nativeBuildEnvironment('bundled', inherited);
    expect(env.LANG).toBe(inherited.LANG);
    expect(env.APP_VARIANT).toBe('development');
    expect(env.EAS_BUILD_PROFILE).toBeUndefined();
    expect(env.EXPO_NO_DOTENV).toBe('1');
    expect(env.DEBUG_MNEMONIC).toBeUndefined();
    expect(
      Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('EXPO_PUBLIC_E2E_')))
    ).toEqual({ EXPO_PUBLIC_E2E_LOGS: '1' });
    expect(inherited.EXPO_PUBLIC_E2E_TRIPLE_TAP_WINDOW_MS).toBe('180000');
    expect(inherited.DEBUG_MNEMONIC).toBe('fixture seed must not enter a fresh story');
  });

  test('development builds keep their explicit fixture and timing controls', () => {
    const env = nativeBuildEnvironment('dev', inherited);
    expect(env.EXPO_PUBLIC_E2E_TRIPLE_TAP_WINDOW_MS).toBe('180000');
    expect(env.EXPO_PUBLIC_E2E_TOAST_DISMISS_MS).toBe('15000');
    expect(env.DEBUG_MNEMONIC).toBe(inherited.DEBUG_MNEMONIC);
    expect(env.EXPO_PUBLIC_E2E_STATE_MIRROR).toBe('1');
    expect(env.EAS_BUILD_PROFILE).toBeUndefined();
    expect(env.APP_VARIANT).toBe('development');
  });
});

describe('installed iOS payload identity', () => {
  const fixture = (run: (selected: string, installed: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'installed-ios-'));
    const selected = join(root, 'Selected.app'),
      installed = join(root, 'Installed.app');
    try {
      mkdirSync(join(selected, 'Frameworks/Example.framework'), { recursive: true });
      writeFileSync(join(selected, 'Frameworks/Example.framework/Example'), 'framework bytes', {
        mode: 0o755,
      });
      writeFileSync(join(selected, 'Sovran'), 'app executable', { mode: 0o755 });
      writeFileSync(join(selected, 'main.jsbundle'), 'bundled wallet');
      symlinkSync('main.jsbundle', join(selected, 'bundle-link'));
      cpSync(selected, installed, { recursive: true, verbatimSymlinks: true });
      run(selected, installed);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  test('identical app and narrowly normalized framework keep distinct full hashes', () =>
    fixture((a, b) => {
      expect(inspectInstalledIosApp(a, b).mismatches).toEqual([]);
      chmodSync(join(b, 'Frameworks/Example.framework/Example'), 0o644);
      const result = inspectInstalledIosApp(a, b);
      expect(result.mismatches).toEqual([]);
      expect(result.normalizedModes).toEqual([
        { path: 'Frameworks/Example.framework/Example', selected: 0o100755, installed: 0o100644 },
      ]);
      expect(result.selectedSha256).toBe(nativeArtifactHash(a));
      expect(result.installedSha256).toBe(nativeArtifactHash(b));
      expect(result.selectedSha256).not.toBe(result.installedSha256);
      expect(() => inspectInstalledIosApp(a, a)).toThrow('separate payload');
    }));

  test.each([
    'changed bytes',
    'extra file',
    'missing file',
    'changed link',
    'changed type',
    'main executable mode',
    'framework wrong mode',
    'framework reverse mode',
  ])('rejects %s even when the framework has a legitimate permission change', (fault) =>
    fixture((a, b) => {
      const framework = 'Frameworks/Example.framework/Example';
      chmodSync(join(b, framework), 0o644);
      switch (fault) {
        case 'changed bytes':
          writeFileSync(join(b, framework), 'different wallet code');
          break;
        case 'extra file':
          writeFileSync(join(b, 'extra'), 'new');
          break;
        case 'missing file':
          rmSync(join(b, 'main.jsbundle'));
          break;
        case 'changed link':
          rmSync(join(b, 'bundle-link'));
          symlinkSync('Sovran', join(b, 'bundle-link'));
          break;
        case 'changed type':
          rmSync(join(b, 'main.jsbundle'));
          mkdirSync(join(b, 'main.jsbundle'));
          break;
        case 'main executable mode':
          chmodSync(join(b, 'Sovran'), 0o644);
          break;
        case 'framework wrong mode':
          chmodSync(join(b, framework), 0o600);
          break;
        case 'framework reverse mode':
          chmodSync(join(a, framework), 0o644);
          chmodSync(join(b, framework), 0o755);
          break;
      }
      const result = inspectInstalledIosApp(a, b);
      expect(result.mismatches.length).toBeGreaterThan(0);
      expect(result.selectedSha256).not.toBe(result.installedSha256);
    })
  );
});

test.each(['dev', 'android', 'production', 'wrong path', 'missing hash', 'old source'])(
  'bundled iOS selection rejects %s before touching a device',
  async (fault) => {
    const root = mkdtempSync(join(tmpdir(), 'ios-selection-'));
    const artifact = join(root, 'Sovran.app');
    try {
      mkdirSync(artifact);
      writeFileSync(join(artifact, 'main.jsbundle'), 'stale selected bundle');
      const stamp = {
        version: 1,
        platform: fault === 'android' ? 'android' : 'ios',
        kind: fault === 'dev' ? 'dev' : 'bundled',
        appVariant: 'development',
        bundleId: fault === 'production' ? 'com.sovranbitcoin' : 'com.sovranbitcoin.dev',
        artifact: fault === 'wrong path' ? root : artifact,
        toolchain: 'test',
        fingerprint: 'old-native',
        appVersion: '1',
        buildNumber: '1',
        gitSha: '0'.repeat(40),
        gitDirty: false,
        builtAt: '2026-10-16',
        sourceFingerprint: 'old-source',
        edition: 'full',
        ...(fault === 'missing hash' ? {} : { artifactSha256: nativeArtifactHash(artifact) }),
      };
      writeFileSync(join(root, 'build.json'), JSON.stringify(stamp));
      await expect(selectBundledIosStoryApp(artifact)).rejects.toThrow(
        fault === 'old source'
          ? 'no longer matches current clean source'
          : 'not the stamped bundled iOS development build'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);
