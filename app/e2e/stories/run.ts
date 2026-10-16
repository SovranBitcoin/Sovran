/* eslint-disable no-console -- CLI boundary */
/**
 * Play every story in a folder across several simulators at once:
 *   bun e2e/stories/run.ts [--workers 2] [--stories <dir>] [--app <Sovran.app>] [--repeat 1] [--keep]
 *
 * Prepares one simulator, clones it per worker, and gives each worker the next
 * story as it finishes the last. Each story is its own process, so one story's
 * work never delays another's touches. Evidence goes to
 * a fresh e2e/artifacts/run-<id>/ folder. Open the shared e2e viewer for history.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanes } from './lanes';
import { runRounds } from './pool';
import { ensureCertificates } from './privateMint';
import { createStoryRun, finishStoryRun, registerAttempt, finishAttempt } from '../results/runs';
import { prepareBase, removeWorkers, startWorkers } from './workers';

const HERE = dirname(fileURLToPath(import.meta.url));
const flags = process.argv.slice(2);
const flag = (name: string) => {
  const at = flags.indexOf(`--${name}`);
  return at === -1 ? undefined : flags[at + 1];
};
const workerCount = Number(flag('workers') ?? 2);
const repeat = Number(flag('repeat') ?? 1);
const storiesDir = flag('stories') ?? join(HERE, 'library');
const appPath = flag('app') ?? join(HERE, '../artifacts/native-builds/ios-bundled/Sovran.app');
const artifacts = join(HERE, '../artifacts');

interface Play {
  id: string;
  startsFrom: string;
  file: string;
  attemptId: string;
  round: number;
}

const files = readdirSync(storiesDir)
  .filter((name) => name.endsWith('.json'))
  .toSorted();
const plays: Play[] = Array.from({ length: repeat }, (_, round) =>
  files.map((name) => ({
    ...(JSON.parse(readFileSync(join(storiesDir, name), 'utf8')) as {
      id: string;
      startsFrom: string;
    }),
    file: join(storiesDir, name),
    round,
    attemptId: repeat === 1 ? name.slice(0, -5) : `${name.slice(0, -5)}-${round + 1}`,
  }))
).flat();

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function playOne(play: Play, udid: string): Promise<{ ok: boolean; output: string }> {
  const out = registerAttempt(outRoot, udid, play.attemptId);
  return new Promise((resolve) => {
    const child = spawn(
      'bun',
      [
        join(HERE, 'cli.ts'),
        play.file,
        '--udid',
        udid,
        '--app',
        appPath,
        '--run-dir',
        outRoot,
        '--attempt',
        play.attemptId,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', (error) => {
      finishAttempt(out, play.attemptId, 1, error.message);
      resolve({ ok: false, output: error.message });
    });
    child.on('close', (code) => {
      const recorded = JSON.parse(readFileSync(join(out, 'attempt.json'), 'utf8'));
      finishAttempt(out, play.attemptId, code ?? 1, recorded.failure);
      resolve({ ok: code === 0, output });
    });
  });
}

if (!Number.isInteger(workerCount) || workerCount < 1 || !Number.isInteger(repeat) || repeat < 1) {
  console.error('--workers and --repeat take a whole number, 1 or more.');
  process.exit(2);
}
if (plays.length === 0) {
  console.error(`No stories in ${storiesDir}.`);
  process.exit(2);
}

// One run at a time: a second would delete the first's simulators as it started.
const lockRoot = join(artifacts, 'cache', 'stories');
const lock = join(lockRoot, '.running');
mkdirSync(lockRoot, { recursive: true });
const oldLock = join(artifacts, 'stories', '.running');
if (existsSync(oldLock) && isRunning(Number(readFileSync(oldLock, 'utf8')))) {
  throw new Error('An older story runner is still active.');
}
const holder = existsSync(lock) ? Number(readFileSync(lock, 'utf8')) : undefined;
if (holder && isRunning(holder)) {
  console.error(`Another run is in progress (process ${holder}).`);
  process.exit(2);
}
writeFileSync(lock, String(process.pid));
const outRoot = createStoryRun(
  artifacts,
  basename(storiesDir),
  plays.map((play) => play.attemptId)
);
const cleanUp = () => {
  if (!flags.includes('--keep')) removeWorkers();
  rmSync(lock, { force: true });
};
process.on('SIGINT', () => {
  cleanUp();
  process.exit(130);
});

const started = performance.now();
let failed = 0;
try {
  // Made once here: every worker's story would otherwise make them at the same moment.
  ensureCertificates();
  const base = prepareBase(appPath);
  const prepared = performance.now();
  const workerNumbers = new Map<string, number>();
  const booted = performance.now();
  // Keep dependent stories together, but give each repetition a new wallet.
  const rounds = Array.from({ length: repeat }, (_, round) =>
    lanes(plays.filter((play) => play.round === round))
  );
  const played_ = await runRounds(
    rounds,
    () => {
      const workers = startWorkers(base, workerCount);
      workers.forEach((worker, index) => workerNumbers.set(worker, index + 1));
      return workers;
    },
    async (lane, worker) => {
      const outcomes: {
        story: Play;
        worker: string;
        outcome: { ok: boolean; output: string };
        wallMs: number;
      }[] = [];
      for (const story of lane) {
        const began = performance.now();
        const outcome = await playOne(story, worker);
        outcomes.push({ story, worker, outcome, wallMs: Math.round(performance.now() - began) });
      }
      return outcomes;
    }
  );
  const results = played_.flatMap((lane) => lane.outcome);
  const played = performance.now();
  const seconds = (ms: number) => (ms / 1000).toFixed(1);
  for (const result of results) {
    console.log(
      `${result.outcome.ok ? 'PASS' : 'FAIL'}  ${seconds(result.wallMs).padStart(5)} s  worker ${workerNumbers.get(result.worker)}  ${result.story.attemptId}`
    );
    if (result.outcome.ok) continue;
    failed += 1;
    console.log(result.outcome.output.trimEnd());
  }
  const times = results.map((result) => result.wallMs).toSorted((a, b) => a - b);
  console.log(
    `${results.length - failed} of ${results.length} stories passed on ${workerCount} workers in ${seconds(played - booted)} s` +
      ` (median story ${seconds(times[Math.floor(times.length / 2)])} s, slowest ${seconds(times[times.length - 1])} s)`
  );
  console.log(
    `prepared simulator ${seconds(prepared - started)} s, worker startup included in play time`
  );
  console.log(`results: ${outRoot} (bun run e2e:viewer)`);
} finally {
  finishStoryRun(outRoot);
  cleanUp();
}
process.exit(failed === 0 ? 0 : 1);
