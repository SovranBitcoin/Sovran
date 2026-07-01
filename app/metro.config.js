const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

// Monorepo layout: this app is a bun-workspace member at <root>/app. The
// `wallet` and `nostr` packages live at <root>/wallet and <root>/nostr and ship
// raw TypeScript from their `src/`. Shared dependencies hoist to the workspace
// root `node_modules`, so package locations are resolved by probing both the
// app's own `node_modules` and the hoisted root copy.
//
// `extraNodeModules` + the resolveRequest pins force the type-bearing shared
// libs (react, react-native, zod, neverthrow, @cashu/coco-*) to a single realm
// so we never bundle duplicate copies (which would break hooks identity and
// cross-package `instanceof ZodError` / Result identity).
const appNodeModules = path.resolve(__dirname, 'node_modules');
const workspaceRoot = path.resolve(__dirname, '..');
const rootNodeModules = path.resolve(workspaceRoot, 'node_modules');
const nmRoots = [appNodeModules, rootNodeModules];

// Resolve a package directory (or a file within it) from whichever node_modules
// realm bun installed it into — app-local first, then the hoisted root.
function resolvePkgDir(name) {
  const segs = name.split('/');
  for (const nm of nmRoots) {
    const candidate = path.join(nm, ...segs);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(appNodeModules, ...segs);
}
function resolvePkgFile(name, ...sub) {
  const segs = name.split('/');
  for (const nm of nmRoots) {
    const candidate = path.join(nm, ...segs, ...sub);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(appNodeModules, ...segs, ...sub);
}

const appCocoPackages = {
  '@cashu/coco-core': resolvePkgDir('@cashu/coco-core'),
  '@cashu/coco-expo-sqlite': resolvePkgDir('@cashu/coco-expo-sqlite'),
  '@cashu/coco-react': resolvePkgDir('@cashu/coco-react'),
};

// In-repo workspace packages — always present, resolved straight to their TS
// source entries so Metro doesn't depend on package-exports support.
const walletPath = path.join(workspaceRoot, 'wallet');
const nostrPath = path.join(workspaceRoot, 'nostr');
const localPackageEntryPaths = {
  wallet: path.join(walletPath, 'src', 'index.ts'),
  'wallet/react': path.join(walletPath, 'src', 'react', 'index.ts'),
  'wallet/operations': path.join(walletPath, 'src', 'operations', 'index.ts'),
  nostr: path.join(nostrPath, 'src', 'index.ts'),
  'nostr/map': path.join(nostrPath, 'src', 'map', 'index.ts'),
  'nostr/recipes': path.join(nostrPath, 'src', 'recipes', 'index.ts'),
  'nostr/schemas': path.join(nostrPath, 'src', 'schemas.ts'),
};

// Pin React singleton entry points for the workspace packages, but let
// `react-native` continue through Uniwind's resolver so className/css interop
// stays installed.
const appReactEntryPaths = Object.fromEntries(
  [
    ['react', resolvePkgFile('react', 'index.js')],
    ['react/jsx-runtime', resolvePkgFile('react', 'jsx-runtime.js')],
    ['react/jsx-dev-runtime', resolvePkgFile('react', 'jsx-dev-runtime.js')],
    ['react/compiler-runtime', resolvePkgFile('react', 'compiler-runtime.js')],
  ].filter(([, filePath]) => fs.existsSync(filePath))
);

// Expo's getDefaultConfig already detects the bun workspace and sets the correct
// watchFolders (root node_modules + each member) + nodeModulesPaths (app + root)
// + serverRoot, and handles the workspace symlinks natively. Do NOT set
// unstable_enableSymlinks or override watchFolders — forcing the experimental
// symlink crawl makes metro-file-map walk out of its root tree and throw
// "Unexpectedly escaped traversal". We only pin the shared realms below
// (extraNodeModules + resolveRequest) so wallet/nostr and the app share one copy
// of react/zod/neverthrow/@cashu-coco.
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: Array.from(
    new Set([...(config.resolver?.nodeModulesPaths ?? []), appNodeModules, rootNodeModules])
  ),
  extraNodeModules: {
    ...(config.resolver?.extraNodeModules ?? {}),
    react: resolvePkgDir('react'),
    'react-native': resolvePkgDir('react-native'),
    ...appCocoPackages,
    zod: resolvePkgDir('zod'),
    neverthrow: resolvePkgDir('neverthrow'),
  },
};

// Production minification. Identifier mangling is left ON (Terser's default):
// `keep_*names` were previously forced true for readable stack traces, but that
// inflates the Hermes bytecode shipped to every install. Crash readability now
// relies on the EAS-generated source maps instead. Verified safe: no runtime
// branches on `fn.name`/`constructor.name` (only `app/_layout.tsx` reads
// `Component.displayName || Component.name` for debug labels, which tolerates
// mangled names). `drop_console` strips dev-only console.* calls from release
// bundles — the app's own structured `log.*` (shared/lib/logger) is untouched.
config.transformer = {
  ...config.transformer,
  minifierConfig: {
    compress: {
      drop_console: ['log', 'debug', 'info'],
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

// Resolve @monicon/runtime to the pre-generated icons file.
// The .monicon/icons.js file is generated by running the dev server locally
// (which triggers @monicon/core's loadIcons) and committed to the repo.
// This replaces @monicon/metro's withMonicon() which is incompatible with
// the installed version mix and the Expo resolver chain.
const moniconIconsPath = path.resolve(__dirname, '.monicon', 'icons.js');
const liquidGlassEntryPath = resolvePkgFile('expo-liquid-glass-native', 'build', 'index.js');
const herouiNativeEntryPath = resolvePkgFile('heroui-native', 'lib', 'module', 'index.js');
const herouiNativeProviderPath = resolvePkgFile(
  'heroui-native',
  'lib',
  'module',
  'providers',
  'hero-ui-native',
  'index.js'
);

// Uniwind internally probes `uniwind/components` (and remaps RN components to
// `uniwind/components/<Name>`) through the base resolver. Under the nested-app
// workspace, letting Metro resolve those makes getClosestPackage walk up to the
// workspace-root package.json — which is ABOVE the app/ Metro root — and throw
// "Unexpectedly escaped traversal". Resolve uniwind's own component sources to
// explicit files so getClosestPackage never runs for them.
const uniwindComponentsDir = path.join(resolvePkgDir('uniwind'), 'src', 'components');
function resolveUniwindComponent(moduleName) {
  if (moduleName === 'uniwind/components') {
    const fp = path.join(uniwindComponentsDir, 'index.ts');
    return fs.existsSync(fp) ? fp : null;
  }
  if (moduleName.startsWith('uniwind/components/')) {
    const name = moduleName.slice('uniwind/components/'.length);
    const candidates = [
      path.join(uniwindComponentsDir, 'native', `${name}.tsx`),
      path.join(uniwindComponentsDir, 'native', `${name}.ts`),
      path.join(uniwindComponentsDir, 'web', `${name}.ts`),
      path.join(uniwindComponentsDir, 'web', `${name}.tsx`),
      path.join(uniwindComponentsDir, `${name}.tsx`),
      path.join(uniwindComponentsDir, `${name}.ts`),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  }
  return null;
}

// Base resolver — installed on the config BEFORE uniwind wraps it, so uniwind's
// own probes (above) and the app's imports both flow through these pins.
const appResolveRequest = (context, moduleName, platform) => {
  const uniwindComponent = resolveUniwindComponent(moduleName);
  if (uniwindComponent) {
    return { type: 'sourceFile', filePath: uniwindComponent };
  }
  if (moduleName === '@monicon/runtime') {
    return { type: 'sourceFile', filePath: moniconIconsPath };
  }
  if (moduleName === 'expo-liquid-glass-native') {
    return { type: 'sourceFile', filePath: liquidGlassEntryPath };
  }
  if (moduleName === 'heroui-native') {
    return { type: 'sourceFile', filePath: herouiNativeEntryPath };
  }
  if (moduleName === 'heroui-native/provider') {
    return { type: 'sourceFile', filePath: herouiNativeProviderPath };
  }
  // Force the shared, type-bearing libs to the app's single copy. The workspace
  // packages (wallet/nostr) and the `@sovranbitcoin/*` registry packages can each
  // carry a nested `zod`/`neverthrow`, which Metro would otherwise bundle as
  // separate realms — breaking cross-package `instanceof ZodError` / Result
  // identity. Resolving from the app root collapses them to one copy (mirrors the
  // tsconfig `paths` pinning so the bundle and type-check agree).
  if (
    moduleName === 'zod' ||
    moduleName.startsWith('zod/') ||
    moduleName === 'neverthrow' ||
    moduleName.startsWith('neverthrow/')
  ) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(__dirname, 'index.js') },
      moduleName,
      platform
    );
  }
  if (appReactEntryPaths[moduleName]) {
    return { type: 'sourceFile', filePath: appReactEntryPaths[moduleName] };
  }
  if (localPackageEntryPaths[moduleName]) {
    return { type: 'sourceFile', filePath: localPackageEntryPaths[moduleName] };
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.resolveRequest = appResolveRequest;

// Apply Uniwind last so it wraps our base resolver (its component remapping and
// CSS interop call back into appResolveRequest).
const uniwindConfig = withUniwindConfig(config, { cssEntryFile: './global.css' });

module.exports = uniwindConfig;
