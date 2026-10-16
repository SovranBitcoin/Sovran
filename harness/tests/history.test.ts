import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './controller.test';
import { Controller } from '../src/controller';
import { git } from '../src/workspace';
import { assessmentFor, type Task } from '../src/workflow';

function investigation(t: Task, path = 'source.txt') {
  if (!t.historyEvidence) throw new Error('Missing captured history');
  const evidence = [`artifact:${t.historyEvidence.path}`];
  return { path, owner: 'source.txt', intent: 'recorded', reason: 'The fixture was introduced to preserve original text',
    preserveBy: 'Keep the original text while changing only the declared behavior',
    changes: { status: 'complete', explanation: 'Read the initial commit and baseline blame', evidence },
    callersAndTests: { status: 'not-applicable', explanation: 'This isolated text fixture has no callers or tests', evidence: [] },
    priorPRs: { status: 'gap', explanation: 'Fixture repository has no remote PR discussions', evidence: [] },
    followups: { status: 'not-applicable', explanation: 'Fixture repository has no follow-up ledger in its history', evidence: [] } };
}
function submit(c: Controller, id: string, extra: Record<string, unknown> = {}) {
  const t = c.next(id), ticket = t.ticket;
  if (!ticket) throw new Error('Missing ticket');
  c.claim(id, ticket.id, ticket.id, ticket.target.provider, ticket.target.model);
  return c.submit(id, ticket.id, ticket.id, {
    verdict: 'pass', summary: 'Inspected requirement and evidence', findings: [],
    observations: [{ requirement: 'behavior', evidence: 'source.txt', observation: 'Original protection checked' }],
    reuse: { searched: ['source.txt'], used: ['source.txt'], added: [], removed: [] },
    inspections: c.brief(id).packet.artifacts.map(a => ({ ...a, observation: 'Read the retained bytes' })), ...extra,
  });
}

test('pre-edit history is captured before research and cannot be omitted or replaced on restart', () => {
  const { controller: c, root, spec, state } = fixture();
  const t = c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] } });
  if (!t.historyEvidence) throw new Error('Missing history');
  const baseline = JSON.parse(readFileSync(join(state, t.id, t.historyEvidence.path), 'utf8'));
  expect(baseline.base).toBe(t.base); expect(baseline.files[0].blame).toContain('original');
  expect(baseline.files[0].changes[0].patch).toContain('+original');
  expect(() => submit(c, t.id)).toThrow('every planned path');
  const resumed = new Controller(state);
  try {
    expect(submit(resumed, t.id, { history: [investigation(t)] }).phase).toBe('intake');
    resumed.seal(t.id, t.policy); resumed.next(t.id);
    expect(resumed.brief(t.id).packet.research[0]?.result.history?.[0]?.reason).toContain('preserve original');
    writeFileSync(join(state, t.id, t.historyEvidence.path), '{}');
    expect(() => resumed.brief(t.id)).toThrow('Evidence changed');
  } finally { resumed.close(); }
});

test('deleted follow-ups and old guards can be cited from pinned reachable history', () => {
  const { controller: c, root, spec } = fixture();
  writeFileSync(join(root, 'closed-followup.md'), 'Preserve the guard from the earlier incident');
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'Document regression']);
  const revision = git(root, ['rev-parse', 'HEAD']);
  unlinkSync(join(root, 'closed-followup.md')); git(root, ['commit', '-qam', 'Resolve follow-up']);
  const t = c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] } });
  const entry = investigation(t);
  const followups = { status: 'complete', explanation: 'Read the removed follow-up and closing change', evidence: [`git:${revision}:closed-followup.md`] };
  expect(() => submit(c, t.id, { history: [{ ...entry, followups: { ...followups, evidence: [`git:${revision}:missing.md`] } }] })).toThrow();
  expect(() => submit(c, t.id, { history: [{ ...entry, followups: { ...followups, evidence: [`git:${revision}:../outside`] } }] })).toThrow();
  expect(submit(c, t.id, { history: [{ ...entry, followups }] }).phase).toBe('intake');
});

test('an unrelated commit cannot masquerade as authorized historical evidence', () => {
  const { controller: c, root, spec } = fixture();
  const base = git(root, ['rev-parse', 'HEAD']);
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
  const unrelated = git(root, ['commit-tree', tree, '-m', 'Unrelated history']);
  const t = c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] } });
  expect(t.base).toBe(base);
  expect(() => submit(c, t.id, { history: [{ ...investigation(t), changes: {
    status: 'complete', explanation: 'Unrelated tree is not the historical source', evidence: [`git:${unrelated}:source.txt`],
  } }] })).toThrow();
});

test('a writer cannot add uninvestigated paths inside its otherwise authorized scope', () => {
  const { controller: c, root, spec } = fixture();
  let t = c.create(root, { ...spec, scope: ['source.txt', 'new.txt'], historyPolicy: { version: 1, paths: ['source.txt'] } });
  t = submit(c, t.id, { history: [investigation(t)] }); t = c.seal(t.id, t.policy);
  writeFileSync(join(root, 'new.txt'), 'uninvestigated');
  expect(() => submit(c, t.id)).toThrow('Changes lack pre-edit history');
  expect(c.read(t.id).phase).toBe('implementing');
});

test('final audit rechecks the actual changed paths against their historical protection', async () => {
  const { controller: c, root, spec } = fixture();
  let t = c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] } });
  t = submit(c, t.id, { history: [investigation(t)] }); t = c.seal(t.id, t.policy);
  writeFileSync(join(root, 'source.txt'), 'original plus declared change');
  t = submit(c, t.id); t = await c.verify(t.id); t = submit(c, t.id); t = submit(c, t.id); await c.verify(t.id, true);
  expect(() => submit(c, t.id)).toThrow('Final audit must recheck history');
  expect(submit(c, t.id, { historyReview: [{ path: 'source.txt', observation: 'The original guard survives and related follow-up evidence remains applicable', evidence: [`git:${t.base}:source.txt`, 'source.txt'] }] }).phase).toBe('publishable');
});

test('planned paths cannot add authority and completed history cannot omit its sources', () => {
  const { controller: c, root, spec } = fixture();
  expect(() => c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['elsewhere'] } })).toThrow('within sealed scope');
  expect(() => c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt', 'source.txt'] } })).toThrow('unique');
  const t = c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] } });
  expect(() => submit(c, t.id, { history: [{ ...investigation(t), changes: { status: 'complete', explanation: 'Claimed complete without retrieval', evidence: [] } }] })).toThrow('Completed investigation needs evidence');
});

test('path-inferred money risk cannot bypass unknown historical protection with an empty declared risk list', () => {
  const { controller: c, root, spec } = fixture();
  mkdirSync(join(root, 'wallet')); writeFileSync(join(root, 'wallet', 'guard.ts'), 'export const guard = true;');
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'Preserve payment guard']);
  const t = c.create(root, { ...spec, scope: ['wallet/guard.ts'], risks: [], historyPolicy: { version: 1, paths: ['wallet/guard.ts'] } });
  expect(() => submit(c, t.id, { history: [{ ...investigation(t, 'wallet/guard.ts'), owner: 'wallet/guard.ts', intent: 'unknown' }] })).toThrow('Unknown historical protection');
});

test('a failed legacy implementation can retain its outcome even when its edited manifest is invalid', () => {
  const { controller: c, root, spec } = fixture();
  let t = submit(c, c.create(root, { ...spec, scope: ['package.json'] }).id);
  t = c.seal(t.id, t.policy);
  writeFileSync(join(root, 'package.json'), 'invalid unfinished JSON');
  t = submit(c, t.id, { verdict: 'inconclusive', summary: 'Interrupted manifest edit; source preserved for investigation' });
  expect(t.phase).toBe('incomplete');
  expect(t.assessments.at(-1)?.result.summary).toContain('Interrupted manifest edit');
});

test("a research brief offers only research's fields, and the controller refuses the audit's", () => {
  const { controller: c, root, spec } = fixture();
  const t = c.create(root, { ...spec, historyPolicy: { version: 1, paths: ['source.txt'] } });
  c.next(t.id);
  const fields = Object.keys((c.brief(t.id).packet.assessmentSchema as { properties: object }).properties);
  expect(fields).toContain('history');
  for (const foreign of ['historyReview', 'resolutionProposals', 'resolutionReviews']) expect(fields).not.toContain(foreign);
  // Live 2026-10-16: shown the full schema, a research worker added the audit's historyReview.
  const review = { path: 'source.txt', observation: 'Rechecked', evidence: ['source.txt'] };
  expect(() => submit(c, t.id, { history: [investigation(t)], historyReview: [review] })).toThrow('belongs to audit');
});

test('each role is offered exactly the owned assessment fields it may submit', () => {
  const owned = { research: ['history'], implementation: ['resolutionProposals'], audit: ['historyReview', 'resolutionReviews'],
    review: [], adversary: [], diversityReview: [] } as const;
  const all = Object.values(owned).flat();
  for (const [role, mine] of Object.entries(owned)) {
    const fields = Object.keys(assessmentFor(role as keyof typeof owned).shape);
    expect([role, all.filter(f => fields.includes(f)).sort()]).toEqual([role, [...mine].sort()]);
  }
});
