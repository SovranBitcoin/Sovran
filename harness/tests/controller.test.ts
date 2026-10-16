import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    contextFiles: ['source.txt'], allowedDependencies: [],
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
  return c.submit(t.id, ticket.id, ticket.id, report);
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
