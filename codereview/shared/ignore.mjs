/**
 * Shared ignore-list for repo walkers used by analyze-structure and
 * lookalikes. Single source of truth — adjust here once.
 */

export const IGNORE_DIRS = new Set([
  'node_modules',
  'ios',
  'android',
  'dist',
  '.git',
  'coco',
  'sovran.money',
  'targets',
  '.expo',
  'build',
  'coverage',
  'screenshots-output',
  '.cursor',
  'heroui-native',
  'references',
]);

export const IGNORE_FILES = new Set(['package-lock.json', 'yarn.lock']);

/**
 * Path-suffix patterns to ignore. These match the *trailing* portion of a
 * walked directory's absolute path, so `packages/<name>/lib` matches the
 * compiled output of any local package without skipping every directory
 * literally named `lib`.
 */
export const IGNORE_PATH_PATTERNS = [/[/\\]packages[/\\][^/\\]+[/\\]lib$/];

export const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.jsx', '.cjs']);

export function isTestPath(p) {
  return /(?:\.test\.|\.spec\.|__tests__\/)/.test(p);
}
