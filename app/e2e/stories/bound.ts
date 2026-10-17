/* eslint-disable no-console -- CLI boundary */
/**
 * Play sealed stories on fresh, owned devices for the task controller:
 *   bun app/e2e/stories/bound.ts <request.json>   (from the repository root)
 *
 * The request names an invocation, an output folder and the stories and
 * platforms the task sealed. Each platform's bundled build is made afresh here,
 * never reused: the build folder is ignored by Git, so a stamp left in it could
 * vouch for any binary. Each story is played on its own disposable simulator
 * or emulator. Every run's evidence is copied to `<out>/<platform>/<story id>/`,
 * and `<out>/index.json` lists the runs. The controller judges the evidence
 * itself; nothing here says whether a run counts.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createEphemeralSimulatorDevice } from '../drivers/simulator-session';
import { attemptDirectory, createStoryRun } from '../results/runs';
import { ensureNativeBuild } from '../press/native-build';
import { runAndroidStory } from './android';
import { storySchema } from './story';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const ROOT = resolve(APP, '..');

export const boundRequestSchema = z
  .object({
    invocation: z.string().min(1),
    out: z.string().min(1),
    stories: z.array(z.string().min(1)).min(1),
    platforms: z.array(z.enum(['ios', 'android'])).min(1),
  })
  .strict();

export const boundIndexSchema = z.object({
  invocation: z.string(),
  runs: z.array(
    z.object({
      platform: z.enum(['ios', 'android']),
      story: z.string(),
      dir: z.string(),
      exit: z.number().int(),
      /** iOS: the owned simulator was deleted. Android records its own cleanup. */
      deviceRemoved: z.boolean().nullable(),
      failure: z.string().optional(),
    })
  ),
});
type BoundRun = z.infer<typeof boundIndexSchema>['runs'][number];

async function playIos(
  storyPath: string,
  storyId: string,
  app: string,
  invocation: string,
  out: string
) {
  // Everything that can fail runs before the simulator exists, so none is left behind.
  const runDir = createStoryRun(join(APP, 'e2e/artifacts'), 'bound-ios-story', [storyId]);
  const device = await createEphemeralSimulatorDevice({ runId: invocation.slice(0, 16) });
  let exit = 1;
  let deviceRemoved = false;
  try {
    exit =
      spawnSync(
        'bun',
        [
          'e2e/stories/cli.ts',
          storyPath,
          '--udid',
          device.udid,
          '--app',
          app,
          '--bundled',
          '--run-dir',
          runDir,
          '--attempt',
          'story',
        ],
        { cwd: APP, stdio: 'inherit' }
      ).status ?? 1;
  } finally {
    await device.dispose();
    const listed = spawnSync('xcrun', ['simctl', 'list', 'devices']);
    deviceRemoved = listed.status === 0 && !listed.stdout.toString().includes(device.udid);
  }
  cpSync(attemptDirectory(runDir, device.udid, 'story'), out, { recursive: true });
  return { exit, deviceRemoved };
}

async function playAndroid(storyPath: string, storyId: string, out: string) {
  const { ok, runDir } = await runAndroidStory(storyPath, 'bundled');
  const workers = join(runDir, 'workers');
  const [worker] = existsSync(workers) ? readdirSync(workers) : [];
  if (!worker) throw new Error('The Android run left no attempt');
  cpSync(attemptDirectory(runDir, worker, storyId), out, { recursive: true });
  return { exit: ok ? 0 : 1, deviceRemoved: null };
}

export async function playBound(request: z.infer<typeof boundRequestSchema>) {
  const runs: BoundRun[] = [];
  const save = () =>
    writeFileSync(
      join(request.out, 'index.json'),
      JSON.stringify({ invocation: request.invocation, runs }, null, 2)
    );
  mkdirSync(request.out, { recursive: true, mode: 0o700 });
  save();
  for (const platform of request.platforms) {
    const build = await ensureNativeBuild(platform, 'force', 'bundled');
    for (const relative of request.stories) {
      const storyPath = join(ROOT, relative);
      const story = storySchema.parse(JSON.parse(readFileSync(storyPath, 'utf8')));
      const dir = join(platform, story.id);
      const out = join(request.out, dir);
      if (existsSync(out)) throw new Error(`Evidence already exists: ${dir}`);
      try {
        const result =
          platform === 'ios'
            ? await playIos(storyPath, story.id, build.artifact, request.invocation, out)
            : await playAndroid(storyPath, story.id, out);
        runs.push({ platform, story: relative, dir, ...result });
      } catch (error) {
        runs.push({
          platform,
          story: relative,
          dir,
          exit: 1,
          deviceRemoved: null,
          failure: error instanceof Error ? error.message : String(error),
        });
      }
      save();
    }
  }
  return runs.every((run) => run.exit === 0);
}

if (import.meta.main) {
  const request = boundRequestSchema.parse(JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')));
  const ok = await playBound(request);
  console.log(`${ok ? 'PASS' : 'FAIL'}  bound stories: ${request.out}`);
  process.exit(ok ? 0 : 1);
}
