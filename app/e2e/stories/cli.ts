/* eslint-disable no-console -- CLI boundary */
/**
 * Play one story on a simulator:
 *   bun e2e/stories/cli.ts <story.json> --udid <simulator> --app <Sovran.app> [--out <dir>]
 *
 * Leaves the story's video, a picture per step and a report in `--out`, by
 * default e2e/artifacts/stories/<story id>/.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAppLink } from '../link/appLink';
import { createScreenWatch, keepVideo, pictureName, recordSimulator } from './evidence';
import { playStory } from './play';
import { storySimulator } from './simulator';
import { storySchema } from './story';

const [storyPath, ...flags] = process.argv.slice(2);
const flag = (name: string) => {
  const at = flags.indexOf(`--${name}`);
  return at === -1 ? undefined : flags[at + 1];
};
const udid = flag('udid');
const appPath = flag('app');
if (!storyPath || !udid || !appPath) {
  console.error('Usage: bun e2e/stories/cli.ts <story.json> --udid <simulator> --app <Sovran.app>');
  process.exit(2);
}

/** What the recorder is given to capture the final screen. This paces no step. */
const LAST_FRAME_MS = 300;

const story = storySchema.parse(JSON.parse(readFileSync(storyPath, 'utf8')));
const simulator = storySimulator(udid);
const link = startAppLink();
const outDir =
  flag('out') ?? join(dirname(fileURLToPath(import.meta.url)), '../artifacts/stories', story.id);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const rawVideo = join(outDir, 'raw.mp4');
/** Where the story's time went, in milliseconds, by what the runner was doing. */
const spent: Record<string, number> = { runnerStart: Math.round(performance.now()) };
let lap = performance.now();
const spentOn = (what: string) => {
  const now = performance.now();
  spent[what] = Math.round(now - lap);
  lap = now;
};
let recording: Awaited<ReturnType<typeof recordSimulator>> | undefined;
let frames: ReturnType<typeof simulator.watchScreen> | undefined;
try {
  simulator.startFresh(appPath);
  spentOn('freshStart');
  recording = await recordSimulator(udid, rawVideo);
  const screen = createScreenWatch({
    now: () => performance.now(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const watching = simulator.watchScreen(screen.changed);
  frames = watching;
  spentOn('recordingStart');
  simulator.launch({ url: link.url, run: story.id });
  spentOn('launch');
  await link.connected(20_000);
  spentOn('appConnected');
  const pictures: (string | undefined)[] = [];
  const result = await playStory(story, link, simulator, screen, async (index, step) => {
    const file = `${pictureName(index, step.name)}.jpg`;
    if (await watching.picture(join(outDir, file))) pictures[index] = file;
  });
  spentOn('steps');
  // Let the last change be drawn and recorded before the recording ends.
  await link.still(3000).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, LAST_FRAME_MS));
  watching.stop();
  await recording.stop();
  spentOn('recordingEnd');
  await keepVideo(rawVideo, outDir);
  rmSync(rawVideo, { force: true });
  spentOn('video');
  // A story whose screen could not be watched proved nothing about what was on it.
  const unwatched = watching.failure();
  const ok = result.ok && !unwatched;
  writeFileSync(
    join(outDir, 'report.json'),
    `${JSON.stringify({ id: story.id, purpose: story.purpose, ok, ...(unwatched ? { failure: unwatched } : {}), video: 'story.mp4', spentMs: spent, screenWatcherRestarts: watching.restarts(), steps: result.steps.map((step, index) => ({ ...step, picture: pictures[index] })) }, null, 2)}\n`
  );

  console.log(`${ok ? 'PASS' : 'FAIL'}  ${story.id}: ${story.purpose}`);
  if (unwatched) console.log(`  ${unwatched}`);
  for (const [index, step] of result.steps.entries()) {
    const shown = step.entries
      .filter((entry) => /^(screen\.mount|nav\.transition\.end)$/.test(entry.event))
      .map(
        (entry) =>
          `${entry.params?.screen}${entry.event === 'screen.mount' ? ' mounted' : ` slid ${entry.params?.duration_ms} ms`}`
      );
    const moved = step.screenKeptMoving
      ? ', screen never stopped moving'
      : step.screenMovedMs
        ? `, screen moved for ${step.screenMovedMs} ms after`
        : '';
    console.log(
      `  ${step.ok ? 'ok  ' : 'FAIL'} ${index + 1}. ${step.name}  ${step.wallMs} ms${moved}${shown.length ? `  (${shown.join(', ')})` : ''}`
    );
    if (step.failure) console.log(`       ${step.failure}`);
  }
  console.log(
    Object.entries(spent)
      .map(([what, ms]) => `${what} ${ms} ms`)
      .join(', ')
  );
  console.log(`evidence: ${outDir}`);
  process.exitCode = ok ? 0 : 1;
} finally {
  // Reached with these still running only when the story threw part-way.
  frames?.stop();
  await recording?.stop();
  simulator.terminate();
  link.close();
}
// The link's server and the simulator's input addon keep the process alive.
process.exit();
