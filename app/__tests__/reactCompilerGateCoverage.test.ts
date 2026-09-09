/**
 * @jest-environment node
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Coverage guard for the React Compiler bailout ratchet
 * (`scripts/check-react-compiler.mjs`).
 *
 * That gate is the only signal this repo has that the compiler actually
 * compiled a component: `eslint-plugin-react-compiler` is dead here under the
 * zod@4 override, and a bailout raises no runtime error — it just renders
 * unmemoized. So the ratchet is only as honest as the set of files it sweeps.
 * Anything outside that set reports zero bailouts because nothing looked.
 *
 * The set had rotted. It named `components`, which has never existed in this
 * tree, and omitted `assets`, `config`, and `navigation` — all imported
 * unconditionally by the root layout, so all in both the iOS and the Android
 * bundle — plus the entry file itself.
 *
 * The invariant these tests hold: every top-level directory and every
 * top-level source file is either swept by the gate or listed in NOT_SWEPT
 * with a reason. A new one cannot default into invisibility.
 *
 * `app/` was not the whole set either. `metro.config.js` pins the `wallet*`
 * and `nostr*` specifiers to absolute files under `<repo>/wallet/src` and
 * `<repo>/nostr/src`, which are outside any `node_modules`, so Expo runs the
 * compiler over them too — in both the iOS and the Android bundle. The gate
 * swept none of it, which is how eight bailing hooks in the payment read model
 * went unreported until commit 05bff9f0 found them by hand. The second block
 * of tests below holds that half: the package roots, and the Metro pin that is
 * the whole reason they belong in the sweep.
 */

const APP_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(APP_DIR, '..');
const GATE_PATH = path.join(APP_DIR, 'scripts/check-react-compiler.mjs');
const METRO_CONFIG_PATH = path.join(APP_DIR, 'metro.config.js');
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Everything at the top level the gate deliberately does not sweep, and why.
 *
 * Two distinct reasons. Most entries are simply never bundled (tests, build
 * and review tooling, native-only targets). But `modules` and `vendor` ARE
 * bundled and still must not be swept: Metro resolves both from
 * `app/node_modules` (the local Expo modules are `file:` deps installed as
 * copies), and babel-preset-expo refuses to run the React Compiler on any file
 * it resolved from `node_modules`. Sweeping their in-repo sources would report
 * a compile success production never performs.
 */
const NOT_SWEPT: Record<string, string> = {
  __mocks__: 'jest manual mocks',
  __tests__: 'this suite',
  '.expo': 'generated router types, not bundled runtime',
  codereview: 'log-doctor / analyze-structure tooling',
  credentials: 'build credentials',
  docs: 'markdown and ADRs',
  e2e: 'the Bun-only JSON-native harness',
  modules: 'bundled, but resolved from node_modules where Expo disables the compiler',
  node_modules: 'dependencies',
  patches: 'Bun dependency patches',
  plugins: 'Expo config plugins, build time',
  scripts: 'release and CI scripts, including this gate',
  targets: 'the iOS widget extension (Swift)',
  tests: 'README only',
  vendor: 'vendored marmot-ts source; the bundle resolves its node_modules copy',
  'app.config.js': 'Expo config, build time',
  'babel.config.js': 'build config',
  'eslint.config.js': 'build config',
  'expo-env.d.ts': 'type declarations only',
  'jest.config.js': 'build config',
  'metro.config.js': 'build config',
  'prettier.config.js': 'build config',
  'uniwind-types.d.ts': 'type declarations only',
};

/** Strip line comments so a commented-out entry cannot still match. */
function uncommented(source: string): string {
  return source.replace(/^[ \t]*\/\/.*$/gm, '');
}

function gateArray(name: string): string[] {
  const source = uncommented(readFileSync(GATE_PATH, 'utf8'));
  const literal = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(source)?.[1];
  if (literal === undefined) throw new Error(`${name} not found in check-react-compiler.mjs`);
  return [...literal.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
}

function containsSource(directory: string): boolean {
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      // Symlinked directories report isSymbolicLink(), not isDirectory(); stat
      // through them so a symlinked tree cannot hide source, and never recurse
      // into the link itself (which is what keeps this loop-free).
      const isDirectory = entry.isDirectory() || (entry.isSymbolicLink() && isDir(full));
      if (isDirectory) stack.push(full);
      else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) return true;
    }
  }
  return false;
}

function isDir(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The top-level entries of `wallet/` and `nostr/` the gate deliberately does
 * not sweep. Both packages ship only `src/`; everything else here is either
 * test or build-time material Metro never bundles.
 */
const PACKAGE_NOT_SWEPT: Record<string, string> = {
  __tests__: 'vitest suites, not bundled',
  docs: 'markdown',
  node_modules: 'dependencies',
  'package.json': 'manifest',
  'README.md': 'markdown',
  'tsconfig.json': 'build config',
  'vitest.config.ts': 'test config',
};

describe('React Compiler gate coverage', () => {
  const roots = gateArray('SOURCE_ROOTS');
  const files = gateArray('SOURCE_FILES');

  it('builds the sweep glob from SOURCE_ROOTS', () => {
    // Without this every other assertion here could stay green while the glob
    // the gate actually sweeps had drifted away from the array they read.
    expect(uncommented(readFileSync(GATE_PATH, 'utf8'))).toContain(
      "const SRC_GLOB = `{${SOURCE_ROOTS.join(',')}}/**/*.{ts,tsx,js,jsx}`;"
    );
  });

  it('sweeps SOURCE_FILES alongside the glob', () => {
    expect(uncommented(readFileSync(GATE_PATH, 'utf8'))).toContain(
      '...SOURCE_FILES.map((file) => resolve(APP_DIR, file)),'
    );
  });

  it('sweeps only roots and files that exist', () => {
    // `components` sat in the glob for the life of the gate without ever
    // existing, which is how three real roots went unnoticed beside it.
    const missing = [...roots, ...files].filter((entry) => !existsSync(path.join(APP_DIR, entry)));
    expect(missing).toEqual([]);
  });

  it('classifies every top-level entry as either swept or explicitly not swept', () => {
    const classified = new Set([...roots, ...files, ...Object.keys(NOT_SWEPT)]);
    const unclassified = readdirSync(APP_DIR, { withFileTypes: true })
      .map((entry) => entry.name)
      .filter((name) => !classified.has(name))
      .filter((name) => {
        const full = path.join(APP_DIR, name);
        return isDir(full) ? containsSource(full) : SOURCE_EXTENSIONS.includes(path.extname(name));
      });

    // A new root of app source must join the gate's SOURCE_ROOTS/SOURCE_FILES,
    // or NOT_SWEPT above with the reason production never compiles it.
    expect(unclassified).toEqual([]);
  });

  it.each([
    // Imported by app/_layout.tsx — every screen on both platforms.
    'assets/icons/index.tsx',
    // The native tab bar and the glass header items ~15 screens install.
    'navigation/nativeTabs.tsx',
    'navigation/headerItems.tsx',
    // Immersive flow screen options, used by app/(stories-flow)/_layout.tsx.
    'config/flowLayoutOptions.tsx',
  ])('sweeps the bundled component %s', (relativePath) => {
    expect(statSync(path.join(APP_DIR, relativePath)).isFile()).toBe(true);
    expect(roots).toContain(relativePath.split('/')[0]);
  });

  it('sweeps the entry file and the modules it pulls in first', () => {
    // package.json main. shim/polyfills are its first two imports, and themes
    // is the palette every screen reads through `@/themes`.
    expect(files).toEqual(
      expect.arrayContaining(['index.js', 'shim.js', 'polyfills.js', 'themes.ts'])
    );
  });
});

describe('React Compiler gate coverage — workspace packages', () => {
  const packageRoots = gateArray('PACKAGE_ROOTS');

  it('sweeps each package root separately, and treats an empty one as fatal', () => {
    const source = uncommented(readFileSync(GATE_PATH, 'utf8'));
    // Bun's Glob does not brace-alternate alternatives containing a `/`, so
    // `{wallet/src,nostr/src}/**` matches NOTHING and reports a clean sweep.
    // Per-root scanning plus a hard error on zero is what makes that
    // impossible; both halves are asserted so neither can quietly come back.
    expect(source).toContain('...PACKAGE_ROOTS.flatMap((root) => scanRoot(REPO_DIR, root)),');
    expect(source).toContain('if (found.length === 0) {');
    expect(source).toContain('process.exit(2);');
    expect(source).not.toContain('${PACKAGE_ROOTS.join');
    // And that the per-root glob is the whole tree, not an entry file: a
    // narrowed pattern would still satisfy every assertion above while
    // sweeping almost nothing, and the ratchet would stay green because the
    // packages contribute no baseline entries.
    expect(source).toContain(
      'new Glob(`${root}/**/*.{ts,tsx,js,jsx}`).scanSync({ cwd, absolute: true })'
    );
  });

  it('sweeps the workspace packages Metro compiles from source', () => {
    expect(packageRoots).toEqual(['wallet/src', 'nostr/src']);
    for (const root of packageRoots) {
      expect(statSync(path.join(REPO_DIR, root)).isDirectory()).toBe(true);
    }
  });

  it('finds real source under every package root', () => {
    // A root that silently resolves to nothing is the same failure as no
    // sweep at all — the gate would report zero bailouts because nothing
    // looked. This is the assertion that catches it from the outside.
    for (const root of packageRoots) {
      expect(containsSource(path.join(REPO_DIR, root))).toBe(true);
    }
  });

  it.each([
    // The payment context every screen in the app renders inside, and the
    // three hooks that read coco through it. All four bailed unreported.
    'wallet/src/react/ColadaProvider.tsx',
    'wallet/src/react/useColadaTransactions.ts',
    'wallet/src/react/usePaymentMachine.ts',
    'wallet/src/react/useScreenActions.ts',
  ])('sweeps the compiled package file %s', (relativePath) => {
    expect(statSync(path.join(REPO_DIR, relativePath)).isFile()).toBe(true);
    expect(packageRoots.some((root) => relativePath.startsWith(`${root}/`))).toBe(true);
  });

  it.each(['wallet', 'nostr'])(
    'classifies every top-level entry of %s as swept or explicitly not swept',
    (pkg) => {
      const packageDir = path.join(REPO_DIR, pkg);
      const swept = packageRoots
        .filter((root) => root.startsWith(`${pkg}/`))
        .map((root) => root.slice(pkg.length + 1));
      const classified = new Set([...swept, ...Object.keys(PACKAGE_NOT_SWEPT)]);
      const unclassified = readdirSync(packageDir, { withFileTypes: true })
        .map((entry) => entry.name)
        .filter((name) => !classified.has(name))
        .filter((name) => {
          const full = path.join(packageDir, name);
          return isDir(full)
            ? containsSource(full)
            : SOURCE_EXTENSIONS.includes(path.extname(name));
        });
      expect(unclassified).toEqual([]);
    }
  );

  it('sweeps the packages BECAUSE Metro resolves them outside node_modules', () => {
    // This is the premise the whole package half rests on.
    // `@expo/metro-config` decides the compiler's node-module opt-out with a
    // bare `filename.includes('node_modules')`, and `babel-preset-expo` skips
    // the compiler entirely when that is true. Metro's resolver pins every
    // `wallet*`/`nostr*` specifier to a path under the swept roots — outside
    // any `node_modules`, and with no `platform` branch, so it is the same on
    // iOS and Android. Re-point one at the `node_modules` symlink and the
    // sweep would start reporting compile successes production never performs;
    // drop the pin and the sweep would cover files the bundle no longer uses.
    const metro = uncommented(readFileSync(METRO_CONFIG_PATH, 'utf8'));
    const entries = /const localPackageEntryPaths = \{([\s\S]*?)\n\};/.exec(metro)?.[1];
    expect(entries).toBeDefined();

    const specifiers = [...(entries as string).matchAll(/^\s*'?([\w/]+)'?:/gm)].map(
      (match) => match[1] as string
    );
    expect(specifiers).toEqual(expect.arrayContaining(['wallet', 'wallet/react', 'nostr']));

    for (const specifier of specifiers) {
      const pkg = specifier.split('/')[0] as string;
      expect(packageRoots.some((root) => root.startsWith(`${pkg}/`))).toBe(true);
    }
    // The pinned paths are built from `walletPath`/`nostrPath`, which are
    // `path.join(workspaceRoot, …)` — never `node_modules`.
    expect(metro).toContain("const walletPath = path.join(workspaceRoot, 'wallet');");
    expect(metro).toContain("const nostrPath = path.join(workspaceRoot, 'nostr');");
    expect(entries).not.toContain('node_modules');
    for (const root of packageRoots) {
      const [pkg, sub] = root.split('/');
      expect(entries).toContain(`${pkg}Path, '${sub}'`);
    }
  });
});
