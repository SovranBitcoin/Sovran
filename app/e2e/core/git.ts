import { createHash, type Hash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

/** Best-effort git state capture for run manifests. A run made from a clean
 * working tree is a "commit run": its screenshots are attributable to a single
 * SHA and safe to use as a visual-diff baseline. Never throws — callers treat
 * `undefined` as "git unavailable" and fall back to date-only labeling. */

export interface GitInfo {
  sha: string;
  shortSha: string;
  branch: string;
  dirty: boolean;
}

const GIT_TIMEOUT_MS = 2_000;

/** Artifacts are gitignored, but a future un-ignore must never flip clean runs
 * to dirty: porcelain lines under the artifacts tree are always excluded. */
const ARTIFACTS_PORCELAIN_PREFIX = 'app/e2e/artifacts/';

interface SourceFingerprintDependencies {
  runGit?: (cwd: string, args: string[]) => string | undefined;
}

type SourceFingerprintComparison =
  { status: 'stable'; fingerprint: string } | { status: 'changed' } | { status: 'unavailable' };

export function compareSourceFingerprints(
  beforeLoad: string | undefined,
  afterSelection: string | undefined
): SourceFingerprintComparison {
  if (!beforeLoad || !afterSelection) return { status: 'unavailable' };
  if (beforeLoad !== afterSelection) return { status: 'changed' };
  return { status: 'stable', fingerprint: afterSelection };
}

function updateFingerprintChunk(hash: Hash, value: string | Buffer): void {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function git(cwd: string, args: string[]): string | undefined {
  try {
    const result = Bun.spawnSync(['git', ...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      stdout: 'pipe',
      stderr: 'ignore',
    });
    if (result.exitCode !== 0) return undefined;
    return new TextDecoder().decode(result.stdout);
  } catch {
    return undefined;
  }
}

/** Porcelain lines are `XY path` (or `XY old -> new` for renames); a rename
 * counts as dirty unless both sides live under the artifacts tree. */
export function dirtyFromPorcelain(porcelain: string): boolean {
  return porcelain
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .some((line) => {
      const paths = line.slice(3).split(' -> ');
      return !paths.every((path) => path.startsWith(ARTIFACTS_PORCELAIN_PREFIX));
    });
}

export function captureGitInfo(cwd: string): GitInfo | undefined {
  const sha = git(cwd, ['rev-parse', 'HEAD'])?.trim();
  if (!sha) return undefined;
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  const porcelain = git(cwd, ['status', '--porcelain']);
  if (branch === undefined || porcelain === undefined) return undefined;
  return { sha, shortSha: sha.slice(0, 7), branch, dirty: dirtyFromPorcelain(porcelain) };
}

export function fingerprintSourceFiles(
  root: string,
  files: readonly string[],
  options: {
    excludeArtifacts?: boolean;
    runGit?: NonNullable<SourceFingerprintDependencies['runGit']>;
  } = { excludeArtifacts: true }
): string | undefined {
  try {
    const runGit = options.runGit ?? git;
    const paths = files
      .filter(
        (path) =>
          path.length > 0 &&
          (options.excludeArtifacts !== true || !path.startsWith(ARTIFACTS_PORCELAIN_PREFIX))
      )
      .sort();
    const hash = createHash('sha256');
    for (const path of paths) {
      const absolute = join(root, path);
      let stat: ReturnType<typeof lstatSync> | undefined;
      try {
        stat = lstatSync(absolute);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          updateFingerprintChunk(hash, path);
          updateFingerprintChunk(hash, 'missing');
          updateFingerprintChunk(hash, '');
          continue;
        }
        return undefined;
      }
      const kind = stat.isSymbolicLink()
        ? 'symlink'
        : stat.isFile()
          ? 'file'
          : stat.isDirectory()
            ? 'gitlink'
            : undefined;
      if (!kind) return undefined;
      if (kind === 'gitlink') {
        const nestedRoot = runGit(absolute, ['rev-parse', '--show-toplevel'])?.trim();
        if (!nestedRoot || realpathSync(nestedRoot) !== realpathSync(absolute)) return undefined;
      }
      const contents =
        kind === 'symlink'
          ? Buffer.from(readlinkSync(absolute))
          : kind === 'gitlink'
            ? captureSourceFingerprintInternal(absolute, false, runGit)
            : readFileSync(absolute);
      if (contents === undefined) return undefined;
      updateFingerprintChunk(hash, path);
      updateFingerprintChunk(
        hash,
        kind === 'symlink'
          ? '120000'
          : kind === 'gitlink'
            ? '160000'
            : stat.mode & 0o111
              ? '100755'
              : '100644'
      );
      updateFingerprintChunk(hash, contents);
    }
    return hash.digest('hex');
  } catch {
    return undefined;
  }
}

/** SHA-256 over every tracked and untracked-nonignored repository file.
 * Paths, file modes, file kinds, and contents are length-framed so the digest
 * is deterministic and unambiguous. Run artifacts are always excluded because
 * writing evidence must not invalidate the source snapshot it proves. */
function captureSourceFingerprintInternal(
  cwd: string,
  excludeArtifacts: boolean,
  runGit: NonNullable<SourceFingerprintDependencies['runGit']>
): string | undefined {
  try {
    const root = runGit(cwd, ['rev-parse', '--show-toplevel'])?.trim();
    if (!root) return undefined;
    const listed = runGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    if (listed === undefined) return undefined;
    return fingerprintSourceFiles(root, listed.split('\0'), { excludeArtifacts, runGit });
  } catch {
    return undefined;
  }
}

export function captureSourceFingerprint(
  cwd: string,
  dependencies: SourceFingerprintDependencies = {}
): string | undefined {
  return captureSourceFingerprintInternal(cwd, true, dependencies.runGit ?? git);
}
