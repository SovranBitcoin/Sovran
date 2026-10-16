import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller } from '../src/controller';
import { git } from '../src/workspace';
import type { Contract, Task } from '../src/workflow';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-source-'));
  const state = mkdtempSync(join(tmpdir(), 'harness-state-'));
  cleanups.push(() => { rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); });
  git(root, ['init', '-q']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']);
  writeFileSync(join(root, 'source.txt'), 'original');
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'fixture']);
  const controller = new Controller(state); cleanups.push(() => controller.close());
  const spec: Contract = {
    problem: 'Test the harness', requirements: [{ id: 'behavior', outcome: 'Preserve original text' }], scope: ['source.txt'],
    risks: [], checks: [{ id: 'tests', argv: ['bun', '-e', 'console.log("real check ran")'], cwd: '.', timeoutMs: 5000 }],
    auditChecks: [{ id: 'audit', argv: ['bun', '-e', 'console.log("real audit ran")'], cwd: '.', timeoutMs: 5000 }],
    contextFiles: ['source.txt'], references: [], allowedDependencies: [],
    models: { research: { provider: 'codex', model: 'luna' }, implementation: { provider: 'codex', model: 'sol' }, review: { provider: 'claudeAgent', model: 'opus' }, adversary: { provider: 'claudeAgent', model: 'fable' }, audit: { provider: 'claudeAgent', model: 'opus' } },
    limits: { deadline: new Date(Date.now() + 60_000).toISOString(), repairRounds: 2 }, publish: { kind: 'local-only' },
  };
  return { root, state, controller, spec };
}
const report = { verdict: 'pass', summary: 'Inspected source', observations: [{ requirement: 'behavior', evidence: 'source.txt', observation: 'original retained' }], findings: [], reuse: { searched: ['source.txt'], used: ['source.txt'], added: [], removed: [] } };
function finish(c: Controller, t: Task) {
  const ticket = c.next(t.id).ticket;
  if (!ticket) throw new Error('Expected dispatch');
  c.claim(t.id, ticket.id, ticket.id, ticket.target.provider, ticket.target.model);
  return c.submit(t.id, ticket.id, ticket.id, { ...report,
    inspections: c.read(t.id).receipts.flatMap(r => r.artifacts).map(a => ({ ...a, observation: 'Read fixture command output' })) });
}

test('the public controller runs actual checks and will not skip review or audit', async () => {
  const { controller: c, root, spec } = fixture();
  let t = c.create(root, spec);
  expect(() => c.seal(t.id, t.policy)).toThrow('Cannot SEAL');
  t = finish(c, t); expect(t.phase).toBe('intake');
  t = c.seal(t.id, t.policy); t = finish(c, t);
  expect(t.phase).toBe('verifying');
  t = await c.verify(t.id); expect(t.phase).toBe('reviewing');
  expect(t.receipts[0]?.summary).toContain('Exit 0');
  t = finish(c, t); expect(t.phase).toBe('adversarial');
  t = finish(c, t); expect(t.phase).toBe('auditing');
  expect(() => finish(c, t)).toThrow('Run every audit');
  await c.verify(t.id, true);
  t = finish(c, t); expect(t.phase).toBe('publishable');
  expect(t.pr).toBeNull();
});

test('a different worker cannot claim a ticket after controller restart', () => {
  const { controller: c, root, state, spec } = fixture();
  const t = c.create(root, spec);
  const ticket = c.next(t.id).ticket;
  if (!ticket) throw new Error('Missing ticket');
  c.claim(t.id, ticket.id, 'worker-1', 'codex', 'luna');
  const resumed = new Controller(state);
  try {
    expect(() => resumed.claim(t.id, ticket.id, 'worker-2', 'codex', 'luna')).toThrow('already claimed');
    expect(resumed.next(t.id).ticket?.claim?.worker).toBe('worker-1');
  } finally { resumed.close(); }
});

test('findings need real file evidence before a submission can advance', () => {
  const { controller: c, root, spec } = fixture();
  const t = c.next(c.create(root, spec).id);
  const ticket = t.ticket;
  if (!ticket) throw new Error('Missing ticket');
  c.claim(t.id, ticket.id, 'researcher', ticket.target.provider, ticket.target.model);
  const finding = { id: 'followup', severity: 'follow-up', detail: 'Consider simplifying the source' };
  for (const evidence of ['missing.txt', '.', join(root, 'source.txt'), 'artifact:unregistered.json']) {
    expect(() => c.submit(t.id, ticket.id, 'researcher', {
      ...report, findings: [{ ...finding, evidence }],
    })).toThrow();
    expect(c.read(t.id).phase).toBe('researching');
    expect(c.read(t.id).assessments).toEqual([]);
  }
  expect(c.submit(t.id, ticket.id, 'researcher', {
    ...report, findings: [{ ...finding, evidence: 'source.txt' }],
  }).phase).toBe('intake');
});

test('artifact citations require registered, unchanged evidence, including in findings', async () => {
  const { controller: c, root, state, spec } = fixture();
  let t = finish(c, c.create(root, spec));
  t = c.seal(t.id, t.policy); t = finish(c, t); t = await c.verify(t.id); t = c.next(t.id);
  const ticket = t.ticket;
  const log = t.receipts[0]?.artifacts[0];
  if (!ticket || !log) throw new Error('Missing review evidence');
  c.claim(t.id, ticket.id, 'reviewer', ticket.target.provider, ticket.target.model);
  const inspections = t.receipts.flatMap(r => r.artifacts).map(a => ({ ...a, observation: 'Read log' }));
  const submit = (evidence: string) => c.submit(t.id, ticket.id, 'reviewer', {
    ...report, inspections, findings: [{ id: 'note', severity: 'follow-up', evidence, detail: 'Observed command output' }],
  });
  writeFileSync(join(state, t.id, 'unregistered.json'), '{}');
  expect(() => submit('artifact:unregistered.json')).toThrow('Unregistered evidence artifact');
  const logPath = join(state, t.id, log.path);
  const original = readFileSync(logPath);
  writeFileSync(logPath, 'forged output');
  expect(() => submit(`artifact:${log.path}`)).toThrow('Evidence changed');
  writeFileSync(logPath, original);
  expect(submit(`artifact:${log.path}`).phase).toBe('adversarial');
});

test('accepted research reaches implementation after restart with its source and artifact', () => {
  const { controller: c, root, state, spec } = fixture();
  let t = finish(c, c.create(root, spec));
  t = c.seal(t.id, t.policy);
  const research = t.assessments[0];
  if (!research) throw new Error('Missing research');
  const resumed = new Controller(state);
  try {
    resumed.next(t.id);
    expect(resumed.brief(t.id).packet).toMatchObject({
      research: [{ source: research.source, artifact: research.artifact,
        result: { summary: 'Inspected source', observations: report.observations, reuse: report.reuse } }],
    });
    writeFileSync(join(state, t.id, research.artifact.path), '{}');
    expect(() => resumed.brief(t.id)).toThrow('Research evidence changed');
  } finally { resumed.close(); }
});

test('code changing after verification invalidates the reviewer submission', async () => {
  const { controller: c, root, spec } = fixture();
  let t = finish(c, c.create(root, spec));
  t = c.seal(t.id, t.policy); t = finish(c, t); t = await c.verify(t.id);
  writeFileSync(join(root, 'source.txt'), 'different');
  expect(() => finish(c, t)).toThrow('Candidate changed');
  expect(c.read(t.id).phase).toBe('reviewing');
});

test('failed verification returns to implementation without reusing its receipts', async () => {
  const { controller: c, root, spec } = fixture();
  spec.checks[0] = { id: 'fails', argv: ['bun', '-e', 'process.exit(1)'], cwd: '.', timeoutMs: 1000 };
  let t = finish(c, c.create(root, spec));
  t = c.seal(t.id, t.policy); t = finish(c, t); t = await c.verify(t.id);
  expect(t.phase).toBe('implementing'); expect(t.generation).toBe(1); expect(t.receipts).toEqual([]);
  t = finish(c, t); t = await c.verify(t.id); t = finish(c, t); t = await c.verify(t.id);
  expect(t.phase).toBe('incomplete'); expect(t.reason).toContain('Repair budget exhausted');
});

test('a command that changes source retains its result and releases pending work', async () => {
  const { controller: c, root, spec } = fixture();
  spec.checks[0] = { id: 'drift', argv: ['bun', '-e', 'await Bun.write("source.txt", "changed")'], cwd: '.', timeoutMs: 1000 };
  let t = finish(c, c.create(root, spec)); t = c.seal(t.id, t.policy); t = finish(c, t);
  t = await c.verify(t.id);
  expect(t.phase).toBe('incomplete'); expect(t.pending.kind).toBe('none');
  expect(t.receipts[0]?.outcome).toBe('inconclusive');
  expect(t.receipts[0]?.artifacts.length).toBe(2);
});

test('a second task cannot own the same workspace while the first is active', () => {
  const { controller: c, root, spec } = fixture();
  const t = c.create(root, spec);
  expect(() => c.create(root, spec)).toThrow('Workspace already has outstanding work');
  c.stop(t.id, 'done', 'No worker dispatched');
  expect(c.create(root, spec).phase).toBe('researching');
});

test('a timed out check cannot leave a descendant writing into the next generation', async () => {
  const { controller: c, root, spec } = fixture();
  const child = 'setTimeout(() => Bun.write("late.txt", "escaped"), 600)';
  spec.checks[0] = { id: 'timeout', argv: ['bun', '-e', `Bun.spawn(['bun','-e',${JSON.stringify(child)}]); setTimeout(() => {}, 5000)`], cwd: '.', timeoutMs: 150 };
  let t = finish(c, c.create(root, spec)); t = c.seal(t.id, t.policy); t = finish(c, t);
  await c.verify(t.id);
  await Bun.sleep(800);
  expect(existsSync(join(root, 'late.txt'))).toBe(false);
});

test('a missing launch directory leaves no uncertain external effect', async () => {
  const { controller: c, root, spec } = fixture();
  spec.checks[0] = { id: 'missing', argv: ['bun', '-e', 'process.exit(0)'], cwd: 'missing', timeoutMs: 1000 };
  let t = finish(c, c.create(root, spec)); t = c.seal(t.id, t.policy); t = finish(c, t);
  await expect(c.verify(t.id)).rejects.toThrow();
  expect(c.read(t.id).pending.kind).toBe('none');
  expect(c.repair(t.id, 'Correct the sealed environment without changing the command').phase).toBe('implementing');
});

test('simultaneous verification admits one command owner across controller connections', async () => {
  const { controller: c, root, state, spec } = fixture();
  const effect = join(state, 'effects');
  spec.checks[0] = { id: 'once', argv: ['bun', '-e', `require('node:fs').appendFileSync(${JSON.stringify(effect)}, 'executed\\n'); await Bun.sleep(100)`], cwd: '.', timeoutMs: 1000 };
  let t = finish(c, c.create(root, spec)); t = c.seal(t.id, t.policy); t = finish(c, t);
  const other = new Controller(state);
  try {
    const results = await Promise.allSettled([c.verify(t.id), other.verify(t.id)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await Bun.file(effect).text()).toBe('executed\n');
    expect(c.read(t.id).receipts).toHaveLength(1);
  } finally { other.close(); }
});

test('implementation cannot silently expand its sealed scope', () => {
  const { controller: c, root, spec } = fixture();
  let t = finish(c, c.create(root, spec)); t = c.seal(t.id, t.policy);
  writeFileSync(join(root, 'unrequested.txt'), 'extra work');
  expect(() => finish(c, t)).toThrow('Outside sealed scope');
});

test('a subdirectory cannot bypass workspace ownership', () => {
  const { controller: c, root, spec } = fixture();
  mkdirSync(join(root, 'child'));
  c.create(root, spec);
  expect(() => c.create(join(root, 'child'), spec)).toThrow('Workspace already has outstanding work');
});

test('a dependency version change requires its exact intake allowance', () => {
  const { controller: c, root, spec } = fixture();
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { existing: '1.0.0' } }));
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'existing dependency']);
  spec.scope.push('package.json');
  let t = finish(c, c.create(root, spec)); t = c.seal(t.id, t.policy);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { existing: '2.0.0' } }));
  expect(() => finish(c, t)).toThrow('existing@2.0.0');
});

test('review cannot pass without reading the actual check artifacts', async () => {
  const { controller: c, root, spec } = fixture();
  let t = finish(c, c.create(root, spec)); t = c.seal(t.id, t.policy); t = finish(c, t); t = await c.verify(t.id);
  const ticket = c.next(t.id).ticket;
  if (!ticket) throw new Error('Missing reviewer');
  c.claim(t.id, ticket.id, ticket.id, ticket.target.provider, ticket.target.model);
  expect(() => c.submit(t.id, ticket.id, ticket.id, report)).toThrow('Missing artifact inspection');
});

test('role context keeps the original instructions after implementation edits them', () => {
  const { controller: c, root, spec } = fixture();
  let t = finish(c, c.create(root, spec)); t = c.seal(t.id, t.policy);
  writeFileSync(join(root, 'source.txt'), 'new instructions');
  c.next(t.id);
  expect(c.brief(t.id).packet.context[0]?.content).toBe('original');
});

test('a green generic command cannot certify functional UI or performance', async () => {
  const { controller: c, root, spec } = fixture();
  spec.risks = ['ui', 'performance'];
  let t = finish(c, c.create(root, spec)); t = c.seal(t.id, t.policy); t = finish(c, t);
  t = await c.verify(t.id);
  expect(t.phase).toBe('incomplete'); expect(t.reason).toContain('installed binary');
});

test('resolver overrides cannot change outside dependency authorization', () => {
  const { controller: c, root, spec } = fixture();
  writeFileSync(join(root, 'package.json'), JSON.stringify({ overrides: { transitive: '1.0.0' } }));
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'existing override']); spec.scope.push('package.json');
  let t = finish(c, c.create(root, spec)); t = c.seal(t.id, t.policy);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ overrides: { transitive: '2.0.0' } }));
  expect(() => finish(c, t)).toThrow('Dependency policy needs intake authorization');
});

test('repair gives the next worker the failure reason and real logs without reusing a pass', async () => {
  const { controller: c, root, state, spec } = fixture();
  spec.checks[0] = { id: 'fails', argv: ['bun', '-e', 'console.error("diagnostic for repair"); process.exit(1)'], cwd: '.', timeoutMs: 1000 };
  let t = finish(c, c.create(root, spec)); t = c.seal(t.id, t.policy); t = finish(c, t); t = await c.verify(t.id);
  c.next(t.id);
  const packet = c.brief(t.id).packet;
  expect(packet.repairReason).toContain('fails');
  expect(await Bun.file(join(state, t.id, packet.artifacts.find(a => a.path.endsWith('.stderr'))?.path ?? 'missing')).text()).toContain('diagnostic for repair');
  expect(c.read(t.id).receipts).toEqual([]);
});

test('definitively undispatched work can be withdrawn without inventing a child', () => {
  const { controller: c, root, spec } = fixture();
  const t = c.next(c.create(root, spec).id);
  if (!t.ticket) throw new Error('Missing ticket');
  c.stop(t.id, 'unavailable', 'Provider rejected dispatch before creation');
  c.withdrawTicket(t.id, t.ticket.id, 'No delegation was attempted');
  expect(c.create(root, spec).phase).toBe('researching');
});

test('older PR authority remains inspectable and cancellable without gaining new authority', () => {
  const { controller: c, root, spec } = fixture();
  const t = c.create(root, spec); c.stop(t.id, 'fixture', 'Release fixture root');
  const original = { kind: 'pull-request', remote: 'origin', base: 'main', branch: 'task/old' };
  const id = '00000000-0000-4000-8000-000000000001';
  c.journal.create(id, { ...t, id, contract: { ...spec, publish: original } });
  expect(c.read(id).contract.publish).toEqual({ kind: 'legacy-pull-request', original });
  expect(c.stop(id, 'unsupported', 'New publication authority requires fresh intake').phase).toBe('incomplete');
  expect(c.read(id).contract.publish).toEqual({ kind: 'legacy-pull-request', original });
});

test('publication cannot include changes preceding the sealed task', () => {
  const { controller: c, root, spec } = fixture();
  spec.publish = { kind: 'pull-request', remote: 'origin', branch: 'task/new', base: 'main', repository: 'fixture/wallet',
    remoteUrl: 'https://github.com/fixture/wallet.git', baseHead: 'a'.repeat(40), previousRemoteHead: null, requiredChecks: ['tests'] };
  expect(() => c.create(root, spec)).toThrow('entire published diff');
});

function finishWith(c: Controller, t: Task, changes: Record<string, unknown> = {}) {
  const ticket = c.next(t.id).ticket;
  if (!ticket) throw new Error('Expected dispatch');
  c.claim(t.id, ticket.id, ticket.id, ticket.target.provider, ticket.target.model);
  return c.submit(t.id, ticket.id, ticket.id, { ...report,
    inspections: c.brief(t.id).packet.artifacts.map(a => ({ ...a, observation: 'Read raw output' })),
    ...changes });
}

async function repairedFinding() {
  const f = fixture();
  const c = f.controller;
  let t = finishWith(c, c.create(f.root, f.spec));
  t = c.seal(t.id, t.policy); t = finishWith(c, t); t = await c.verify(t.id);
  t = finishWith(c, t, { verdict: 'fail', findings: [{ id: 'guard', severity: 'blocking', evidence: 'source.txt', detail: 'A required guard appears missing' }] });
  return { ...f, t };
}

test('an old blocking objection cannot disappear behind later empty passing reviews', async () => {
  const { controller: c, t: repaired } = await repairedFinding();
  let t = finishWith(c, repaired); t = await c.verify(t.id);
  t = finishWith(c, t); t = finishWith(c, t); await c.verify(t.id, true);
  expect(() => finishWith(c, t)).toThrow('Unresolved obligations');
  expect(c.read(t.id).phase).toBe('auditing');
});

function refutation(c: Controller, t: Task) {
  c.next(t.id);
  const obligation = c.brief(t.id).packet.reconciliation?.obligations[0];
  if (!obligation) throw new Error('Missing retained objection');
  return { obligation: obligation.id, outcome: 'refuted', explanation: 'The original text already provides the required fixture protection',
    hypothesis: 'The original guard was removed', experiment: 'Read source.txt and compare the sealed original',
    disconfirmingEvidence: 'The original protection is still present', evidence: ['source.txt'], regressionEvidence: ['source.txt'] };
}

test('a false finding can be independently refuted after restart without unnecessary edits', async () => {
  const { controller: c, state, t: repaired } = await repairedFinding();
  const proposal = refutation(c, repaired);
  let t = finishWith(c, repaired, { resolutionProposals: [proposal] });
  t = await c.verify(t.id);
  c.next(t.id); expect(c.brief(t.id).packet.reconciliation).toBeNull();
  t = finishWith(c, t); t = finishWith(c, t); await c.verify(t.id, true);
  const resumed = new Controller(state);
  try {
    resumed.next(t.id);
    const reconciliation = resumed.brief(t.id).packet.reconciliation;
    const p = reconciliation?.proposals[0];
    if (!p) throw new Error('Proposal lost during handoff');
    expect(() => finishWith(resumed, t)).toThrow('Unresolved obligations');
    const review = { obligation: p.obligation, proposal: p.digest, decision: 'accept', explanation: 'Independently checked guard and baseline', evidence: ['source.txt'] };
    expect(() => finishWith(resumed, t, { resolutionReviews: [{ ...review, proposal: '0'.repeat(64) }] })).toThrow('current proposal');
    expect(() => finishWith(resumed, t, { resolutionReviews: [{ ...review, decision: 'reject' }] })).toThrow('Unresolved obligations');
    expect(() => finishWith(resumed, t, { resolutionReviews: [{ ...review, evidence: ['missing.txt'] }] })).toThrow();
    t = finishWith(resumed, t, { resolutionReviews: [review] });
    expect(t.phase).toBe('publishable');
    expect(t.assessments.flatMap(a => a.result.findings)).toHaveLength(1);
  } finally { resumed.close(); }
});

test('a passing run cannot erase an earlier failed execution without independent diagnosis', async () => {
  const { controller: c, root, spec } = fixture();
  spec.checks[0] = { id: 'original', argv: ['bun', '-e', "process.exit((await Bun.file('source.txt').text()) === 'repaired' ? 0 : 1)"], cwd: '.', timeoutMs: 5000 };
  let t = finishWith(c, c.create(root, spec)); t = c.seal(t.id, t.policy); t = finishWith(c, t); t = await c.verify(t.id);
  expect(t.phase).toBe('implementing');
  c.next(t.id); expect(c.brief(t.id).packet.reconciliation?.obligations[0]?.id).toStartWith('check:');
  writeFileSync(join(root, 'source.txt'), 'repaired');
  t = finishWith(c, t); t = await c.verify(t.id); t = finishWith(c, t); t = finishWith(c, t); await c.verify(t.id, true);
  expect(() => finishWith(c, t)).toThrow('Unresolved obligations');
  expect(c.read(t.id).history.some(r => r.outcome === 'fail')).toBe(true);
});

test('source changes and repair rounds invalidate an earlier proposed disposition', async () => {
  const { controller: c, root, t: repaired } = await repairedFinding();
  let t = finishWith(c, repaired, { resolutionProposals: [refutation(c, repaired)] });
  t = await c.verify(t.id);
  t = finishWith(c, t, { verdict: 'fail', summary: 'Another independent defect requires repair' });
  c.next(t.id);
  expect(c.brief(t.id).packet.reconciliation?.proposals).toEqual([]);
  writeFileSync(join(root, 'source.txt'), 'new candidate');
  t = finishWith(c, t); t = await c.verify(t.id); t = finishWith(c, t); t = finishWith(c, t); await c.verify(t.id, true);
  expect(() => finishWith(c, t)).toThrow('Unresolved obligations');
});

test('resolution claims cannot introduce unknown obligations, duplicate findings or unregistered evidence', async () => {
  const { controller: c, t } = await repairedFinding();
  const proposal = refutation(c, t);
  expect(() => finishWith(c, t, { resolutionProposals: [{ ...proposal, obligation: 'invented' }] })).toThrow('Unknown obligation');
  expect(() => finishWith(c, t, { resolutionProposals: [proposal, proposal] })).toThrow('Duplicate obligation');
  expect(() => finishWith(c, t, { resolutionProposals: [{ ...proposal, regressionEvidence: ['artifact:invented.json'] }] })).toThrow('Unregistered evidence');
  const finding = { id: 'same', severity: 'follow-up', evidence: 'source.txt', detail: 'Two different concerns need distinct IDs' };
  expect(() => finishWith(c, t, { findings: [finding, finding] })).toThrow('Duplicate finding IDs');
  expect(c.read(t.id).phase).toBe('implementing');
});

test('final reconciliation requires every historical failure artifact unchanged and inspected', async () => {
  const { controller: c, root, state, spec } = fixture();
  spec.checks[0] = { id: 'original', argv: ['bun', '-e', "console.error('diagnostic'); process.exit((await Bun.file('source.txt').text()) === 'repaired' ? 0 : 1)"], cwd: '.', timeoutMs: 5000 };
  let t = finishWith(c, c.create(root, spec)); t = c.seal(t.id, t.policy); t = finishWith(c, t); t = await c.verify(t.id);
  const proposal = { ...refutation(c, t), outcome: 'fixed', explanation: 'The candidate repairs the observed failure' };
  writeFileSync(join(root, 'source.txt'), 'repaired');
  t = finishWith(c, t, { resolutionProposals: [proposal] }); t = await c.verify(t.id); t = finishWith(c, t); t = finishWith(c, t); await c.verify(t.id, true);
  c.next(t.id);
  const packet = c.brief(t.id).packet;
  const p = packet.reconciliation?.proposals[0];
  const stderr = t.history[0]?.artifacts[1];
  if (!p || !stderr) throw new Error('Missing evidence');
  const resolutionReviews = [{ obligation: p.obligation, proposal: p.digest, decision: 'accept', explanation: 'Checked the diagnosis against all raw evidence', evidence: ['source.txt'] }];
  const inspections = packet.artifacts.map(a => ({ path: a.path, sha256: a.sha256, observation: 'Read raw historical and current evidence' }));
  expect(() => finishWith(c, t, { resolutionReviews, inspections: inspections.filter(i => i.path !== stderr.path) })).toThrow('Missing artifact inspection');
  const original = readFileSync(join(state, t.id, stderr.path));
  writeFileSync(join(state, t.id, stderr.path), 'removed failure');
  const ticket = c.read(t.id).ticket;
  if (!ticket?.claim) throw new Error('Missing audit claim');
  const worker = ticket.claim.worker;
  expect(() => c.submit(t.id, ticket.id, worker, { ...report, resolutionReviews, inspections })).toThrow('Evidence changed');
  writeFileSync(join(state, t.id, stderr.path), original);
  expect(finishWith(c, t, { resolutionReviews, inspections }).phase).toBe('publishable');
});
