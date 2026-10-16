/* eslint-disable no-console -- CLI boundary */
/**
 * Play one story on a simulator:
 *   bun e2e/stories/cli.ts <story.json> --udid <simulator> --app <Sovran.app> [--look]
 *   bun e2e/stories/cli.ts --state <name> --udid <simulator> --app <Sovran.app>
 *
 * `--look` lists what is on screen when the story ends, for writing the next step.
 * `--state` only builds and saves a state on the simulator, if it is not there already.
 *
 * Leaves each invocation in its own e2e/artifacts/run-<id>/ folder, browsable
 * with bun run e2e:viewer. --run-dir and --attempt are worker coordinator flags.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  attemptDirectory,
  createStoryRun,
  finishStoryRun,
  registerAttempt,
  reusableEvidence,
  storyReportSchema,
  finishAttempt,
} from '../results/runs';
import { fileURLToPath } from 'node:url';
import { startAppLink } from '../link/appLink';
import { createScreenWatch, keepVideo, pictureName, recordSimulator } from './evidence';
import { withGiven } from './given';
import { playStory, topPage } from './play';
import {
  ensureCertificates,
  holdsPrivateMints,
  privateMintAddresses,
  startPrivateMints,
} from './privateMint';
import { tokenFromMint } from './secondWallet';
import { makePerson } from './person';
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
    'Usage: bun e2e/stories/cli.ts <story.json> --udid <simulator> --app <Sovran.app> [--look]\n' +
      '       bun e2e/stories/cli.ts --state <name> --udid <simulator> --app <Sovran.app>'
  );
  process.exit(2);
}

/** What the recorder is given to capture the final screen. This paces no step. */
const LAST_FRAME_MS = 300;

// Made before the simulator is told to trust them.
ensureCertificates();
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
const play = async (
  story: Story,
  outDir: string,
  look: boolean,
  person: ReturnType<typeof makePerson>
): Promise<boolean> => {
  if (existsSync(join(outDir, 'report.json')))
    throw new Error(`Evidence already exists: ${outDir}`);
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
    const result = await playStory(
      story,
      link,
      simulator,
      screen,
      async (index, step) => {
        const file = `${pictureName(index, step.name)}.jpg`;
        if (await watching.picture(join(outDir, file))) pictures[index] = file;
      },
      // Whoever hands the person ecash holds it on the simulator's first mint.
      async (what): Promise<Record<string, string>> => {
        const [mint] = privateMintAddresses(udid);
        const token = (sats: number, lockTo?: string) =>
          tokenFromMint(`http://127.0.0.1:${mint.port}`, mint.url, sats, lockTo);
        if ('token' in what) return { token: await token(what.token.sats, what.token.lockTo) };
        // Who wrote to them is read from the message that reached them; they answer it.
        const { from } = await person.received(60_000);
        await person.send(
          from,
          'reply' in what ? what.reply.text : await token(what.paidBack.sats)
        );
        return {};
      }
    );
    spentOn('steps');
    const lookedAt = look ? await link.screen().catch(() => undefined) : undefined;
    const systemSees = look ? await simulator.systemControls().catch(() => []) : [];
    // Let the last change be drawn and recorded before the recording ends.
    await link.still(3000).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, LAST_FRAME_MS));
    watching.stop();
    await recording.stop();
    const videoEndT = Date.now();
    spentOn('recordingEnd');
    await keepVideo(rawVideo, outDir);
    rmSync(rawVideo, { force: true });
    spentOn('video');
    // A story whose screen could not be watched proved nothing about what was on it.
    const unwatched = watching.failure();
    const ok = result.ok && !unwatched;
    writeFileSync(
      join(outDir, 'report.json'),
      `${JSON.stringify({ id: story.id, purpose: story.purpose, startsFrom: story.startsFrom, ok, ...(unwatched ? { failure: unwatched } : {}), video: 'story.mp4', videoEndT, spentMs: spent, screenWatcherRestarts: watching.restarts(), steps: result.steps.map((step, index) => ({ ...step, picture: pictures[index] })) }, null, 2)}\n`
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
      const moved = step.screenKeptMoving
        ? ', screen never stopped moving'
        : step.screenMovedMs
          ? `, screen moved for ${step.screenMovedMs} ms after`
          : '';
      console.log(
        `  ${step.ok ? 'ok  ' : 'FAIL'} ${index + 1}. ${step.name}  ${step.wallMs} ms${moved}${busy}${shown.length ? `  (${shown.join(', ')})` : ''}`
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

/**
 * Play a story with the simulator's own mints running (`{{mint}}`, `{{mint2}}`):
 * started from where their folder was left (put back with the wallet's state), and stopped afterwards so
 * the folder can be saved or put back again.
 */
const playWithMint = async (story: Story, outDir: string, look: boolean) => {
  // Someone else for the story to pay, with a key made for this play alone.
  const person = makePerson();
  const usesMint = /\{\{mint|"handed"/.test(JSON.stringify(story));
  // A story that neither names a mint of its own nor starts from one waits on none.
  const stopMint =
    usesMint || holdsPrivateMints(simulator.mintFolder())
      ? await startPrivateMints(udid, simulator.mintFolder())
      : () => {};
  try {
    const [mint, mint2] = privateMintAddresses(udid);
    const ready = await withGiven(story, { mint: mint.url, mint2: mint2.url, person: person.npub });
    return await play(ready, outDir, look, person);
  } finally {
    person.leave();
    stopMint();
  }
};

const storyText = storyPath ? readFileSync(storyPath, 'utf8') : undefined;
const story = storyText ? storySchema.parse(JSON.parse(storyText)) : undefined;
const suppliedRun = flag('run-dir');
const runDir =
  suppliedRun ??
  createStoryRun(
    join(dirname(fileURLToPath(import.meta.url)), '../artifacts'),
    'single-story',
    story ? [flag('attempt') ?? story.id] : []
  );
const attemptId = flag('attempt') ?? story?.id ?? onlyState ?? 'setup';
const outDir =
  suppliedRun || !story
    ? attemptDirectory(runDir, udid, attemptId)
    : registerAttempt(runDir, udid, attemptId);
const stateEvidence = (id: string) =>
  attemptDirectory(runDir, udid, `${id}--${attemptId}`, 'setup');
const previousEvidence = (id: string): string | undefined => {
  const setup = join(runDir, 'workers', udid, 'setup');
  if (!existsSync(setup)) return undefined;
  return readdirSync(setup)
    .filter((name) => name.startsWith(`${id}--`))
    .map((name) => join(setup, name))
    .find((dir) => existsSync(join(dir, 'report.json')));
};
let ok = false;
let failure: string | undefined;
try {
  const actions = {
    hasState: simulator.hasState,
    startFrom: (state: string) => simulator.startFrom(appPath, state),
    // A state this simulator lacks is built by playing its story, with evidence of its own.
    play: (builder: Story) => playWithMint(builder, stateEvidence(builder.id), false),
    saveState: (name: string, from: string) => simulator.saveState(name, from),
  };
  if (!story || !storyText) {
    await reachState(onlyState ?? '', actions);
    ok = true;
  } else {
    const endsIn = madeFrom(story, storyText);
    const earlierEvidence = reusableEvidence(
      simulator.hasState(story.id, endsIn),
      previousEvidence(story.id)
    );
    if (earlierEvidence) {
      // Already played on this simulator, as the start of another story. Playing
      // it again would take the wallet back in time, and a mint refuses secrets
      // it has seen; what it left then is this story's result.
      cpSync(earlierEvidence, outDir, { recursive: true });
      ok = storyReportSchema.parse(
        JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8'))
      ).ok;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${story.id}: played earlier on this simulator as the start of another story`
      );
    } else {
      await reachState(story.startsFrom, actions);
      for (const service of story.allow ?? []) simulator.allow(service);
      spentOn('startState');
      ok = await playWithMint(story, outDir, flags.includes('--look'));
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
  failure = error instanceof Error ? error.message : String(error);
  console.log(
    `FAIL  ${story?.id ?? onlyState}: ${error instanceof Error ? error.message : String(error)}`
  );
}
if (story) finishAttempt(outDir, attemptId, ok ? 0 : 1, failure);
if (!suppliedRun) finishStoryRun(runDir);
// The link's server and the simulator's input addon keep the process alive.
process.exit(ok ? 0 : 1);
