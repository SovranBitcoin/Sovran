import { expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from './controller.test';
import { Controller } from '../src/controller';
import type { Task } from '../src/workflow';
import { git, testInputEvidence } from '../src/workspace';
import { inspectNodeTests } from '../src/checks';

test('the collector refuses unsupported test semantics before executing candidate code', () => {
  const { root } = fixture();
  const effect = join(root, 'executed.txt');
  writeFileSync(join(root, 'guard.test.mjs'), "import {writeFileSync} from 'node:fs';import {test} from 'node:test';test('guard',()=>writeFileSync(" + JSON.stringify(effect) + ", 'executed'));");
  const request = join(root, 'request.json');
  writeFileSync(request, JSON.stringify({ invocation: 'unsupported-runtime', root, files: ['guard.test.mjs'] }));
  const preload = 'data:text/javascript,' + encodeURIComponent("import {test} from 'node:test';test.expectFailure = undefined;");
  const result = spawnSync('node', ['--import', preload, join(import.meta.dir, '../src/node-tests.mjs'), request], { encoding: 'utf8', timeout: 5000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Unsupported Node test runner');
  expect(result.stdout).not.toContain('"kind":"end"');
  expect(() => readFileSync(effect)).toThrow();
});

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

async function regressionRun(testCode: string, current = 2, before = 1, names = ['guard'], executableHelper = false, submodule = false) {
  const f=fixture();
  if(submodule){ // A gitlink, as in this repository's vendored BitChat; a fresh baseline worktree leaves it empty.
    const vendor=join(f.root,'vendor');mkdirSync(vendor);git(vendor,['init','-q']);writeFileSync(join(vendor,'lib.txt'),'vendored');
    git(vendor,['add','.']);git(vendor,['-c','user.email=v@example.invalid','-c','user.name=V','commit','-qm','vendor']);
  }
  writeFileSync(join(f.root,'value.mjs'),`export const value=${before};`); git(f.root,['add','.']);git(f.root,['commit','-qm','Old behavior']);
  const cases=[{file:'guard.test.mjs',names}];
  const check={kind:'node-tests',id:'behavior',files:['guard.test.mjs'],requiredCases:cases,cwd:'.',timeoutMs:1000,
    regression:{testInputs:['guard.test.mjs',...(executableHelper?['helper']:[])],cases}};
  let t=finish(f.controller,f.controller.create(f.root,{...f.spec,scope:['source.txt','value.mjs','guard.test.mjs','helper'],checks:[check],verificationPolicy:{version:1,requirements:[{kind:'node',requirement:'behavior',check:'behavior',cases,regression:true}]}}));
  t=f.controller.seal(t.id,t.policy);
  writeFileSync(join(f.root,'value.mjs'),`export const value=${current};`);
  writeFileSync(join(f.root,'guard.test.mjs'),testCode);
  if(executableHelper)writeFileSync(join(f.root,'helper'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  t=finish(f.controller,t);t=await f.controller.verify(t.id);
  return {...f,t};
}
const meaningfulGuard="import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('guard',()=>assert.equal(value,2));";

test('regression runs the exact candidate test against old code, then requires the candidate ordinarily pass',async()=>{
  const {t,root,state}=await regressionRun(meaningfulGuard);
  expect(t.phase).toBe('reviewing');
  expect(t.receipts.map(r=>[r.id,r.outcome])).toEqual([['harness:baseline:behavior','pass'],['behavior','pass']]);
  const proof=t.receipts[0]?.artifacts.find(a=>a.path.endsWith('-node-request.json'));
  if(!proof)throw new Error('Missing baseline input proof');
  const request=JSON.parse(readFileSync(join(state,t.id,proof.path),'utf8'));
  expect(request.baseline).toBe(t.base); expect(request.copiedInputs[0].path).toBe('guard.test.mjs');
  expect(readFileSync(join(root,'value.mjs'),'utf8')).toBe('export const value=2;');
  expect(git(root,['worktree','list','--porcelain'])).not.toContain('-baseline');
});

test('a baseline whose submodule is not checked out still runs the regression',async()=>{
  // Live 2026-10-16: Sovran's BitChat gitlinks made every baseline fail with 'Source fingerprint unavailable'.
  const {t,root}=await regressionRun(meaningfulGuard,2,1,['guard'],false,true);
  expect([t.phase,t.reason]).toEqual(['reviewing','']);
  expect(t.receipts.map(r=>[r.id,r.outcome])).toEqual([['harness:baseline:behavior','pass'],['behavior','pass']]);
  expect(git(root,['ls-files','-s','vendor'])).toStartWith('160000');
});

test.each([
  ['baseline already passes',meaningfulGuard,2,2],
  ['candidate still fails',meaningfulGuard,1,1],
  ['assertion is in setup',"import {test,before} from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';before(()=>assert.equal(value,2));test('guard',()=>{});",2,1],
  ['runtime error is not regression',"import {test} from 'node:test';import {value} from './value.mjs';test('guard',()=>{if(value===1)throw new Error('broken setup')});",2,1],
  ['missing import is not regression',"import {test} from 'node:test';import {missing} from './absent.mjs';test('guard',()=>{});",2,1],
  ['expected failure inversion',"import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('guard',{expectFailure:true},()=>assert.equal(value,2));",2,1],
])('negative control refuses %s',async(_label,code,current,before)=>{
  const {t}=await regressionRun(code,current,before);
  expect(t.phase).toBe('implementing');expect(t.history.some(r=>r.outcome==='fail')).toBe(true);
});


test.each(['test','describe'])('baseline failure may propagate through a %s parent but must originate at the selected leaf',async(kind)=>{
  const code=kind==='test'
    ? "import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('parent',async t=>{await t.test('guard',()=>assert.equal(value,2))});"
    : "import {describe,it} from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';describe('parent',()=>it('guard',()=>assert.equal(value,2)));";
  const {t}=await regressionRun(code,2,1,['parent','guard']);expect(t.phase).toBe('reviewing');
});

test('requirement verification cannot substitute a process command or omit the agreed regression',()=>{
  const {controller:c,root,spec}=fixture();
  const cases=[{file:'guard.test.mjs',names:['guard']}];
  const verificationPolicy={version:1,requirements:[{kind:'node',requirement:'behavior',check:'check',cases,regression:true}]};
  expect(()=>c.create(root,{...spec,verificationPolicy})).toThrow('named Node check');
  const checks=[{kind:'node-tests',id:'check',files:['guard.test.mjs'],requiredCases:cases,cwd:'.',timeoutMs:1000}];
  expect(()=>c.create(root,{...spec,checks,verificationPolicy})).toThrow('baseline comparison');
  expect(()=>c.create(root,{...spec,verificationPolicy:{version:1,requirements:[{kind:'inspection',requirement:'another',rationale:'Unrelated'}]}})).toThrow('each requirement');
});

test('an independent oracle judgment must explain and cite test source and both execution lanes',async()=>{
  const {controller:c,t}=await regressionRun(meaningfulGuard);
  const ticket=c.next(t.id).ticket;if(!ticket)throw new Error('Missing review ticket');
  c.claim(t.id,ticket.id,ticket.id,ticket.target.provider,ticket.target.model);
  const result={verdict:'pass',summary:'Inspected regression fixture',findings:[],observations:[{requirement:'behavior',evidence:'value.mjs',observation:'Candidate value is two'}],
    reuse:{searched:['value.mjs'],used:['value.mjs'],added:['guard.test.mjs'],removed:[]},
    inspections:c.brief(t.id).packet.artifacts.map(a=>({...a,observation:'Inspected fixture execution'}))};
  expect(()=>c.submit(t.id,ticket.id,ticket.id,result)).toThrow('test-oracle');
  const review={requirement:'behavior',verdict:'valid',behavior:'Value must equal two',testInputs:'Only the candidate test is copied; the old value remains one',
    negativeControl:'The same assertion reports one unequal to two on the baseline and passes on the candidate',producer:'Collector and fixture use ordinary Node assertions without protocol manipulation',evidence:['guard.test.mjs']};
  expect(()=>c.submit(t.id,ticket.id,ticket.id,{...result,oracleReviews:[review]})).toThrow('case results');
  const evidence=[...review.evidence,...t.receipts.flatMap(r=>r.artifacts.filter(a=>a.path.endsWith('-node-inspection.json')).map(a=>`artifact:${a.path}`))];
  expect(c.submit(t.id,ticket.id,ticket.id,{...result,oracleReviews:[{...review,evidence}]}).phase).toBe('adversarial');
  const adversary=c.next(t.id).ticket;if(!adversary)throw new Error('Missing adversarial ticket');
  c.claim(t.id,adversary.id,adversary.id,adversary.target.provider,adversary.target.model);
  for(const verdict of ['invalid','unproven']) expect(()=>c.submit(t.id,adversary.id,adversary.id,{...result,oracleReviews:[{...review,evidence,verdict}]})).toThrow('cannot pass');
  expect(()=>c.submit(t.id,adversary.id,adversary.id,{...result,oracleReviews:[{...review,evidence},{...review,evidence}]})).toThrow('unique sealed');
  expect(()=>c.submit(t.id,adversary.id,adversary.id,{...result,oracleReviews:[{...review,evidence,requirement:'unknown'}]})).toThrow('unique sealed');
});

test('executed inputs must be regular files actually covered by the source fingerprint',()=>{
  const {root}=fixture();
  writeFileSync(join(root,'.gitignore'),'ignored.mjs\n');
  writeFileSync(join(root,'ignored.mjs'),'ignored test');
  symlinkSync('source.txt',join(root,'link.mjs'));
  mkdirSync(join(root,'app/e2e/artifacts'),{recursive:true});
  writeFileSync(join(root,'app/e2e/artifacts/test.mjs'),'excluded even when tracked');
  git(root,['add','-f','app/e2e/artifacts/test.mjs']);
  for(const path of ['ignored.mjs','link.mjs','app/e2e/artifacts/test.mjs']) expect(()=>testInputEvidence(root,[path])).toThrow('source fingerprint');
  writeFileSync(join(root,'test.mjs'),'new test');
  expect(testInputEvidence(root,['test.mjs'])[0]?.path).toBe('test.mjs');
});

test('a baseline test cannot change its own bytes and still certify the regression',async()=>{
  const {t}=await regressionRun("import {test} from 'node:test';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';import {value} from './value.mjs';test('guard',()=>{writeFileSync(new URL(import.meta.url),'changed test');assert.equal(value,2)});");
  expect(t.phase).toBe('implementing');
  expect(t.history.some(r=>r.outcome==='fail' && r.summary.includes('changed'))).toBe(true);
});

test('copying an executable helper cannot manufacture a regression through lost permissions',async()=>{
  const {t}=await regressionRun("import {test} from 'node:test';import assert from 'node:assert/strict';import {accessSync,constants} from 'node:fs';test('guard',()=>assert.doesNotThrow(()=>accessSync(new URL('./helper',import.meta.url),constants.X_OK)));",2,2,['guard'],true);
  expect(t.phase).toBe('implementing');
  expect(t.history[0]?.summary).toContain('did not expose the baseline assertion');
});
