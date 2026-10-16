import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { digest, fileEvidence, git, within } from './workspace';

const repository = z.enum(['nuts', 'coco', 'cashu-ts', 'nutshell', 'cdk', 'cashu.me', 'macadamia', 'minibits_wallet', 'wallet']);
export const projects: Record<z.infer<typeof repository>, string> = {
  nuts: 'cashubtc/nuts', coco: 'cashubtc/coco', 'cashu-ts': 'cashubtc/cashu-ts',
  nutshell: 'cashubtc/nutshell', cdk: 'cashubtc/cdk', 'cashu.me': 'cashubtc/cashu.me',
  macadamia: 'zeugmaster/macadamia', minibits_wallet: 'minibits-cash/minibits_wallet', wallet: 'cashubtc/wallet',
};
export const reference = z.object({
  repository,
  commit: z.string().regex(/^[a-f0-9]{40}$/), paths: z.array(z.string().min(1)).min(1),
});

/** A cache path denotes exactly one upstream revision. Never reset a dirty cache.
 * Missing/renamed upstream repositories are evidence gaps, not silent substitutions. */
export function prepareReference(cache: string, input: unknown) {
  const ref = reference.parse(input);
  const project = projects[ref.repository];
  const directory = join(cache, project, ref.commit);
  const url = `https://github.com/${project}.git`;
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
  return { ...ref, directory, url, files, sha256: digest(JSON.stringify({ ref, url, files })) };
}
