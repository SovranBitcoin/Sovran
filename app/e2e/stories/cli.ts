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
import { keepEvidence, recordSimulator, stepPictures } from './evidence';
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
const started = performance.now();
try {
  simulator.installFresh(appPath);
  const installed = performance.now();
  const recording = await recordSimulator(udid, rawVideo);
  simulator.launch({ url: link.url, run: story.id });
  await link.connected(20_000);
  const result = await playStory(story, link, simulator, recording);
  const done = performance.now();
  // Let the last change be drawn and recorded before the recording ends.
  await link.still(3000).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, LAST_FRAME_MS));
  await recording.stop();
  const evidence = await keepEvidence(
    rawVideo,
    outDir,
    stepPictures(recording.startedAtWallMs, result.steps)
  );
  rmSync(rawVideo, { force: true });
  const kept = performance.now();
  writeFileSync(
    join(outDir, 'report.json'),
    `${JSON.stringify({ id: story.id, purpose: story.purpose, ok: result.ok, video: 'story.mp4', steps: result.steps.map((step, index) => ({ ...step, picture: evidence.pictures[index]?.split('/').at(-1) })) }, null, 2)}\n`
  );

  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${story.id}: ${story.purpose}`);
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
    `install ${Math.round(installed - started)} ms, launch and story ${Math.round(done - installed)} ms, steps ${result.steps.reduce((sum, step) => sum + step.wallMs, 0)} ms, video and pictures ${Math.round(kept - done)} ms`
  );
  console.log(`evidence: ${outDir}`);
  process.exitCode = result.ok ? 0 : 1;
} finally {
  simulator.terminate();
  link.close();
}
// The link's server and the simulator's input addon keep the process alive.
process.exit();
