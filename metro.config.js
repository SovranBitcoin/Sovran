const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

// `@sovranbitcoin/schemas`, Colada, and the local P2PK helper
// live as sibling repos wired in via `file:../...`. Metro needs linked targets
// in `watchFolders` so transform/resolve can walk their built files; otherwise
// the `node_modules` symlink can resolve outside Metro's project roots.
// `extraNodeModules` pins shared package names and schemas peer-deps (zod,
// neverthrow) to the app's own copies so we don't ship duplicate realms.
//
// On EAS / CI builds the sibling source isn't checked out — the npm package
// is installed from node_modules directly. Adding a non-existent watchFolder
// makes Metro's `verifyRootExists` throw and the transformer construction
// fails (`Cannot read properties of undefined (reading 'transformFile')`).
// Only add the watchFolder when the directory actually exists locally.
const sovranSchemasPath = path.resolve(__dirname, '..', 'sovran-schemas');
const appNodeModules = path.resolve(__dirname, 'node_modules');
const appCocoPackages = {
  '@cashu/coco-core': path.resolve(appNodeModules, '@cashu', 'coco-core'),
  '@cashu/coco-expo-sqlite': path.resolve(appNodeModules, '@cashu', 'coco-expo-sqlite'),
  '@cashu/coco-react': path.resolve(appNodeModules, '@cashu', 'coco-react'),
};
const localColadaPath = path.resolve(__dirname, '..', 'colada');
const localColadaEntryPath = path.join(localColadaPath, 'src', 'index.ts');
const localColadaReactEntryPath = path.join(localColadaPath, 'src', 'react', 'index.ts');
const localColadaOperationsEntryPath = path.join(localColadaPath, 'src', 'operations', 'index.ts');
const localNaggTsPath = path.resolve(__dirname, '..', 'nagg-ts');
const localNaggTsEntryPath = path.join(localNaggTsPath, 'src', 'index.ts');
const localNaggTsMapEntryPath = path.join(localNaggTsPath, 'src', 'map', 'index.ts');
const localNaggTsRecipesEntryPath = path.join(localNaggTsPath, 'src', 'recipes', 'index.ts');
const localNaggTsSchemasEntryPath = path.join(localNaggTsPath, 'src', 'schemas.ts');
const localP2PKImportPluginPath = path.resolve(__dirname, '..', 'coco-p2pk-plugin-helper');
const localP2PKImportPluginEntryPath = path.join(localP2PKImportPluginPath, 'src', 'index.ts');
// Pin React singleton entry points for sibling packages, but let `react-native`
// continue through Uniwind's resolver so className/css interop stays installed.
const appReactEntryPaths = Object.fromEntries(
  [
    ['react', path.join(appNodeModules, 'react', 'index.js')],
    ['react/jsx-runtime', path.join(appNodeModules, 'react', 'jsx-runtime.js')],
    ['react/jsx-dev-runtime', path.join(appNodeModules, 'react', 'jsx-dev-runtime.js')],
    ['react/compiler-runtime', path.join(appNodeModules, 'react', 'compiler-runtime.js')],
  ].filter(([, filePath]) => fs.existsSync(filePath))
);
const existingSiblingPackagePaths = [
  sovranSchemasPath,
  localColadaPath,
  localNaggTsPath,
  localP2PKImportPluginPath,
].filter(fs.existsSync);
const localPackageEntryPaths = {
  ...(fs.existsSync(localColadaEntryPath) ? { colada: localColadaEntryPath } : {}),
  ...(fs.existsSync(localColadaReactEntryPath)
    ? { 'colada/react': localColadaReactEntryPath }
    : {}),
  ...(fs.existsSync(localColadaOperationsEntryPath)
    ? { 'colada/operations': localColadaOperationsEntryPath }
    : {}),
  ...(fs.existsSync(localNaggTsEntryPath) ? { 'nagg-ts': localNaggTsEntryPath } : {}),
  ...(fs.existsSync(localNaggTsMapEntryPath) ? { 'nagg-ts/map': localNaggTsMapEntryPath } : {}),
  ...(fs.existsSync(localNaggTsRecipesEntryPath)
    ? { 'nagg-ts/recipes': localNaggTsRecipesEntryPath }
    : {}),
  ...(fs.existsSync(localNaggTsSchemasEntryPath)
    ? { 'nagg-ts/schemas': localNaggTsSchemasEntryPath }
    : {}),
  ...(fs.existsSync(localP2PKImportPluginEntryPath)
    ? { 'coco-cashu-plugin-p2pk-import': localP2PKImportPluginEntryPath }
    : {}),
};

config.watchFolders = Array.from(
  new Set([...(config.watchFolders ?? []), ...existingSiblingPackagePaths])
);
config.resolver = {
  ...config.resolver,
  unstable_enableSymlinks: true,
  nodeModulesPaths: [...(config.resolver?.nodeModulesPaths ?? []), appNodeModules],
  extraNodeModules: {
    ...(config.resolver?.extraNodeModules ?? {}),
    react: path.resolve(appNodeModules, 'react'),
    'react-native': path.resolve(appNodeModules, 'react-native'),
    ...appCocoPackages,
    ...(fs.existsSync(localColadaPath) ? { colada: localColadaPath } : {}),
    ...(fs.existsSync(localNaggTsPath) ? { 'nagg-ts': localNaggTsPath } : {}),
    ...(fs.existsSync(localP2PKImportPluginPath)
      ? { 'coco-cashu-plugin-p2pk-import': localP2PKImportPluginPath }
      : {}),
    ...(fs.existsSync(sovranSchemasPath) ? { '@sovranbitcoin/schemas': sovranSchemasPath } : {}),
    zod: path.resolve(appNodeModules, 'zod'),
    neverthrow: path.resolve(appNodeModules, 'neverthrow'),
  },
};

// Enable source maps for better debugging
config.transformer = {
  ...config.transformer,
  minifierConfig: {
    keep_classnames: true,
    keep_fnames: true,
    mangle: {
      keep_classnames: true,
      keep_fnames: true,
    },
  },
  // Defer `require()` evaluation per module until first use. With this
  // disabled, Metro evaluates every top-of-file require() at bundle parse
  // time, which on cold boot adds ~250ms of crypto/NDK/Cashu module init
  // even when first paint never reaches that code. The few top-level
  // side-effect imports that actually need eager evaluation (`SplashScreen.
  // preventAutoHideAsync()` in `app/_layout.tsx`, polyfills) are still
  // covered because those modules are touched by the entry, so their
  // require() runs on first access of the parent module.
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
};

// First apply Uniwind
const uniwindConfig = withUniwindConfig(config, { cssEntryFile: './global.css' });

// Resolve @monicon/runtime to the pre-generated icons file.
// The .monicon/icons.js file is generated by running the dev server locally
// (which triggers @monicon/core's loadIcons) and committed to the repo.
// This replaces @monicon/metro's withMonicon() which is incompatible with
// the installed version mix and Expo 55's resolver chain.
const moniconIconsPath = path.resolve(__dirname, '.monicon', 'icons.js');
const liquidGlassEntryPath = path.resolve(
  __dirname,
  'node_modules',
  'expo-liquid-glass-native',
  'build',
  'index.js'
);
const herouiNativeEntryPath = path.resolve(
  __dirname,
  'node_modules',
  'heroui-native',
  'lib',
  'module',
  'index.js'
);
const herouiNativeProviderPath = path.resolve(
  __dirname,
  'node_modules',
  'heroui-native',
  'lib',
  'module',
  'providers',
  'hero-ui-native',
  'index.js'
);

// Force `@cashu/cashu-ts` to resolve to the patched ESM bundle. The
// patch in `patches/@cashu+cashu-ts+3.5.0.patch` only edits
// `lib/cashu-ts.es.js` (where it installs the `__CASHU_NATIVE` global
// and the native-crypto fast-path branches). Metro's default resolver,
// driven by Expo's `resolverMainFields: ['react-native', 'browser', 'main']`
// plus the package's exports map (`require → cashu-ts.cjs`), picks the
// CJS bundle — which has none of the patch. Result: every session logs
// `cashu.native_crypto.hook_missing` and cashu-ts crypto runs in pure
// JS, blocking the JS thread for seconds during recovery.
const cashuTsEsmPath = path.resolve(
  __dirname,
  'node_modules',
  '@cashu',
  'cashu-ts',
  'lib',
  'cashu-ts.es.js'
);

// Save Uniwind's resolver before adding ours — Uniwind intercepts CSS
// imports and swaps them for platform-specific JS. Overwriting it causes a
// black screen because styles never load.
const uniwindResolver = uniwindConfig.resolver?.resolveRequest;

uniwindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@monicon/runtime') {
    return {
      type: 'sourceFile',
      filePath: moniconIconsPath,
    };
  }
  if (moduleName === 'expo-liquid-glass-native') {
    return {
      type: 'sourceFile',
      filePath: liquidGlassEntryPath,
    };
  }
  if (moduleName === 'heroui-native') {
    return {
      type: 'sourceFile',
      filePath: herouiNativeEntryPath,
    };
  }
  if (moduleName === 'heroui-native/provider') {
    return {
      type: 'sourceFile',
      filePath: herouiNativeProviderPath,
    };
  }
  if (moduleName === '@cashu/cashu-ts') {
    return {
      type: 'sourceFile',
      filePath: cashuTsEsmPath,
    };
  }
  if (appReactEntryPaths[moduleName]) {
    return {
      type: 'sourceFile',
      filePath: appReactEntryPaths[moduleName],
    };
  }
  if (localPackageEntryPaths[moduleName]) {
    return {
      type: 'sourceFile',
      filePath: localPackageEntryPaths[moduleName],
    };
  }
  // Chain to Uniwind's resolver to preserve CSS interop styling
  if (uniwindResolver) {
    return uniwindResolver(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = uniwindConfig;
