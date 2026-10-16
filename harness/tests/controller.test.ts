import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
