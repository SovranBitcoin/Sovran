import { describe, expect, test } from 'bun:test';
import { bundledJavaScriptIsCurrent, nativeBuildEnvironment } from './native-build';

describe('a bundled test build carries its JavaScript', () => {
  const built = { gitSha: 'a'.repeat(40), gitDirty: false };

  test('it stands for a clean tree at the commit it was built from', () => {
    expect(bundledJavaScriptIsCurrent(built, 'a'.repeat(40), false)).toBe(true);
  });

  test('a later commit needs a new build', () => {
    expect(bundledJavaScriptIsCurrent(built, 'b'.repeat(40), false)).toBe(false);
  });

  test('uncommitted changes now need a new build', () => {
    expect(bundledJavaScriptIsCurrent(built, 'a'.repeat(40), true)).toBe(false);
  });

  test('a build made from uncommitted changes is never reused', () => {
    expect(bundledJavaScriptIsCurrent({ ...built, gitDirty: true }, 'a'.repeat(40), false)).toBe(
      false
    );
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
