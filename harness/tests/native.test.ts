import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectNativeStories, nativeRunnerChanges } from '../src/native';
import { writeNativeEvidence, type Fault, type Platform } from './native-evidence';
import { fixture } from './controller.test';
import { Controller } from '../src/controller';
import type { Task } from '../src/workflow';
import { git } from '../src/workspace';

const STORY = 'app/e2e/stories/library/see-it.json';
const storyText = JSON.stringify({ id: 'see-it', steps: [{ name: 'open' }, { name: 'look' }] });
const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0)) clean(); });

function judge(platforms: Platform[], injected?: { platform: Platform; kind: Fault }) {
  const root = mkdtempSync(join(tmpdir(), 'native-root-'));
  const out = mkdtempSync(join(tmpdir(), 'native-out-'));
  cleanups.push(() => { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); });
  mkdirSync(join(root, 'app/e2e/stories/library'), { recursive: true });
  writeFileSync(join(root, STORY), storyText);
  const source = sha('candidate');
  writeNativeEvidence(out, { invocation: 'inv', source, story: STORY, storyText, platforms, fault: injected });
  return inspectNativeStories(out, { invocation: 'inv', source, root, stories: [STORY], platforms });
}

test('bound runs of the candidate on both platforms pass and hand every file to review', () => {
  const result = judge(['ios', 'android']);
  expect(result.problems).toEqual([]);
  expect(result.outcome).toBe('pass');
  expect(result.files).toContain('android/see-it/story.mp4');
  expect(result.files).toContain('ios/see-it/02-look.png');
  expect(result.files).toContain('ios/see-it/app-log.json');
});

for (const [kind, message] of [
  ['stale-build', 'build is not of the candidate source'],
  ['installed-differs', 'differs from the build'],
  ['missing-picture', 'step 2 has no picture'],
  ['no-video', 'no video'],
  ['other-story', 'played a different story'],
  ['other-app', 'was not this run'],
  ['device-kept', 'was not removed'],
  ['step-failed', 'step 2 failed'],
  ['short-run', 'ran 1 of 2 steps'],
  ['runner-failed', 'runner failed'],
  ['other-invocation', 'another invocation'],
] as const) for (const platform of ['ios', 'android'] as const) {
  test(`a ${platform} run is rejected for ${kind}`, () => {
    const result = judge(['ios', 'android'], { platform, kind });
    expect(result.outcome).toBe('fail');
    expect(result.problems.join('\n')).toContain(message);
  });
}

test('a sealed platform with no run fails, and so does a run nobody sealed', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-root-'));
  const out = mkdtempSync(join(tmpdir(), 'native-out-'));
  cleanups.push(() => { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); });
  mkdirSync(join(root, 'app/e2e/stories/library'), { recursive: true });
  writeFileSync(join(root, STORY), storyText);
  writeNativeEvidence(out, { invocation: 'inv', source: sha('candidate'), story: STORY, storyText, platforms: ['android'] });
  const missing = inspectNativeStories(out, { invocation: 'inv', source: sha('candidate'), root, stories: [STORY], platforms: ['ios', 'android'] });
  expect(missing.problems.join('\n')).toContain('ios app/e2e/stories/library/see-it.json: expected exactly one run, found 0');
  const extra = inspectNativeStories(out, { invocation: 'inv', source: sha('candidate'), root, stories: [STORY], platforms: [] });
  expect(extra.problems.join('\n')).toContain('Unsealed runs');
});

test('runner code is guarded but stories, the oracle reviewers judge, may change', () => {
  expect(nativeRunnerChanges(['app/e2e/stories/bound.ts', 'app/e2e/press/native-build.ts', 'app/package.json', STORY, 'app/features/x.tsx']))
    .toEqual(['app/e2e/stories/bound.ts', 'app/e2e/press/native-build.ts', 'app/package.json']);
});

const FAKE_RUNNER = `
import { readFileSync } from 'node:fs';
import { fingerprint } from ${JSON.stringify(join(import.meta.dir, '../src/workspace'))};
import { writeNativeEvidence } from ${JSON.stringify(join(import.meta.dir, 'native-evidence'))};
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const story = request.stories[0];
const fault = process.env.NATIVE_FAULT ? { platform: 'android', kind: process.env.NATIVE_FAULT } : undefined;
writeNativeEvidence(request.out, { invocation: request.invocation, source: fingerprint(process.cwd()), story,
  storyText: readFileSync(story, 'utf8'), platforms: request.platforms, fault });
`;

/** A UI task whose repository carries a stand-in for app/e2e/stories/bound.ts. */
function uiTask(platforms: Platform[] | null, change?: (root: string) => void) {
  const { controller: c, root, spec } = fixture();
  mkdirSync(join(root, 'app/e2e/stories/library'), { recursive: true });
  writeFileSync(join(root, STORY), storyText);
  writeFileSync(join(root, 'app/e2e/stories/bound.ts'), FAKE_RUNNER);
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'runner']);
  const native = platforms ? [{ id: 'stories', kind: 'native-stories' as const, cwd: '.' as const, timeoutMs: 60_000, stories: [STORY], platforms }] : [];
  const t = c.create(root, { ...spec, scope: [...spec.scope, ...(change ? ['app/'] : [])], risks: ['ui'], checks: [...spec.checks, ...native] });
  let ready = finishTicket(c, t); ready = c.seal(ready.id, ready.policy);
  change?.(root);
  return { c, root, t: finishTicket(c, ready) };
}
function finishTicket(c: Controller, t: Task) {
  const ticket = c.next(t.id).ticket;
  if (!ticket) throw new Error('Expected dispatch');
  c.claim(t.id, ticket.id, ticket.id, ticket.target.provider, ticket.target.model);
  return c.submit(t.id, ticket.id, ticket.id, { verdict: 'pass', summary: 'Inspected source',
    observations: [{ requirement: 'behavior', evidence: 'source.txt', observation: 'original retained' }], findings: [],
    reuse: { searched: ['source.txt'], used: ['source.txt'], added: [], removed: [] },
    inspections: c.read(t.id).receipts.flatMap(r => r.artifacts).map(a => ({ ...a, observation: 'Looked at it' })) });
}

test('UI work without bound runs on both platforms stops incomplete', async () => {
  for (const platforms of [null, ['ios']] as const) {
    const { c, t } = uiTask(platforms ? [...platforms] : null);
    const after = await c.verify(t.id);
    expect(after.phase).toBe('incomplete');
    expect(after.reason).toContain('native-stories check that plays on both iOS and Android');
  }
});

test('UI work with passing bound runs proceeds to review, which must inspect every frame', async () => {
  const { c, t } = uiTask(['ios', 'android']);
  const after = await c.verify(t.id);
  expect(after.phase).toBe('reviewing');
  const receipt = after.receipts.find(r => r.id === 'stories');
  expect(receipt?.outcome).toBe('pass');
  const video = receipt?.artifacts.find(a => a.path.endsWith('android/see-it/story.mp4'));
  expect(video).toBeDefined();
  const ticket = c.next(t.id).ticket;
  if (!ticket) throw new Error('Expected review');
  c.claim(t.id, ticket.id, ticket.id, ticket.target.provider, ticket.target.model);
  expect(() => c.submit(t.id, ticket.id, ticket.id, { verdict: 'pass', summary: 'Skimmed',
    observations: [{ requirement: 'behavior', evidence: 'source.txt', observation: 'ok' }], findings: [],
    reuse: { searched: ['source.txt'], used: [], added: [], removed: [] },
    inspections: after.receipts.flatMap(r => r.artifacts).filter(a => a !== video).map(a => ({ ...a, observation: 'Looked' })) }))
    .toThrow('Missing artifact inspection');
});

test('a bound run with an installed app that differs from its build sends the task back to repair', async () => {
  const previous = process.env.NATIVE_FAULT;
  process.env.NATIVE_FAULT = 'installed-differs';
  try {
    const { c, t } = uiTask(['ios', 'android']);
    const after = await c.verify(t.id);
    expect(after.phase).toBe('implementing');
    expect([...after.history, ...after.receipts].find(r => r.id === 'stories')?.summary).toContain('installed APK differs from the build');
  } finally {
    if (previous === undefined) delete process.env.NATIVE_FAULT; else process.env.NATIVE_FAULT = previous;
  }
});

test('a candidate allowed to edit app/ still cannot be graded by a runner it edited', async () => {
  const { c, t } = uiTask(['ios', 'android'], root => writeFileSync(join(root, 'app/e2e/stories/bound.ts'), `${FAKE_RUNNER}\n// tuned`));
  const after = await c.verify(t.id);
  expect(after.phase).toBe('implementing');
  expect([...after.history, ...after.receipts].find(r => r.id === 'stories')?.summary).toContain('changes the native story runner: app/e2e/stories/bound.ts');
});
