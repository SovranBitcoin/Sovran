/* eslint-disable no-console -- CLI boundary */
/**
 * Play every story in a folder across several simulators at once:
 *   bun e2e/stories/run.ts [--workers 2] [--stories <dir>] [--app <Sovran.app>] [--repeat 1] [--keep]
 *
 * Prepares one simulator, clones it per worker, and gives each worker the next
 * story as it finishes the last. Each story is its own process, so one story's
 * work never delays another's touches. Evidence goes to
 * e2e/artifacts/stories/<story id>/ (with `--repeat`, <story id>-<n>/).
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPool } from './pool';
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

const started = performance.now();
const base = prepareBase(appPath);
const prepared = performance.now();
const workers = startWorkers(base, workerCount);
const booted = performance.now();
let failed = 0;
try {
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
  console.log(`evidence: ${outRoot}`);
} finally {
  if (!flags.includes('--keep')) removeWorkers();
}
process.exit(failed === 0 ? 0 : 1);
