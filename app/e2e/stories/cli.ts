/* eslint-disable no-console -- CLI boundary */
/**
 * Play one story on a simulator:
 *   bun e2e/stories/cli.ts <story.json> --udid <simulator> --app <Sovran.app> [--out <dir>] [--look]
 *   bun e2e/stories/cli.ts --state <name> --udid <simulator> --app <Sovran.app>
 *
 * `--look` lists what is on screen when the story ends, for writing the next step.
 * `--state` only builds and saves a state on the simulator, if it is not there already.
 *
 * Leaves the story's video, a picture per step and a report in `--out`, by
 * default e2e/artifacts/stories/<story id>/.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAppLink } from '../link/appLink';
import { createScreenWatch, keepVideo, pictureName, recordSimulator } from './evidence';
import { withGiven } from './given';
import { playStory, topPage } from './play';
import { storySimulator } from './simulator';
import { madeFrom, reachState } from './states';
import { storySchema, type Story } from './story';

const args = process.argv.slice(2);
const flags = args[0]?.startsWith('--') ? args : args.slice(1);
const storyPath = args[0]?.startsWith('--') ? undefined : args[0];
const flag = (name: string) => {
  const at = flags.indexOf(`--${name}`);
  return at === -1 ? undefined : flags[at + 1];
};
const udid = flag('udid');
const appPath = flag('app');
const onlyState = flag('state');
if ((!storyPath && !onlyState) || !udid || !appPath) {
  console.error(
    'Usage: bun e2e/stories/cli.ts <story.json> --udid <simulator> --app <Sovran.app> [--out <dir>] [--look]\n' +
      '       bun e2e/stories/cli.ts --state <name> --udid <simulator> --app <Sovran.app>'
  );
  process.exit(2);
}

/** What the recorder is given to capture the final screen. This paces no step. */
const LAST_FRAME_MS = 300;
const STORIES_OUT = join(dirname(fileURLToPath(import.meta.url)), '../artifacts/stories');

const simulator = storySimulator(udid);
/** Where the run's time went, in milliseconds, by what the runner was doing. */
const spent: Record<string, number> = { runnerStart: Math.round(performance.now()) };
let lap = performance.now();
const spentOn = (what: string) => {
  const now = performance.now();
  spent[what] = (spent[what] ?? 0) + Math.round(now - lap);
  lap = now;
};

/**
 * Play a story from the state the app is in now, leaving its video, a picture
 * of every step and a report in `outDir`. Returns whether it passed.
 */
const play = async (story: Story, outDir: string, look: boolean): Promise<boolean> => {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const rawVideo = join(outDir, 'raw.mp4');
  const link = startAppLink();
  let recording: Awaited<ReturnType<typeof recordSimulator>> | undefined;
  let frames: ReturnType<typeof simulator.watchScreen> | undefined;
  try {
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
    const lookedAt = look ? await link.screen().catch(() => undefined) : undefined;
    const systemSees = look ? await simulator.systemControls().catch(() => []) : [];
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
      `${JSON.stringify({ id: story.id, purpose: story.purpose, startsFrom: story.startsFrom, ok, ...(unwatched ? { failure: unwatched } : {}), video: 'story.mp4', spentMs: spent, screenWatcherRestarts: watching.restarts(), steps: result.steps.map((step, index) => ({ ...step, picture: pictures[index] })) }, null, 2)}\n`
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
      const busy = step.appUnresponsiveMs
        ? `, app unresponsive for ${step.appUnresponsiveMs} ms`
        : '';
      const again = step.touchMadeAgain ? ', first touch not taken' : '';
      const moved = step.screenKeptMoving
        ? ', screen never stopped moving'
        : step.screenMovedMs
          ? `, screen moved for ${step.screenMovedMs} ms after`
          : '';
      console.log(
        `  ${step.ok ? 'ok  ' : 'FAIL'} ${index + 1}. ${step.name}  ${step.wallMs} ms${moved}${busy}${again}${shown.length ? `  (${shown.join(', ')})` : ''}`
      );
      if (step.failure) console.log(`       ${step.failure}`);
    }
    if (lookedAt) {
      console.log(`on screen (${topPage(lookedAt) ?? 'no page'}):`);
      for (const element of lookedAt.elements) {
        if (!element.id && !element.label) continue;
        console.log(
          `  ${element.page ?? ''}  ${element.id ?? '-'}  ${JSON.stringify((element.label ?? element.text ?? '').slice(0, 70))}${element.disabled ? '  disabled' : ''}  at ${Math.round(element.x)},${Math.round(element.y)} ${Math.round(element.width)}×${Math.round(element.height)}`
        );
      }
    }
    if (lookedAt) {
      // What only iOS knows about: its own menus, alerts, tab bar and keyboard.
      const known = new Set(lookedAt.elements.flatMap((element) => [element.label, element.text]));
      const extra = [...new Set(systemSees.map((control) => control.label))].filter(
        (label) => !known.has(label)
      );
      if (extra.length)
        console.log(
          `drawn by iOS: ${extra.map((label) => JSON.stringify(label.slice(0, 40))).join(', ')}`
        );
    }
    console.log(`evidence: ${outDir}`);
    return ok;
  } finally {
    // Reached with these still running only when the story threw part-way.
    frames?.stop();
    await recording?.stop();
    simulator.terminate();
    link.close();
  }
};

const storyText = storyPath ? readFileSync(storyPath, 'utf8') : undefined;
const story = storyText ? storySchema.parse(JSON.parse(storyText)) : undefined;
const stateEvidence = (id: string) => join(STORIES_OUT, `state-${id}-${udid.slice(0, 8)}`);
let ok = false;
try {
  const actions = {
    hasState: simulator.hasState,
    startFrom: (state: string) => simulator.startFrom(appPath, state),
    // A state this simulator lacks is built by playing its story, with evidence of its own.
    play: async (builder: Story) =>
      play(await withGiven(builder), stateEvidence(builder.id), false),
    saveState: (name: string, from: string) => simulator.saveState(name, from),
  };
  if (!story || !storyText) {
    await reachState(onlyState ?? '', actions);
    ok = true;
  } else {
    const outDir = flag('out') ?? join(STORIES_OUT, story.id);
    const endsIn = madeFrom(story, storyText);
    if (simulator.hasState(story.id, endsIn) && existsSync(stateEvidence(story.id))) {
      // Already played on this simulator, as the start of another story. Playing
      // it again would take the wallet back in time, and a mint refuses secrets
      // it has seen; what it left then is this story's result.
      rmSync(outDir, { recursive: true, force: true });
      cpSync(stateEvidence(story.id), outDir, { recursive: true });
      ok = (JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')) as { ok: boolean }).ok;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${story.id}: played earlier on this simulator as the start of another story`
      );
    } else {
      await reachState(story.startsFrom, actions);
      for (const service of story.allow ?? []) simulator.allow(service);
      spentOn('startState');
      ok = await play(await withGiven(story), outDir, flags.includes('--look'));
      // Where it ended is kept, so a story that starts from here does not play this one again.
      if (ok) await simulator.saveState(story.id, endsIn);
      spentOn('saveState');
    }
  }
  console.log(
    Object.entries(spent)
      .map(([what, ms]) => `${what} ${ms} ms`)
      .join(', ')
  );
} catch (error) {
  console.log(
    `FAIL  ${story?.id ?? onlyState}: ${error instanceof Error ? error.message : String(error)}`
  );
}
// The link's server and the simulator's input addon keep the process alive.
process.exit(ok ? 0 : 1);
