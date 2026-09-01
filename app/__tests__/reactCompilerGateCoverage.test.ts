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
 */

const APP_DIR = path.resolve(__dirname, '..');
const GATE_PATH = path.join(APP_DIR, 'scripts/check-react-compiler.mjs');
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
  '.monicon': 'generated icon data (module.exports map), no compiler-eligible code',
  codereview: 'log-doctor / analyze-structure tooling',
  credentials: 'build credentials',
  docs: 'markdown and ADRs',
  e2e: 'the Bun-only JSON-native harness',
  modules: 'bundled, but resolved from node_modules where Expo disables the compiler',
  node_modules: 'dependencies',
  patches: 'patch-package diffs',
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
