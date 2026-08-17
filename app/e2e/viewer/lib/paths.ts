import { lstatSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';

const LIB = dirname(new URL(import.meta.url).pathname);
export const E2E_ROOT = resolve(LIB, '..', '..');
export const APP_ROOT = resolve(E2E_ROOT, '..');
export const ARTIFACTS = join(E2E_ROOT, 'artifacts');
export const SUITES = join(E2E_ROOT, 'suites');
const VIEWER_CACHE = join(ARTIFACTS, 'viewer-cache');
export const DIFF_CACHE = join(VIEWER_CACHE, 'diff');

const RUN_ID_RE = /^run-[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** Artifact bytes the viewer may serve. Bare `.log` (metro.log, bridge logs)
 * and anything under custody/ stay server-private. */
const SERVABLE_EXTENSIONS = ['.png', '.ax.json', '.json', '.jsonl', '.mp4'];

export function isValidRunDirName(name: string): boolean {
  return RUN_ID_RE.test(name);
}

/** Resolve a client-supplied relative path inside a root, refusing traversal,
 * absolute paths, symlinks, custody/ and non-allowlisted extensions.
 * Returns undefined when the path is not servable. */
export function safeArtifactPath(root: string, relPath: string): string | undefined {
  if (!relPath || isAbsolute(relPath)) return undefined;
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  if (rel.split('/').some((part) => part === 'custody')) return undefined;
  if (!SERVABLE_EXTENSIONS.some((ext) => abs.endsWith(ext))) return undefined;
  try {
    if (!lstatSync(abs).isFile()) return undefined;
  } catch {
    return undefined;
  }
  return abs;
}
