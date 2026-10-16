import { expect, test } from 'bun:test';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './controller.test';
import { Controller } from '../src/controller';
import type { Task } from '../src/workflow';
import { git } from '../src/workspace';
import { inspectNodeTests } from '../src/checks';

function finish(c: Controller, t: Task) {
  const ticket = c.next(t.id).ticket;
  if (!ticket) throw new Error('Missing ticket');
  c.claim(t.id, ticket.id, ticket.id, ticket.target.provider, ticket.target.model);
  return c.submit(t.id, ticket.id, ticket.id, { verdict: 'pass', summary: 'Fixture inspection', findings: [],
    observations: [{ requirement: 'behavior', evidence: 'source.txt', observation: 'Read fixture' }],
    reuse: { searched: ['source.txt'], used: ['source.txt'], added: [], removed: [] } });
}
async function execute(code: string, names = ['guard']) {
  const f = fixture();
  writeFileSync(join(f.root, 'guard.test.mjs'), code); git(f.root, ['add', '.']); git(f.root, ['commit', '-qm', 'Pin fixture tests']);
  const spec = { ...f.spec, checks: [{ kind: 'node-tests', id: 'node', files: ['guard.test.mjs'],
    requiredCases: [{ file: 'guard.test.mjs', names }], cwd: '.', timeoutMs: 1000 }] };
  let t = finish(f.controller, f.controller.create(f.root, spec));
  t = f.controller.seal(t.id, t.policy); t = finish(f.controller, t); t = await f.controller.verify(t.id);
  return { ...f, t };
}

test('required test evidence comes from actual ordinary named cases and their complete lifecycle', async () => {
  const { controller: c, state, t } = await execute("import {describe,it} from 'node:test'; import assert from 'node:assert/strict'; describe('suite',()=>it('guard',()=>assert.equal(2+2,4)));", ['suite', 'guard']);
  expect(t.phase).toBe('reviewing');
  const inspected = t.receipts[0]?.artifacts.find(a => a.path.endsWith('-node-inspection.json'));
  if (!inspected) throw new Error('Missing inspection');
  const result = JSON.parse(readFileSync(join(state, t.id, inspected.path), 'utf8'));
  expect(result.cases).toEqual([{ file: 'guard.test.mjs', names: ['suite', 'guard'], passed: true, skipped: false, todo: false }]);
  c.next(t.id); expect(c.brief(t.id).packet.artifacts).toHaveLength(4);
});

test.each([
  ['empty script', "console.log('all tests pass')"],
  ['printed forged result', "console.log(JSON.stringify({kind:'event',event:{type:'test:pass',data:{name:'guard'}}}))"],
  ['missing selected case', "import {test} from 'node:test'; test('other',()=>{})"],
  ['skipped', "import {test} from 'node:test'; test.skip('guard',()=>{})"],
  ['todo', "import {test} from 'node:test'; test.todo('guard',()=>{})"],
  ['expected failure', "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('guard',{expectFailure:true},()=>assert.equal(1,2))"],
  ['early exit', "process.exit(0)"],
  ['assertion fails', "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('guard',()=>assert.equal(1,2))"],
  ['duplicate names', "import {test} from 'node:test'; test('guard',()=>{}); test('guard',()=>{})"],
  ['unfinished case', "import {test} from 'node:test'; test('guard',()=>new Promise(()=>{}))"],
])('required tests cannot pass with %s', async (_label, code) => {
  const { t } = await execute(code);
  expect(t.phase).toBe('implementing'); expect(t.generation).toBe(1);
  expect(t.history[0]?.outcome).toBe('fail');
});

test('partial, stale and modified collector streams cannot establish required cases', async () => {
  const { root, state, t } = await execute("import {test} from 'node:test'; test('guard',()=>{})");
  const artifacts = t.receipts[0]?.artifacts;
  if (!artifacts) throw new Error('Missing evidence');
  const log = artifacts[0]; const request = artifacts.find(a => a.path.endsWith('-node-request.json'));
  if (!log || !request) throw new Error('Missing collector provenance');
  const input = JSON.parse(readFileSync(join(state, t.id, request.path), 'utf8'));
  const expected = { invocation: input.invocation, root, files: ['guard.test.mjs'], requiredCases: input.selection };
  const raw = readFileSync(join(state, t.id, log.path), 'utf8');
  expect(inspectNodeTests(raw, expected).outcome).toBe('pass');
  expect(() => inspectNodeTests(raw, { ...expected, invocation: 'another task' })).toThrow('mismatched');
  expect(() => inspectNodeTests(raw.trim().split('\n').slice(0, -1).join('\n'), expected)).toThrow('Incomplete');
  const changedCounts = raw.trim().split('\n').map(line => JSON.parse(line));
  changedCounts.find(r => r.kind === 'event' && r.event.type === 'test:summary').event.data.counts.tests += 1;
  expect(inspectNodeTests(changedCounts.map(r => JSON.stringify(r)).join('\n'), expected).outcome).toBe('fail');
  const records = raw.trim().split('\n').map(line => JSON.parse(line));
  const pass = records.find(r => r.kind === 'event' && r.event.type === 'test:pass');
  records.splice(-1, 0, pass);
  expect(inspectNodeTests(records.map(r => JSON.stringify(r)).join('\n'), expected).outcome).toBe('fail');
});


test('a test-only marker cannot silently narrow the sealed case selection', async () => {
  const { t } = await execute("import {test} from 'node:test'; test('guard',()=>{}); test.only('other',()=>{});");
  expect(t.phase).toBe('reviewing');
  expect(t.receipts[0]?.summary).toContain('Executed 2 named cases');
});

test('concurrent nested cases retain their identity despite repeated identical completion notifications', async () => {
  const { t } = await execute("import {test} from 'node:test'; test('parent',{concurrency:true},async t=>{await Promise.all([t.test('left',async t=>{await new Promise(r=>setTimeout(r,20));await t.test('leaf',()=>{})}),t.test('right',async t=>{await t.test('leaf',()=>{})})])});", ['parent','left','leaf']);
  expect(t.phase).toBe('reviewing');
  expect(t.receipts[0]?.summary).toContain('Executed 5 named cases');
});
