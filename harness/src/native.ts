import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { z } from 'zod';
import { within } from './workspace';

/** The story runner a native check executes. The candidate cannot change what judges it. */
// Everything bound.ts loads or is configured by, beyond the app under test. Story
// JSON is the sealed oracle, which reviewers judge instead.
export const NATIVE_RUNNER = ['app/e2e/', 'app/scripts/', 'scripts/', 'press/', 'app/shared/lib/e2e/',
  'app/shared/lib/cashu/e2eProofReconciliationConfig.ts', 'bunfig.toml', 'app/bunfig.toml', 'package.json',
  'app/package.json', 'bun.lock', 'app/tsconfig.json', 'tsconfig.json'];
export const nativeRunnerChanges = (changed: string[]) =>
  changed.filter(p => NATIVE_RUNNER.some(prefix => prefix.endsWith('/') ? p.startsWith(prefix) : p === prefix) &&
    !(p.startsWith('app/e2e/stories/') && p.endsWith('.json')));

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const index = z.object({ invocation: z.string(), runs: z.array(z.object({
  platform: z.enum(['ios', 'android']), story: z.string(), dir: z.string(), exit: z.number().int(),
  deviceRemoved: z.boolean().nullable(), failure: z.string().optional() })) });
const build = z.object({ kind: z.literal('bundled'), artifactSha256: sha, sourceFingerprint: sha }).passthrough();
const hello = z.object({ run: z.string(), platform: z.enum(['ios', 'android']) }).passthrough();
const expected = z.object({ run: z.string(), platform: z.enum(['ios', 'android']) });
const iosSession = z.object({ expected, sourceStorySha256: sha, build, hello, evidenceClass: z.literal('ios-bundled-functional') }).passthrough();
const androidSession = z.object({ expected, story: z.object({ sha256: sha }), build, hello, kind: z.literal('android-bundled-functional') }).passthrough();
const iosPayload = z.object({ selectedSha256: sha, mismatches: z.array(z.string()) }).passthrough();
const androidPayload = z.object({ built: sha, installed: sha });
const report = z.object({ ok: z.boolean(), failure: z.string().optional(), video: z.string().optional(),
  steps: z.array(z.object({ name: z.string(), ok: z.boolean(), picture: z.string().optional(), failure: z.string().optional() }).passthrough()) }).passthrough();
const storySteps = z.object({ steps: z.array(z.unknown()).min(1) }).passthrough();

const read = <T>(schema: z.ZodType<T>, path: string) => schema.parse(JSON.parse(readFileSync(path, 'utf8')));
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/**
 * Judge bound story runs from their raw evidence, never from the runner's verdict.
 * Each sealed story must have passed every step on each sealed platform, on a
 * bundled build of exactly this candidate source, installed unchanged, on a
 * device that was its own and was removed afterwards, with a video and a picture
 * per step. Every retained file is returned so reviewers must inspect it.
 */
export function inspectNativeStories(out: string, spec: { invocation: string; source: string; root: string; stories: string[]; platforms: ('ios' | 'android')[] }) {
  const problems: string[] = [];
  const files: string[] = [];
  out = realpathSync(out);
  const listed = read(index, join(out, 'index.json'));
  if (listed.invocation !== spec.invocation) problems.push('Runs belong to another invocation');
  for (const platform of spec.platforms) for (const story of spec.stories) {
    const label = `${platform} ${story}`;
    const runs = listed.runs.filter(r => r.platform === platform && r.story === story);
    const run = runs[0];
    if (runs.length !== 1 || !run) { problems.push(`${label}: expected exactly one run, found ${runs.length}`); continue; }
    if (run.exit !== 0 || run.failure) problems.push(`${label}: runner failed${run.failure ? `: ${run.failure}` : ''}`);
    const dir = within(out, run.dir);
    if (!existsSync(dir)) { problems.push(`${label}: no evidence`); continue; }
    for (const name of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
      const path = join(dir, name);
      if (lstatSync(path).isSymbolicLink()) problems.push(`${label}: evidence is a link: ${name}`);
      else if (lstatSync(path).isFile()) files.push(relative(out, path));
    }
    try {
      const storyText = readFileSync(within(spec.root, story));
      const session = platform === 'ios' ? read(iosSession, join(dir, 'session.json')) : read(androidSession, join(dir, 'session.json'));
      const storyHash = 'sourceStorySha256' in session ? session.sourceStorySha256 : session.story.sha256;
      if (storyHash !== digest(storyText)) problems.push(`${label}: played a different story than the sealed file`);
      if (session.hello.run !== session.expected.run || session.hello.platform !== platform || session.expected.platform !== platform)
        problems.push(`${label}: the app that answered was not this run's`);
      if (session.build.sourceFingerprint !== spec.source) problems.push(`${label}: build is not of the candidate source`);
      if (platform === 'ios') {
        for (const name of ['payload-before.json', 'payload-after.json']) {
          const payload = read(iosPayload, join(dir, name));
          if (payload.mismatches.length || payload.selectedSha256 !== session.build.artifactSha256)
            problems.push(`${label}: installed app differs from the build (${name})`);
        }
        if (run.deviceRemoved !== true) problems.push(`${label}: owned simulator was not removed`);
      } else {
        const payload = read(androidPayload, join(dir, 'payload.json'));
        // `built` hashes the stamped APK's bytes; the stamp's own hash also frames names and modes.
        if (payload.built !== payload.installed) problems.push(`${label}: installed APK differs from the build`);
        if (read(z.object({ avdRootAbsent: z.boolean().nullable() }), join(dir, 'cleanup.json')).avdRootAbsent !== true)
          problems.push(`${label}: owned emulator was not removed`);
      }
      const result = read(report, join(dir, 'report.json'));
      const sealed = storySteps.parse(JSON.parse(storyText.toString('utf8'))).steps.length;
      if (!result.ok) problems.push(`${label}: story failed${result.failure ? `: ${result.failure}` : ''}`);
      if (result.steps.length !== sealed) problems.push(`${label}: ran ${result.steps.length} of ${sealed} steps`);
      result.steps.forEach((step, i) => {
        if (!step.ok) problems.push(`${label}: step ${i + 1} failed: ${step.failure ?? step.name}`);
        if (!step.picture || basename(step.picture) !== step.picture || !existsSync(join(dir, step.picture))) problems.push(`${label}: step ${i + 1} has no picture`);
      });
      if (result.video !== 'story.mp4' || !existsSync(join(dir, 'story.mp4')) || lstatSync(join(dir, 'story.mp4')).size === 0)
        problems.push(`${label}: no video`);
      if (!existsSync(join(dir, 'app-log.json'))) problems.push(`${label}: no app log`);
    } catch (error) { problems.push(`${label}: evidence unreadable: ${String(error)}`); }
  }
  const extra = listed.runs.filter(r => !spec.platforms.includes(r.platform) || !spec.stories.includes(r.story));
  if (extra.length) problems.push(`Unsealed runs: ${extra.map(r => `${r.platform} ${r.story}`).join(', ')}`);
  return { outcome: problems.length ? 'fail' as const : 'pass' as const, problems, files: files.sort() };
}
