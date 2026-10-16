import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { git } from './workspace';
import type { Task } from './workflow';

const text = z.string().trim().min(1);
const path = text.refine(p => !p.startsWith('/') && !p.includes('\\') && !p.split('/').some(s => s === '..' || s === '.' || !s), 'Use an exact repository-relative path');
export const historyPolicy = z.object({ version: z.literal(1), paths: z.array(path).min(1).max(30) });
const investigation = z.object({
  status: z.enum(['complete', 'gap', 'not-applicable']), explanation: text, evidence: z.array(text),
}).refine(i => i.status !== 'complete' || i.evidence.length > 0, 'Completed investigation needs evidence');
export const historyEntry = z.object({
  path, owner: path, intent: z.enum(['recorded', 'inferred', 'unknown']),
  reason: text, preserveBy: text,
  changes: investigation, callersAndTests: investigation, priorPRs: investigation, followups: investigation,
});
export const historyReview = z.object({ path, observation: text, evidence: z.array(text).min(1) });

/** Capture baseline facts before any writer. Bounded history is a starting point, not complete intent. */
export function captureHistory(root: string, base: string, paths: string[]) {
  return { base, limitation: 'At most eight path-specific changes. Follow older blame commits, renames, PR discussions and removed follow-ups where relevant; missing retrieval remains a gap.',
    files: paths.map(file => {
      const entry = git(root, ['ls-tree', '-z', base, '--', file]);
      if (!entry) return { path: file, kind: 'new' as const };
      if (!/^100(644|755) blob /.test(entry)) throw new Error(`History requires a regular source file: ${file}`);
      const blob = git(root, ['rev-parse', `${base}:${file}`]);
      const blame = git(root, ['blame', '--line-porcelain', base, '--', file]);
      const commits = git(root, ['log', '--follow', '-n', '8', '--format=%H', base, '--', file]).split('\n').filter(Boolean);
      return { path: file, kind: 'existing' as const, blob, blame,
        changes: commits.map(commit => ({ commit, patch: git(root, ['show', '--format=fuller', '--find-renames', commit, '--', file]) })) };
    }),
  };
}

/** Historical citations can name deleted files, but never revisions outside sealed ancestry. */
export function inspectHistoricalReference(t: Task, reference: string) {
  const match = /^git:([a-f0-9]{40}):(.+)$/.exec(reference);
  if (!match) throw new Error('Historical evidence must be git:<full commit>:<relative file>');
  const revision = match[1], file = match[2];
  if (!revision || !file) throw new Error('Missing historical revision or path');
  path.parse(file);
  git(t.root, ['merge-base', '--is-ancestor', revision, t.base]);
  if (git(t.root, ['cat-file', '-t', `${revision}:${file}`]) !== 'blob') throw new Error('Historical evidence must be a file');
  // Read the exact immutable bytes; existence of a revision alone is not retrieved evidence.
  execFileSync('git', ['-C', t.root, 'cat-file', 'blob', `${revision}:${file}`], { maxBuffer: 16 * 1024 * 1024 });
}

export function validateHistory(t: Task, role: string, result: Task['assessments'][number]['result'],
  changed: string[], inspect: (reference: string) => void) {
  const policy = t.contract.historyPolicy;
  if (!policy) return; // Old records retain their explicitly limited authority and evidence.
  if (!t.historyEvidence) throw new Error('Pre-edit history snapshot missing');
  inspect(`artifact:${t.historyEvidence.path}`);
  if (result.history?.length && role !== 'research') throw new Error('Initial history belongs to research');
  if (result.historyReview?.length && role !== 'audit') throw new Error('Final history review belongs to audit');
  const entries = role === 'research' ? result.history ?? [] : t.assessments.filter(a => a.role === 'research' && a.result.verdict === 'pass').flatMap(a => a.result.history ?? []);
  if (role === 'research' && result.verdict === 'pass') {
    if (new Set(entries.map(e => e.path)).size !== entries.length || entries.length !== policy.paths.length || policy.paths.some(p => !entries.some(e => e.path === p)))
      throw new Error('Research must investigate every planned path exactly once');
    if (!result.inspections.some(i => i.path === t.historyEvidence?.path && i.sha256 === t.historyEvidence.sha256))
      throw new Error('Research must inspect the pre-edit history snapshot');
    for (const entry of entries) {
      inspectHistoricalReference(t, `git:${t.base}:${entry.owner}`);
      for (const inquiry of [entry.changes, entry.callersAndTests, entry.priorPRs, entry.followups])
        for (const citation of inquiry.evidence) inspect(citation);
      if (entry.intent === 'unknown' && t.contract.risks.some(r => r === 'payments' || r === 'persistence'))
        throw new Error('Unknown historical protection cannot authorize money or persistence edits');
    }
  }
  if (role !== 'research' && result.verdict === 'pass') {
    const uncovered = changed.filter(p => !entries.some(e => e.path === p));
    if (uncovered.length) throw new Error(`Changes lack pre-edit history: ${uncovered.join(', ')}`);
  }
  if (role === 'audit' && result.verdict === 'pass') {
    const reviews = result.historyReview ?? [];
    if (new Set(reviews.map(r => r.path)).size !== reviews.length || changed.some(p => !reviews.some(r => r.path === p)))
      throw new Error('Final audit must recheck history and follow-ups for every changed path');
    for (const review of reviews) for (const citation of review.evidence) inspect(citation);
  }
}
