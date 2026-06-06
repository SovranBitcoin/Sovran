/**
 * Pins the build-profile gate that keeps the dev debug mnemonic out of
 * production / preview bundles.
 *
 * Background: EXPO_PUBLIC_* env vars are inlined verbatim into every JS
 * bundle Expo builds. A stray `export EXPO_PUBLIC_DEBUG_MNEMONIC=...` in a
 * developer's shell during an EAS production build would ship a known
 * 12-word seed in the production bundle (SOV-00 §4.1 D5; audits 04/10/11).
 *
 * The fix routes the value through `app.config.js`'s `extra.debugMnemonic`
 * from the non-prefixed `DEBUG_MNEMONIC` var. This test asserts that
 * app.config.js refuses to inject the value unless the build profile is
 * `development`, so production / preview bundles are structurally free of
 * the literal regardless of shell hygiene.
 */

const APP_CONFIG_PATH = '../app.config.js';

type ConfigFn = (args: { config: Record<string, unknown> }) => Record<string, unknown> & {
  extra?: { debugMnemonic?: unknown; giveawayP2pkSecret?: unknown };
};

function loadAppConfig(): ConfigFn {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(APP_CONFIG_PATH) as ConfigFn;
}

const ENV_KEYS = [
  'EAS_BUILD_PROFILE',
  'APP_VARIANT',
  'EXPO_PUBLIC_ENV',
  'DEBUG_MNEMONIC',
  'GIVEAWAY_P2PK_SECRET',
  'EXPO_PUBLIC_GIVEAWAY_P2PK_SECRET',
] as const;

const VALID_MNEMONIC =
  'cute clutch where initial orphan arena fashion silk minute endless middle own';

const GIVEAWAY_SECRET = 'a'.repeat(64);

describe('app.config.js: extra.debugMnemonic gating', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    jest.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = originalEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('omits debugMnemonic when buildProfile defaults to production', () => {
    process.env.DEBUG_MNEMONIC = VALID_MNEMONIC;
    const config = loadAppConfig()({ config: {} });
    expect(config.extra?.debugMnemonic).toBeUndefined();
  });

  it('omits debugMnemonic when EAS_BUILD_PROFILE=production', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.DEBUG_MNEMONIC = VALID_MNEMONIC;
    const config = loadAppConfig()({ config: {} });
    expect(config.extra?.debugMnemonic).toBeUndefined();
  });

  it('omits debugMnemonic when APP_VARIANT=preview (any non-development profile)', () => {
    // Even though `preview` falls into isDevelopment in app.config.js for
    // bundle-id selection, debugMnemonic is gated more strictly: only
    // `development` should ever carry it. (Test pins current behavior; if
    // this loosens, the gate has regressed.)
    process.env.APP_VARIANT = 'preview';
    process.env.DEBUG_MNEMONIC = VALID_MNEMONIC;
    const config = loadAppConfig()({ config: {} });
    // Document current intent: `extra.debugMnemonic` only when profile is
    // exactly 'development'. If app.config.js widens to include 'preview',
    // update this assertion AND verify that preview EAS profiles never
    // carry the env in CI.
    expect(config.extra?.debugMnemonic).toBeUndefined();
  });

  it('injects debugMnemonic when EAS_BUILD_PROFILE=development and DEBUG_MNEMONIC is set', () => {
    process.env.EAS_BUILD_PROFILE = 'development';
    process.env.DEBUG_MNEMONIC = VALID_MNEMONIC;
    const config = loadAppConfig()({ config: {} });
    expect(config.extra?.debugMnemonic).toBe(VALID_MNEMONIC);
  });

  it('omits debugMnemonic on the development profile when DEBUG_MNEMONIC is unset', () => {
    process.env.EAS_BUILD_PROFILE = 'development';
    const config = loadAppConfig()({ config: {} });
    expect(config.extra?.debugMnemonic).toBeUndefined();
  });

  it('does not read EXPO_PUBLIC_DEBUG_MNEMONIC — only the non-prefixed var is honored', () => {
    process.env.EAS_BUILD_PROFILE = 'development';
    // Simulate a developer who still has the old var exported.
    (process.env as Record<string, string>).EXPO_PUBLIC_DEBUG_MNEMONIC = VALID_MNEMONIC;
    const config = loadAppConfig()({ config: {} });
    delete (process.env as Record<string, string>).EXPO_PUBLIC_DEBUG_MNEMONIC;
    // The new mechanism must not re-introduce the inlining bug by reading
    // the EXPO_PUBLIC_* var as a fallback.
    expect(config.extra?.debugMnemonic).toBeUndefined();
  });

  // The shared giveaway P2PK key is the deliberate exception to "don't inject
  // key material into Expo config": giveaway ecash is P2PK-locked to it and
  // every shipped install must redeem it, so unlike debugMnemonic it is injected
  // for ALL build profiles. It must still come only from the non-EXPO_PUBLIC var.
  it('injects giveawayP2pkSecret on production when GIVEAWAY_P2PK_SECRET is set', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.GIVEAWAY_P2PK_SECRET = GIVEAWAY_SECRET;
    const config = loadAppConfig()({ config: {} });
    expect(config.extra?.giveawayP2pkSecret).toBe(GIVEAWAY_SECRET);
  });

  it('injects giveawayP2pkSecret on the development profile too', () => {
    process.env.EAS_BUILD_PROFILE = 'development';
    process.env.GIVEAWAY_P2PK_SECRET = GIVEAWAY_SECRET;
    const config = loadAppConfig()({ config: {} });
    expect(config.extra?.giveawayP2pkSecret).toBe(GIVEAWAY_SECRET);
  });

  it('omits giveawayP2pkSecret when GIVEAWAY_P2PK_SECRET is unset', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    const config = loadAppConfig()({ config: {} });
    expect(config.extra?.giveawayP2pkSecret).toBeUndefined();
  });

  it('does not read EXPO_PUBLIC_GIVEAWAY_P2PK_SECRET — only the non-prefixed var', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    (process.env as Record<string, string>).EXPO_PUBLIC_GIVEAWAY_P2PK_SECRET = GIVEAWAY_SECRET;
    const config = loadAppConfig()({ config: {} });
    expect(config.extra?.giveawayP2pkSecret).toBeUndefined();
  });
});
