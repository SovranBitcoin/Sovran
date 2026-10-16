import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { digest, fileEvidence, git, within } from './workspace';

export const reference = z.object({
  repository: z.enum(['nuts', 'coco', 'cashu-ts', 'nutshell', 'cdk', 'cashu.me', 'macadamia', 'minibits_wallet', 'wallet']),
  commit: z.string().regex(/^[a-f0-9]{40}$/), paths: z.array(z.string().min(1)).min(1),
});

/** A cache path denotes exactly one upstream revision. Never reset a dirty cache.
 * Missing/renamed upstream repositories are evidence gaps, not silent substitutions. */
export function prepareReference(cache: string, input: unknown) {
  const ref = reference.parse(input);
  const directory = join(cache, 'cashubtc', ref.repository, ref.commit);
  const url = `https://github.com/cashubtc/${ref.repository}.git`;
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
    git(directory, ['init', '-q']); git(directory, ['remote', 'add', 'origin', url]);
    execFileSync('git', ['-C', directory, 'fetch', '--depth', '1', 'origin', ref.commit],
      { timeout: 120_000, stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    git(directory, ['checkout', '--detach', ref.commit]);
  }
  if (git(directory, ['remote', 'get-url', 'origin']) !== url || git(directory, ['rev-parse', 'HEAD']) !== ref.commit || git(directory, ['status', '--porcelain']))
    throw new Error(`Reference cache is incomplete, changed or has the wrong origin: ${directory}`);
  const files = ref.paths.map(path => ({ ...fileEvidence(directory, path), content: readFileSync(within(directory, path), 'utf8') }));
  return { ...ref, directory, url, files, sha256: digest(JSON.stringify({ ref, files })) };
}
