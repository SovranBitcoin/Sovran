// This file extends app.json with dynamic configuration.
// EAS will auto-increment buildNumber/versionCode in app.json,
// while this file handles dynamic values like bundle identifiers.

module.exports = ({ config }) => {
  const buildProfile =
    process.env.EAS_BUILD_PROFILE ||
    process.env.APP_VARIANT ||
    process.env.EXPO_PUBLIC_ENV ||
    'production';
  const isDevelopment = buildProfile === 'development' || buildProfile === 'preview';

  // Debug logging to verify bundle identifier selection
  if (process.env.EAS_BUILD_PROFILE || process.env.APP_VARIANT) {
    console.log(`[app.config.js] Build profile: ${buildProfile}, isDevelopment: ${isDevelopment}`);
    console.log(
      `[app.config.js] Bundle identifier will be: ${isDevelopment ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin'}`
    );
  }

  const appIcon = './assets/images/light.png';
  const adaptiveIcon = './assets/images/dark-t.png';
  const androidGoogleMapsApiKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

  // Inject DEBUG_MNEMONIC into `extra.debugMnemonic` ONLY for the
  // `development` build profile (stricter than `isDevelopment`, which also
  // includes `preview` — internal beta builds must not carry the debug
  // seed). The non-`EXPO_PUBLIC_*` prefix prevents Expo's automatic
  // build-time env inlining; gating on buildProfile structurally keeps the
  // literal out of preview/production bundles even if a developer's shell
  // still exports the var. See SOV-00 §4.1 and
  // shared/lib/nostr/secureStorage.ts:getDebugMnemonicOverride.
  const debugMnemonic = buildProfile === 'development' ? process.env.DEBUG_MNEMONIC : undefined;

  // Shared giveaway P2PK key. UNLIKE debugMnemonic this is injected for ALL
  // build profiles: giveaway ecash is P2PK-locked to this key's public key and
  // every shipped install must be able to redeem it. Sourced from the
  // non-`EXPO_PUBLIC_` var so Expo never inlines it anywhere except this explicit
  // `extra` entry; the wallet reads it via Constants.expoConfig.extra in
  // shared/lib/cashu/manager.ts. SECURITY: a key embedded in the bundle is
  // extractable by anyone who reverses a build — only use low-value, rotatable
  // giveaway keys. Generate one with `node scripts/gen-giveaway-key.mjs`.
  // See ../.agents/skills/sovran-security-keys/references/secure-storage-key-derivation.md.
  const giveawayP2pkSecret = process.env.GIVEAWAY_P2PK_SECRET || undefined;

  // Spread the static config from app.json and override only what's needed
  return {
    ...config,
    icon: appIcon,
    extra: {
      ...config.extra,
      ...(debugMnemonic ? { debugMnemonic } : {}),
      ...(giveawayP2pkSecret ? { giveawayP2pkSecret } : {}),
    },
    plugins: [
      ...(config.plugins || []),
      [
        'expo-maps',
        {
          requestLocationPermission: true,
          locationPermission:
            'Sovran uses your location to show nearby Bitcoin-accepting places.',
        },
      ],
    ],
    ios: {
      ...config.ios,
      bundleIdentifier: isDevelopment ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin',
    },
    android: {
      ...config.android,
      config: {
        ...config.android?.config,
        googleMaps: {
          ...config.android?.config?.googleMaps,
          apiKey: androidGoogleMapsApiKey,
        },
      },
      adaptiveIcon: {
        ...config.android?.adaptiveIcon,
        foregroundImage: adaptiveIcon,
      },
      package: isDevelopment ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin',
    },
  };
};
