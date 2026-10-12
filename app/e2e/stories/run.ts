/* eslint-disable no-console -- CLI boundary */
/**
 * Play every story in a folder across several simulators at once:
 *   bun e2e/stories/run.ts [--workers 2] [--stories <dir>] [--app <Sovran.app>] [--repeat 1] [--keep]
 *
 * Prepares one simulator, clones it per worker, and gives each worker the next
 * story as it finishes the last. Each story is its own process, so one story's
 * work never delays another's touches. Evidence goes to
 * e2e/artifacts/stories/<story id>/ (with `--repeat`, <story id>-<n>/), and
 * e2e/artifacts/stories/index.html shows the whole run.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPool } from './pool';
import { writeRunReport } from './runReport';
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
const outRoot = join(HERE, '../artifacts/stories');

interface Play {
  file: string;
  out: string;
}

const files = readdirSync(storiesDir)
  .filter((name) => name.endsWith('.json'))
  .toSorted();
const plays: Play[] = Array.from({ length: repeat }, (_, round) =>
  files.map((name) => ({
    file: join(storiesDir, name),
    out: join(outRoot, repeat === 1 ? name.slice(0, -5) : `${name.slice(0, -5)}-${round + 1}`),
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
  return new Promise((resolve) => {
    const child = spawn(
      'bun',
      [join(HERE, 'cli.ts'), play.file, '--udid', udid, '--app', appPath, '--out', play.out],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
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
const lock = join(outRoot, '.running');
mkdirSync(outRoot, { recursive: true });
const holder = existsSync(lock) ? Number(readFileSync(lock, 'utf8')) : undefined;
if (holder && isRunning(holder)) {
  console.error(`Another run is in progress (process ${holder}).`);
  process.exit(2);
}
writeFileSync(lock, String(process.pid));
// The folder holds one run: what an earlier run left would be reported as this one's.
for (const left of readdirSync(outRoot)) {
  if (left !== '.running') rmSync(join(outRoot, left), { recursive: true, force: true });
}
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
  const base = prepareBase(appPath);
  const prepared = performance.now();
  const workers = startWorkers(base, workerCount);
  const booted = performance.now();
  const results = await runPool(plays, workers, playOne);
  const played = performance.now();
  const seconds = (ms: number) => (ms / 1000).toFixed(1);
  for (const result of results) {
    console.log(
      `${result.outcome.ok ? 'PASS' : 'FAIL'}  ${seconds(result.wallMs).padStart(5)} s  worker ${workers.indexOf(result.worker) + 1}  ${result.story.out.split('/').at(-1)}`
    );
    if (result.outcome.ok) continue;
    failed += 1;
    console.log(result.outcome.output.trimEnd());
  }
  const times = results.map((result) => result.wallMs).toSorted((a, b) => a - b);
  console.log(
    `${results.length - failed} of ${results.length} stories passed on ${workers.length} workers in ${seconds(played - booted)} s` +
      ` (median story ${seconds(times[Math.floor(times.length / 2)])} s, slowest ${seconds(times[times.length - 1])} s)`
  );
  console.log(
    `prepared simulator ${seconds(prepared - started)} s, workers cloned and booted ${seconds(booted - prepared)} s`
  );
  console.log(`report: ${writeRunReport(outRoot)}`);
} finally {
  cleanUp();
}
process.exit(failed === 0 ? 0 : 1);
