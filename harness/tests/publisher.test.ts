import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Publisher, type PublishPlan } from '../src/publisher';
import { captureSourceFingerprint } from '../../app/e2e/core/git';
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
