import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sha = (data: string) => createHash('sha256').update(data).digest('hex');

export type Platform = 'ios' | 'android';
export type Fault = 'stale-build' | 'installed-differs' | 'missing-picture' | 'no-video' | 'other-story' |
  'other-app' | 'device-kept' | 'step-failed' | 'short-run' | 'runner-failed' | 'other-invocation' | 'picture-escapes';

/** Evidence shaped like app/e2e/stories/bound.ts leaves it, optionally with one fault. */
export function writeNativeEvidence(out: string, o: { invocation: string; source: string; story: string; storyText: string;
  platforms: Platform[]; fault?: { platform: Platform; kind: Fault } }) {
  const runs = [];
  for (const platform of o.platforms) {
    const fault = o.fault?.platform === platform ? o.fault.kind : undefined;
    const dir = join(platform, 'see-it');
    const at = join(out, dir);
    mkdirSync(at, { recursive: true });
    const put = (name: string, value: unknown) => writeFileSync(join(at, name), typeof value === 'string' ? value : JSON.stringify(value));
    const artifact = sha(`${platform} build`);
    const build = { kind: 'bundled', artifactSha256: artifact, sourceFingerprint: fault === 'stale-build' ? sha('older source') : o.source };
    const expected = { run: 'run-1', platform };
    const hello = { run: fault === 'other-app' ? 'run-0' : 'run-1', platform };
    const storyHash = sha(fault === 'other-story' ? `${o.storyText} ` : o.storyText);
    if (platform === 'ios') {
      put('session.json', { expected, sourceStorySha256: storyHash, build, hello, evidenceClass: 'ios-bundled-functional' });
      put('payload-before.json', { selectedSha256: artifact, mismatches: [] });
      put('payload-after.json', { selectedSha256: artifact, mismatches: fault === 'installed-differs' ? ['Info.plist changed'] : [] });
    } else {
      put('session.json', { expected, story: { sha256: storyHash }, build, hello, kind: 'android-bundled-functional' });
      // As android.ts writes it: plain APK byte hashes, unlike the stamp's framed artifact hash.
      const apk = sha(`${platform} apk bytes`);
      put('payload.json', { built: apk, installed: fault === 'installed-differs' ? sha('other') : apk });
      put('cleanup.json', { avdRoot: '/tmp/avd', avdRootAbsent: fault !== 'device-kept' });
    }
    const steps = [{ name: 'open', ok: true, picture: '01-open.png' }, { name: 'look', ok: fault !== 'step-failed', picture: '02-look.png' }]
      .slice(0, fault === 'short-run' ? 1 : 2);
    if (fault === 'picture-escapes') { steps[1] = { ...steps[1]!, picture: '../02-look.png' }; writeFileSync(join(out, platform, '02-look.png'), 'image'); }
    for (const step of steps) if (!(fault === 'missing-picture' && step.name === 'look')) put(step.picture, 'image');
    if (fault !== 'no-video') put('story.mp4', 'video');
    put('app-log.json', []);
    put('report.json', { ok: fault !== 'step-failed', steps, ...(fault === 'no-video' ? {} : { video: 'story.mp4' }) });
    runs.push({ platform, story: o.story, dir, exit: fault === 'runner-failed' ? 1 : 0, deviceRemoved: platform === 'ios' ? fault !== 'device-kept' : null });
  }
  writeFileSync(join(out, 'index.json'), JSON.stringify({ invocation: fault(o) === 'other-invocation' ? 'someone-else' : o.invocation, runs }));
}
const fault = (o: { fault?: { kind: Fault } }) => o.fault?.kind;

