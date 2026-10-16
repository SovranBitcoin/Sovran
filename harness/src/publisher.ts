import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { githubChecks } from './github-checks';
const sha = z.string().regex(/^[a-f0-9]{40,64}$/), text = z.string().min(1);
export const publishPlan = z.object({
  taskId: z.string().uuid(), root: text, repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  remote: z.string().regex(/^[\w.-]+$/), remoteUrl: text, branch: text, base: text,
  head: sha, baseHead: sha, previousRemoteHead: sha.nullable(),
  source: z.string().regex(/^[a-f0-9]{64}$/), title: text, body: text,
  requiredChecks: z.array(text).min(1),
}).superRefine((p, ctx) => {
  if (p.branch === p.base || ['main', 'master'].includes(p.branch)) ctx.addIssue({ code: 'custom', message: 'Publication needs its own branch' });
  if (new Set(p.requiredChecks).size !== p.requiredChecks.length) ctx.addIssue({ code: 'custom', message: 'Duplicate required checks' });
});
export type PublishPlan = z.infer<typeof publishPlan>;
const pr = z.object({ number: z.number().int().positive(), url: z.url(), state: text,
  headRefName: text, headRefOid: sha, baseRefName: text, baseRefOid: sha,
  // gh leaves headRepository.nameWithOwner empty for same-repository PRs; name and owner are filled.
  headRepository: z.object({ name: text }), headRepositoryOwner: z.object({ login: text }), isCrossRepository: z.boolean(),
  isDraft: z.boolean(), title: z.string(), body: z.string(), mergeable: text,
  mergeStateStatus: text, reviewDecision: z.string().nullable(),
});
type PullRequest = z.infer<typeof pr>;
const fields = Object.keys(pr.shape).join(',');
type Publication = { status: 'ci'; pr: PullRequest } | { status: 'unknown'; reason: string };
export class Publisher {
  constructor(private readonly dependencies: { fingerprint: (root: string) => string; gh?: string; env?: Record<string, string> }) {}
  private run(p: PublishPlan, binary: string, args: string[]) {
    const out = Bun.spawnSync([binary, ...args], { cwd: p.root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
      env: { ...process.env, ...this.dependencies.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } });
    return { code: out.exitCode, text: new TextDecoder().decode(out.stdout).trim() };
  }
  private git(p: PublishPlan, args: string[]) {
    const out = this.run(p, 'git', args); if (out.code !== 0) throw new Error('Git publication prerequisite or operation failed'); return out.text;
  }
  private gh(p: PublishPlan, args: string[]) { return this.run(p, this.dependencies.gh ?? 'gh', [...args, '--repo', p.repository]); }
  private remoteHead(p: PublishPlan, branch: string) {
    const rows = this.git(p, ['ls-remote', '--heads', '--', p.remoteUrl, `refs/heads/${branch}`]);
    if (!rows) return null;
    const matches = rows.split('\n'); if (matches.length !== 1) throw new Error('Ambiguous remote ref');
    return sha.parse(matches[0]?.split(/\s+/)[0]);
  }
  private guard(p: PublishPlan) {
    if (this.dependencies.fingerprint(p.root) !== p.source || this.git(p, ['status', '--porcelain'])) throw new Error('Candidate is dirty or differs from tested source');
    if (this.git(p, ['rev-parse', 'HEAD']) !== p.head || this.git(p, ['branch', '--show-current']) !== p.branch) throw new Error('Local publication head or branch changed');
    for (const branch of [p.branch, p.base]) this.git(p, ['check-ref-format', '--branch', branch]);
    if (this.git(p, ['remote', 'get-url', '--push', '--all', p.remote]) !== p.remoteUrl) throw new Error('Sealed push remote changed');
    if (this.remoteHead(p, p.base) !== p.baseHead) throw new Error('Base changed; integration evidence is stale');
  }
  private body(p: PublishPlan) { return `${p.body.trim()}\n\n<!-- sovran-task ${p.taskId} -->\n<!-- describes ${p.head} -->`; }
  private matches(p: PublishPlan, found: PullRequest) {
    const url = new URL(found.url);
    if (url.hostname !== 'github.com' || url.pathname !== `/${p.repository}/pull/${found.number}` ||
      `${found.headRepositoryOwner.login}/${found.headRepository.name}` !== p.repository || found.isCrossRepository ||
      found.headRefName !== p.branch || found.baseRefName !== p.base || found.headRefOid !== p.head || found.baseRefOid !== p.baseHead ||
      found.state !== 'OPEN' || !found.body.includes(`<!-- sovran-task ${p.taskId} -->`)) throw new Error('PR identity, ownership, state or revision differs');
  }
  private find(p: PublishPlan): PullRequest | null {
    const out = this.gh(p, ['pr', 'list', '--state', 'all', '--head', p.branch, '--base', p.base, '--limit', '100', '--json', fields]);
    if (out.code !== 0) throw new Error('PR lookup unavailable');
    const found = z.array(pr).parse(JSON.parse(out.text));
    if (found.length > 1) throw new Error('Multiple PRs for sealed branch; reconciliation is ambiguous');
    const candidate = found[0]; if (!candidate) return null;
    this.matches(p, candidate); return candidate;
  }
  /** Caller must own a durable publish intent. createAllowed is true only for the
   * initial uniquely claimed effect; ambiguous retries use reconcile(), never true. */
  publish(input: unknown, createAllowed: boolean): Publication {
    const p = publishPlan.parse(input); this.guard(p);
    const remote = this.remoteHead(p, p.branch);
    if (remote !== p.head) {
      if (remote !== p.previousRemoteHead) throw new Error('Remote branch changed; refusing overwrite');
      this.git(p, ['push', '--porcelain', '--', p.remoteUrl, `${p.head}:refs/heads/${p.branch}`]);
    }
    this.guard(p); if (this.remoteHead(p, p.branch) !== p.head) throw new Error('Pushed revision does not match');
    let found = this.find(p);
    const dir = mkdtempSync(join(tmpdir(), 'harness-pr-'));
    try {
      const bodyFile = join(dir, 'body.md'); writeFileSync(bodyFile, this.body(p), { mode: 0o600 });
      if (!found) {
        if (!createAllowed) return { status: 'unknown', reason: 'No matching PR after uncertain publication; do not blindly recreate' };
        this.gh(p, ['pr', 'create', '--head', p.branch, '--base', p.base, '--title', p.title, '--body-file', bodyFile, '--no-maintainer-edit']);
        found = this.find(p); // Reconcile even when create failed or its response was lost.
        if (!found) return { status: 'unknown', reason: 'PR creation outcome is unknown' };
      }
      if (found.title !== p.title || found.body !== this.body(p)) {
        const edited = this.gh(p, ['pr', 'edit', String(found.number), '--title', p.title, '--body-file', bodyFile]);
        if (edited.code !== 0) return { status: 'unknown', reason: 'PR metadata update outcome is unknown' };
      }
      this.guard(p); found = this.find(p);
      if (!found || found.body !== this.body(p) || found.title !== p.title) return { status: 'unknown', reason: 'Final PR metadata is not confirmed' };
      return { status: 'ci', pr: found };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  /** Read-only reconciliation; absence cannot establish that creation never happened. */
  reconcile(input: unknown): Publication {
    const p = publishPlan.parse(input); this.guard(p);
    if (this.remoteHead(p, p.branch) !== p.head) return { status: 'unknown', reason: 'Remote publication head is not confirmed' };
    const found = this.find(p);
    return found && found.title === p.title && found.body === this.body(p)
      ? { status: 'ci', pr: found } : { status: 'unknown', reason: 'PR identity or final metadata is not confirmed' };
  }
  check(input: unknown, number: number) {
    const p = publishPlan.parse(input); this.guard(p);
    const view = () => { const out = this.gh(p, ['pr', 'view', String(number), '--json', fields]); if (out.code !== 0) throw new Error('PR state unavailable'); const found = pr.parse(JSON.parse(out.text)); this.matches(p, found); return found; };
    const before = view();
    const evidence = githubChecks(p, number, args => this.run(p, this.dependencies.gh ?? 'gh', ['api', ...args]));
    const after = view(); this.guard(p);
    if (before.headRefOid !== after.headRefOid || before.baseRefOid !== after.baseRefOid || this.remoteHead(p, p.branch) !== p.head) throw new Error('PR changed during CI inspection');
    // UNSTABLE is GitHub's state for a failing check that blocks nothing; accept it only when such a check explains it.
    const merge = after.mergeStateStatus === 'CLEAN' || (after.mergeStateStatus === 'UNSTABLE' && evidence.outsideRequired.length > 0);
    const ready = !evidence.problems.length && !after.isDraft && after.mergeable === 'MERGEABLE' && merge &&
      !['CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(after.reviewDecision ?? '') && after.body === this.body(p) && after.title === p.title;
    const failed = evidence.failed || after.reviewDecision === 'CHANGES_REQUESTED';
    const status = ready ? 'ready' as const : failed ? 'failed' as const : 'waiting' as const;
    const outside = evidence.outsideRequired.length ? `; not required and not passing: ${evidence.outsideRequired.join('; ')}` : '';
    return { status, reason: ready ? `Exact head satisfies sealed checks, server requirements and current merge policy${outside}` :
      `Checks or PR merge policy are unsatisfied: ${evidence.problems.join('; ')}; merge=${after.mergeStateStatus}; review=${after.reviewDecision}`,
      pr: after, ...evidence };
  }
}
