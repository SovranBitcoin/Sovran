import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Publisher, type PublishPlan } from '../src/publisher';
import { captureSourceFingerprint } from '../../app/e2e/core/git';
import { Controller } from '../src/controller';
import type { Contract, Task } from '../src/workflow';
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function git(root: string, args: string[]) {
  const r = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(new TextDecoder().decode(r.stderr));
  return new TextDecoder().decode(r.stdout).trim();
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'publisher-test-')); directories.push(dir);
  const root = join(dir, 'source'), remote = join(dir, 'remote.git'); mkdirSync(root);
  git(dir, ['init', '--bare', '-q', remote]); git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Fixture']); git(root, ['config', 'user.email', 'fixture@example.invalid']);
  writeFileSync(join(root, 'app.txt'), 'old'); git(root, ['add', '.']); git(root, ['commit', '-qm', 'fixture']);
  git(root, ['remote', 'add', 'origin', remote]); git(root, ['push', '-q', 'origin', 'main']);
  const baseHead = git(root, ['rev-parse', 'HEAD']); git(root, ['switch', '-qc', 'task/example']);
  writeFileSync(join(root, 'app.txt'), 'fixed'); git(root, ['commit', '-qam', 'fixture change']);
  const plan: PublishPlan = { taskId: '00000000-0000-4000-8000-000000000001', root,
    repository: 'fixture/wallet', remote: 'origin', remoteUrl: remote, branch: 'task/example', base: 'main',
    head: git(root, ['rev-parse', 'HEAD']), baseHead, previousRemoteHead: null,
    source: captureSourceFingerprint(root)!, title: 'Preserve the wallet state', body: 'Fixes the declared behavior.\n\nValidation: upgrade fixtures.', requiredChecks: ['upgrade'] };
  const path = join(dir, 'gh-state.json'), executable = join(dir, 'gh');
  writeFileSync(path, JSON.stringify({ plan, creates: 0, lost: false, pr: null, checks: [{ name: 'upgrade', bucket: 'pass' }] }));
  writeFileSync(executable, `#!/usr/bin/env bun
import {readFileSync,writeFileSync} from 'node:fs';
const file=process.env.FAKE_GH_STATE, s=JSON.parse(readFileSync(file,'utf8')), a=process.argv.slice(2), cmd=a[1];
const value=k=>a[a.indexOf(k)+1], save=()=>writeFileSync(file,JSON.stringify(s));
if(a[0]==='api'){
 if(s.apiError)process.exit(1);
 if(cmd==='graphql'){
  const checks=s.checks.map((c,i)=>c.__typename?c:{__typename:'CheckRun',id:'check-'+i,name:c.name,status:c.bucket==='pending'?'IN_PROGRESS':'COMPLETED',conclusion:({pass:'SUCCESS',fail:'FAILURE',skipping:'SKIPPED',cancel:'CANCELLED'})[c.bucket]??null,isRequired:!!c.required,detailsUrl:'https://github.com/fixture/wallet/actions',checkSuite:{databaseId:i+1,commit:{oid:c.head??s.plan.head},app:{databaseId:c.appId??1,slug:'github-actions'},workflowRun:c.workflowRun??null}});
  const offset=Number(a.find(x=>x.startsWith('cursor='))?.slice(7)??0), size=s.pageSize??checks.length;
  const nodes=checks.slice(offset,offset+size), more=offset+nodes.length<checks.length;
  console.log(JSON.stringify({data:{repository:{pullRequest:{headRefOid:s.plan.head,baseRefOid:s.plan.baseHead,statusCheckRollup:{commit:{oid:s.plan.head},contexts:{totalCount:checks.length,pageInfo:{hasNextPage:more,endCursor:more?String(offset+nodes.length):null},nodes}}}}},...(s.graphqlErrors?{errors:[{message:'Partial data'}]}:{})}));
 } else if(cmd.includes('/actions/runs/'))console.log(JSON.stringify(s.run));
 else if(cmd.includes('/rules/branches/'))console.log(JSON.stringify([s.changedPolicy && s.policyReads>1 ? [{type:'required_status_checks',parameters:{required_status_checks:[{context:'new-gate'}]}}] : s.rules??[]]));
 else if(cmd.endsWith('/protection'))console.log(JSON.stringify(s.protection));
 else if(cmd.includes('/branches/')){s.policyReads=(s.policyReads??0)+1;save();console.log(JSON.stringify({protected:!!s.protected,commit:{sha:s.plan.baseHead}}));}
 else process.exit(97);
 process.exit(0);
}
if(a[0]!=='pr')process.exit(99);
if(cmd==='list'){console.log(JSON.stringify(s.pr?[s.pr]:[]));}
else if(cmd==='view'){console.log(JSON.stringify(s.pr));}
else if(cmd==='checks'){console.log(JSON.stringify(s.checks));process.exit(s.checks.some(c=>c.bucket!=='pass')?8:0);}
else if(cmd==='create'){s.creates++;s.pr={number:17,url:'https://github.com/fixture/wallet/pull/17',state:'OPEN',headRefName:s.plan.branch,headRefOid:s.plan.head,baseRefName:s.plan.base,baseRefOid:s.plan.baseHead,headRepository:{nameWithOwner:'fixture/wallet'},isCrossRepository:false,isDraft:false,title:value('--title'),body:readFileSync(value('--body-file'),'utf8'),mergeable:'MERGEABLE',mergeStateStatus:'CLEAN',reviewDecision:'APPROVED'};save();process.exit(s.lost?1:0);}
else if(cmd==='edit'){s.pr.title=value('--title');s.pr.body=readFileSync(value('--body-file'),'utf8');save();}
else process.exit(98);
`, { mode: 0o700 });
  const publisher = new Publisher({ fingerprint: root => { const hash = captureSourceFingerprint(root); if (!hash) throw Error('Missing fingerprint'); return hash; }, gh: executable, env: { FAKE_GH_STATE: path } });
  const read = () => JSON.parse(readFileSync(path, 'utf8'));
  const change = (fn: (state: ReturnType<typeof read>) => void) => { const state = read(); fn(state); writeFileSync(path, JSON.stringify(state)); };
  return { dir, root, plan, publisher, read, change };
}
test('pushes only the tested branch and reconciles a lost create response without another PR', () => {
  const f = fixture(); f.change(s => { s.lost = true; });
  expect(f.publisher.publish(f.plan, true).status).toBe('ci');
  expect(git(f.root, ['ls-remote', 'origin', 'refs/heads/task/example'])).toBe(`${f.plan.head}\trefs/heads/task/example`);
  expect(f.publisher.reconcile(f.plan).status).toBe('ci');
  expect(f.publisher.publish(f.plan, false).status).toBe('ci'); expect(f.read().creates).toBe(1);
  expect(f.read().pr.body.endsWith(`<!-- describes ${f.plan.head} -->`)).toBe(true);
});
test('a missing PR after an ambiguous operation never permits blind recreation', () => {
  const f = fixture(); git(f.root, ['push', '-q', 'origin', `${f.plan.head}:refs/heads/task/example`]);
  expect(f.publisher.reconcile(f.plan).status).toBe('unknown'); expect(f.read().creates).toBe(0);
  expect(f.publisher.publish(f.plan, false).status).toBe('unknown'); expect(f.read().creates).toBe(0);
});
test('dirty source is rejected before pushing or creating anything', () => {
  const f = fixture(); writeFileSync(join(f.root, 'unreviewed.txt'), 'extra');
  expect(() => f.publisher.publish(f.plan, true)).toThrow('tested source');
  expect(git(f.root, ['ls-remote', 'origin', 'refs/heads/task/example'])).toBe(''); expect(f.read().creates).toBe(0);
});
test('pending, absent and stale checks cannot become ready', () => {
  const f = fixture(); f.publisher.publish(f.plan, true);
  f.change(s => { s.checks[0].bucket = 'pending'; }); expect(f.publisher.check(f.plan, 17).status).toBe('waiting');
  f.change(s => { s.checks = []; }); expect(f.publisher.check(f.plan, 17).status).toBe('waiting');
  f.change(s => { s.checks = [{ name: 'upgrade', bucket: 'pass' }]; }); expect(f.publisher.check(f.plan, 17).status).toBe('ready');
  f.change(s => { s.pr.headRefOid = 'f'.repeat(40); }); expect(() => f.publisher.check(f.plan, 17)).toThrow('revision differs');
});
test('a changed remote or advanced base invalidates publication authority', () => {
  const f = fixture(); git(f.root, ['config', 'remote.origin.pushurl', join(f.dir, 'other.git')]);
  expect(() => f.publisher.publish(f.plan, true)).toThrow('remote changed');
  git(f.root, ['config', '--unset', 'remote.origin.pushurl']); git(f.root, ['push', '-q', 'origin', `${f.plan.head}:refs/heads/main`]);
  expect(() => f.publisher.publish(f.plan, true)).toThrow('Base changed'); expect(f.read().creates).toBe(0);
});
test('unknown mergeability and a mismatched task owner cannot be accepted', () => {
  const f = fixture(); f.publisher.publish(f.plan, true);
  f.change(s => { s.pr.mergeable = 'UNKNOWN'; }); expect(f.publisher.check(f.plan, 17).status).toBe('waiting');
  f.change(s => { s.pr.body = 'another task'; }); expect(() => f.publisher.reconcile(f.plan)).toThrow('ownership');
  expect(f.read().creates).toBe(1);
});

test.each(['failed CI', 'concurrent repair'] as const)('controller handles %s and updates only its own existing PR', async (trigger) => {
  const f = fixture(); git(f.root, ['reset', '--hard', f.plan.baseHead]);
  const c = new Controller(join(f.dir, 'journal'), f.publisher);
  const spec: Contract = { problem: 'Preserve the wallet state', requirements: [{ id: 'preserve', outcome: 'app text records the change' }],
    scope: ['app.txt'], risks: [], contextFiles: ['app.txt'], references: [], allowedDependencies: [],
    checks: [{ id: 'check', argv: ['bun', '-e', 'console.log("checked")'], cwd: '.', timeoutMs: 1000 }],
    auditChecks: [{ id: 'audit', argv: ['git', 'diff', '--exit-code'], cwd: '.', timeoutMs: 1000 }],
    models: { research: { provider: 'codex', model: 'luna' }, implementation: { provider: 'codex', model: 'sol' },
      review: { provider: 'claudeAgent', model: 'opus' }, adversary: { provider: 'claudeAgent', model: 'fable' }, audit: { provider: 'claudeAgent', model: 'opus' } },
    limits: { deadline: new Date(Date.now() + 60_000).toISOString(), repairRounds: 2 }, publish: { kind: 'pull-request',
      repository: f.plan.repository, remote: f.plan.remote, remoteUrl: f.plan.remoteUrl, branch: f.plan.branch, base: f.plan.base,
      baseHead: f.plan.baseHead, previousRemoteHead: null, requiredChecks: ['upgrade'] } };
  const finish = (t: Task) => {
    const issued = c.next(t.id); const ticket = issued.ticket; if (!ticket) throw new Error('Missing ticket');
    c.claim(t.id, ticket.id, ticket.id, ticket.target.provider, ticket.target.model);
    const reconciliation = c.brief(t.id).packet.reconciliation;
    return c.submit(t.id, ticket.id, ticket.id, { verdict: 'pass', summary: 'Inspected fixture',
      ...(ticket.role === 'implementation' ? { resolutionProposals: reconciliation?.obligations.map(o => ({
        obligation: o.id, outcome: 'fixed', explanation: 'Applied the fixture CI correction',
        hypothesis: 'The earlier candidate fails its required check', experiment: 'Apply the correction and rerun the fixture check',
        disconfirmingEvidence: 'A continuing required-check failure would reject this correction',
        evidence: ['app.txt', o.evidence], regressionEvidence: ['app.txt'],
      })) } : {}),
      ...(ticket.role === 'audit' ? { resolutionReviews: reconciliation?.proposals.map(p => ({
        obligation: p.obligation, proposal: p.digest, decision: 'accept',
        explanation: 'Independent fixture review accepts correction; live CI is still required by the controller', evidence: ['app.txt'],
      })) } : {}),
      observations: [{ requirement: 'preserve', evidence: 'app.txt', observation: 'Read actual fixture' }], findings: [],
      reuse: { searched: ['app.txt'], used: ['app.txt'], added: [], removed: [] },
      inspections: c.brief(t.id).packet.artifacts.map(a => ({ ...a, observation: 'Read fixture output' })) });
  };
  const qualify = async (t: Task) => {
    t = finish(t); t = await c.verify(t.id); t = finish(t); t = finish(t);
    await c.verify(t.id, true); return finish(t);
  };
  try {
    let t = finish(c.create(f.root, spec)); t = c.seal(t.id, t.policy);
    for (const value of ['first change', 'fixed change']) {
      writeFileSync(join(f.root, 'app.txt'), value); git(f.root, ['commit', '-qam', value]);
      f.change(s => { s.plan.head = git(f.root, ['rev-parse', 'HEAD']); if (s.pr) s.pr.headRefOid = s.plan.head; });
      t = await qualify(t); t = c.publish(t.id);
      expect(t.phase).toBe('ci');
      f.change(s => { s.checks[0].bucket = 'pending'; });
      t = c.checkCI(t.id);
      expect(t.phase).toBe('ci');
      const waiting = t.ciObservations?.at(-1);
      if (!waiting) throw new Error('Missing retained waiting observation');
      expect(JSON.parse(readFileSync(join(f.dir, 'journal', t.id, waiting.path), 'utf8')).status).toBe('waiting');
      f.change(s => { s.checks[0].bucket = value === 'first change' && trigger === 'failed CI' ? 'fail' : 'pass'; });
      if (value === 'first change' && trigger === 'concurrent repair') {
        const other = new Controller(join(f.dir, 'journal'), f.publisher);
        const check = f.publisher.check.bind(f.publisher);
        f.publisher.check = (plan, number) => {
          const result = check(plan, number);
          other.repair(t.id, 'Repair began while GitHub checks were being read');
          return result;
        };
        try {
          expect(() => c.checkCI(t.id)).toThrow('Stale CI result');
          t = c.read(t.id);
          expect(t.generation).toBe(1);
        } finally { f.publisher.check = check; other.close(); }
      } else {
        t = c.checkCI(t.id);
        if (value === 'first change') expect(t.history.some(r => r.id === 'harness:ci' && r.outcome === 'fail')).toBe(true);
      }
      expect(t.phase).toBe(value === 'first change' ? 'implementing' : 'ready');
    }
    const receipt = t.receipts.find(r => r.id === 'harness:ci');
    const evidence = receipt?.artifacts[0];
    if (!evidence) throw new Error('Missing CI evidence');
    const snapshot = JSON.parse(readFileSync(join(f.dir, 'journal', t.id, evidence.path), 'utf8'));
    expect(snapshot.checks).toMatchObject([{ name: 'upgrade', status: 'COMPLETED', conclusion: 'SUCCESS' }]);
    expect(snapshot.serverPolicy.required).toEqual([]);
    expect(snapshot.requiredChecks).toEqual(['upgrade']);
    expect(snapshot.sealedRequiredChecks).toEqual(['upgrade']);
    expect(snapshot.pr.headRefOid).toBe(git(f.root, ['rev-parse', 'HEAD']));
    expect(f.read().creates).toBe(1);
    expect(f.read().pr.body.endsWith(`<!-- describes ${git(f.root, ['rev-parse', 'HEAD'])} -->`)).toBe(true);
  } finally { c.close(); }
});

test('legacy pending publication reconciles its existing effect before applying stronger readiness gates', () => {
  const f = fixture();
  const c = new Controller(join(f.dir, 'legacy-journal'), f.publisher);
  const target = { provider: 'fixture', model: 'fixture' };
  const taskId = f.plan.taskId;
  const dir = join(f.dir, 'legacy-journal', taskId); mkdirSync(dir);
  const artifact = { path: 'old-failure.log', sha256: new Bun.CryptoHasher('sha256').update('failure').digest('hex') };
  writeFileSync(join(dir, artifact.path), 'failure');
  // A persisted pre-gate journal with an authorized effect whose response was lost.
  // This fixture is migration evidence, not a successful execution assessment.
  const stored: Task = {
    version: 1, id: taskId, root: f.root, base: f.plan.baseHead, source: f.plan.source,
    policy: '0'.repeat(64), phase: 'publishing', generation: 1, ticket: null,
    context: [], referenceEvidence: null, receipts: [], assessments: [], attempts: [],
    history: [{ id: 'old-check', source: f.plan.source, artifacts: [artifact], outcome: 'fail', summary: 'Historical failure without new resolution fields' }],
    pending: { kind: 'publish', head: f.plan.head }, publication: f.plan, reason: '', pr: null,
    contract: { problem: 'Legacy publication', requirements: [{ id: 'r', outcome: 'Preserve the intended change' }],
      scope: ['app.txt'], risks: [], contextFiles: ['app.txt'], references: [], allowedDependencies: [],
      checks: [{ id: 'check', argv: ['true'], cwd: '.', timeoutMs: 1000 }],
      auditChecks: [{ id: 'audit', argv: ['true'], cwd: '.', timeoutMs: 1000 }],
      models: { research: target, implementation: target, review: { provider: 'other', model: 'other' }, adversary: target, audit: target },
      limits: { deadline: new Date(Date.now() + 60000).toISOString(), repairRounds: 2 },
      publish: { kind: 'pull-request', repository: f.plan.repository, remote: f.plan.remote, remoteUrl: f.plan.remoteUrl,
        base: f.plan.base, branch: f.plan.branch, baseHead: f.plan.baseHead, previousRemoteHead: null, requiredChecks: ['upgrade'] },
    },
  };
  try {
    c.journal.create(taskId, stored);
    f.publisher.publish(f.plan, true);
    const reconciled = c.publish(taskId);
    expect(reconciled.phase).toBe('ci'); expect(reconciled.pending.kind).toBe('none');
    expect(reconciled.pr?.number).toBe(17); expect(f.read().creates).toBe(1);
    expect(() => c.checkCI(taskId)).toThrow('Unresolved obligations');
    expect(c.repair(taskId, 'Investigate retained historical evidence under the current gate').phase).toBe('implementing');
  } finally { c.close(); }
});

test('known-empty server policy still enforces every sealed check and retains all observed evidence', () => {
  const f = fixture(); f.publisher.publish(f.plan, true);
  expect(f.publisher.check(f.plan,17).status).toBe('ready');
  f.change(s => { s.checks = [{name:'unrelated',bucket:'pass'}]; });
  expect(f.publisher.check(f.plan,17).status).toBe('waiting');
  f.change(s => { s.checks = [{name:'upgrade',bucket:'pass'}, {name:'advisory',bucket:'fail'}]; });
  const result = f.publisher.check(f.plan,17);
  expect(result.status).toBe('ready'); expect(result.checks).toHaveLength(2);
  f.change(s => { s.pr.mergeStateStatus='UNSTABLE'; });
  expect(f.publisher.check(f.plan,17).status).toBe('waiting');
});

test('server policies and observed required contexts strengthen the sealed obligations', () => {
  const f=fixture(); f.publisher.publish(f.plan,true);
  f.change(s=>{s.rules=[{type:'required_status_checks',parameters:{required_status_checks:[{context:'security',integration_id:2}]}}];});
  expect(f.publisher.check(f.plan,17).reason).toContain('security: missing');
  f.change(s=>{s.checks.push({name:'security',bucket:'pass',appId:1});});
  expect(f.publisher.check(f.plan,17).status).toBe('waiting');
  f.change(s=>{s.checks[1].appId=2;}); expect(f.publisher.check(f.plan,17).status).toBe('ready');
  f.change(s=>{s.checks.push({name:'new-required',bucket:'pending',required:true});});
  expect(f.publisher.check(f.plan,17).status).toBe('waiting');
  f.change(s=>{s.checks[2].bucket='fail';}); expect(f.publisher.check(f.plan,17).status).toBe('failed');
  f.change(s=>{s.rules=[];s.checks.splice(2);s.protected=true;s.protection={required_status_checks:{contexts:['classic'],checks:[{context:'classic',app_id:3}]}};});
  expect(f.publisher.check(f.plan,17).reason).toContain('classic: missing');
  f.change(s=>{s.protection.required_status_checks.checks[0].app_id=-1;s.checks.push({name:'classic',bucket:'pass',appId:42});});
  expect(f.publisher.check(f.plan,17).status).toBe('ready');
});

test('unavailable, partial or stale CI evidence cannot become a known-empty passing policy', () => {
  const f=fixture(); f.publisher.publish(f.plan,true);
  f.change(s=>{s.apiError=true;}); expect(()=>f.publisher.check(f.plan,17)).toThrow('unavailable');
  f.change(s=>{s.apiError=false;s.graphqlErrors=true;}); expect(()=>f.publisher.check(f.plan,17)).toThrow('Partial');
  f.change(s=>{s.graphqlErrors=false;s.checks[0].head='a'.repeat(40);}); expect(()=>f.publisher.check(f.plan,17)).toThrow('Stale check');
});

test('ambiguous publishers cannot be replaced by whichever duplicate passed', () => {
  const f=fixture(); f.publisher.publish(f.plan,true);
  f.change(s=>{s.checks.push({name:'upgrade',bucket:'fail',appId:2});});
  const result=f.publisher.check(f.plan,17);
  expect(result.status).toBe('waiting'); expect(result.reason).toContain('ambiguous'); expect(result.checks).toHaveLength(2);
});

test('only the latest identified workflow attempt can satisfy a required check and it must bind the base', () => {
  const f=fixture(); f.publisher.publish(f.plan,true);
  const workflowRun=(id:number,n:number)=>({databaseId:id,runNumber:n,runAttempt:1,event:'pull_request',file:{path:'.github/workflows/check.yml'},workflow:{databaseId:7,name:'Checks'}});
  f.change(s=>{
    s.checks=[{name:'upgrade',bucket:'pass',workflowRun:workflowRun(50,1)}, {name:'upgrade',bucket:'pending',workflowRun:workflowRun(51,2)}];
    s.run={id:51,head_sha:s.plan.head,run_attempt:1,run_number:2,event:'pull_request',workflow_id:7,pull_requests:[{number:17,head:{sha:s.plan.head},base:{sha:s.plan.baseHead}}]};
  });
  expect(f.publisher.check(f.plan,17).status).toBe('waiting');
  f.change(s=>{s.checks[1].bucket='fail';}); expect(f.publisher.check(f.plan,17).status).toBe('failed');
  f.change(s=>{s.checks[1].bucket='pass';}); const result=f.publisher.check(f.plan,17);
  expect(result.status).toBe('ready'); expect(result.checks).toHaveLength(2); expect(result.associations).toHaveLength(1);
  f.change(s=>{s.run.pull_requests[0].base.sha='a'.repeat(40);}); expect(f.publisher.check(f.plan,17).status).toBe('waiting');
  f.change(s=>{s.checks[0].workflowRun.workflow.databaseId=8;}); expect(f.publisher.check(f.plan,17).reason).toContain('ambiguous');
});

test('all context pages are read and a changing server policy invalidates the observation', () => {
  const f=fixture(); f.publisher.publish(f.plan,true);
  f.change(s=>{s.pageSize=1;s.checks=[{name:'advisory',bucket:'pass'}, {name:'upgrade',bucket:'pass'}];});
  expect(f.publisher.check(f.plan,17).status).toBe('ready');
  f.change(s=>{s.changedPolicy=true;s.policyReads=0;});
  expect(()=>f.publisher.check(f.plan,17)).toThrow('requirements changed');
});
