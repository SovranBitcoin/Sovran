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

function git(cwd: string, args: string[]): string | undefined {
  try {
    const result = Bun.spawnSync(['git', ...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      stdout: 'pipe',
      stderr: 'ignore',
    });
    if (result.exitCode !== 0) return undefined;
    return result.stdout.toString();
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
