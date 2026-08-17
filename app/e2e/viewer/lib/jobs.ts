import type { Subprocess } from 'bun';

import { APP_ROOT } from './paths';
import { evictRun, listRunDirNames, liveRunIds } from './scan';
import type { JobStatus } from './types';

/** One job at a time: device sessions (and the funded-run lock) are global
 * resources. A matrix run owns that slot while it launches its platform
 * commands sequentially; diffs share the same slot to keep memory bounded. */

interface JobEvent {
  event: 'line' | 'run-discovered' | 'progress' | 'exit';
  data: unknown;
}

interface Job {
  id: string;
  kind: 'run' | 'diff';
  status: 'running' | 'exited';
  exitCode?: number;
  runId?: string;
  runIds: string[];
  argv?: string[];
  argvs?: string[][];
  progress?: { done: number; total: number };
  lines: string[];
  listeners: Set<(event: JobEvent) => void>;
  child?: Subprocess;
  cancelRequested?: boolean;
}

let active: Job | undefined;
const jobs = new Map<string, Job>();
let counter = 0;

export function activeJob(): JobStatus | undefined {
  return active ? toStatus(active) : undefined;
}

export function getJob(id: string): JobStatus | undefined {
  const job = jobs.get(id);
  return job ? toStatus(job) : undefined;
}

function toStatus(job: Job): JobStatus {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    exitCode: job.exitCode,
    runId: job.runId,
    runIds: [...job.runIds],
    argv: job.argv,
    argvs: job.argvs,
    progress: job.progress,
  };
}

function emit(job: Job, event: JobEvent): void {
  if (event.event === 'line') job.lines.push(String(event.data));
  for (const listener of job.listeners) listener(event);
}

function finish(job: Job, exitCode: number): void {
  if (job.status === 'exited') return;
  job.status = 'exited';
  job.exitCode = exitCode;
  for (const runId of job.runIds) {
    liveRunIds.delete(runId);
    evictRun(runId); // pick up run.end on next read
  }
  if (active === job) active = undefined;
  emit(job, { event: 'exit', data: { code: exitCode } });
}

function newJob(kind: Job['kind']): Job {
  const job: Job = {
    id: `job-${++counter}`,
    kind,
    status: 'running',
    runIds: [],
    lines: [],
    listeners: new Set(),
  };
  jobs.set(job.id, job);
  active = job;
  return job;
}

function discoverRuns(job: Job, preexisting: ReadonlySet<string>): string[] {
  const fresh = listRunDirNames()
    .filter((name) => !preexisting.has(name) && !job.runIds.includes(name))
    .reverse();
  for (const runId of fresh) {
    job.runIds.push(runId);
    job.runId = runId;
    liveRunIds.add(runId);
    emit(job, { event: 'run-discovered', data: { runId } });
  }
  return fresh;
}

async function pump(job: Job, stream: ReadableStream<Uint8Array> | undefined | number) {
  if (!stream || typeof stream === 'number') return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) emit(job, { event: 'line', data: line });
  }
  if (buffered) emit(job, { event: 'line', data: buffered });
}

async function runCommand(job: Job, argv: string[]): Promise<number> {
  const preexisting = new Set(listRunDirNames());
  const firstRunIndex = job.runIds.length;
  const child = Bun.spawn(argv, {
    cwd: APP_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  job.child = child;
  job.argv = argv;
  const discovery = setInterval(() => discoverRuns(job, preexisting), 1_000);
  const stdout = pump(job, child.stdout);
  const stderr = pump(job, child.stderr);
  const exitCode = await child.exited;
  clearInterval(discovery);
  discoverRuns(job, preexisting);
  const commandRunIds = job.runIds.slice(firstRunIndex);
  await Promise.allSettled([stdout, stderr]);
  job.child = undefined;
  for (const runId of commandRunIds) {
    liveRunIds.delete(runId);
    evictRun(runId);
  }
  return exitCode ?? -1;
}

async function runCommands(job: Job, argvs: string[][]): Promise<void> {
  let exitCode = 0;
  for (const argv of argvs) {
    if (job.cancelRequested) break;
    const commandExit = await runCommand(job, argv);
    if (commandExit !== 0 && exitCode === 0) exitCode = commandExit;
  }
  finish(job, exitCode);
}

/** Start one viewer job containing one or more sequential product commands.
 * A one-dimensional argv is accepted for existing callers and focused tests. */
export function startRunJob(argvOrArgvs: string[] | string[][]): JobStatus | { error: string } {
  if (active) return { error: `job ${active.id} is still running` };
  const argvs =
    typeof argvOrArgvs[0] === 'string' ? [argvOrArgvs as string[]] : (argvOrArgvs as string[][]);
  if (argvs.length === 0 || argvs.some((argv) => argv.length === 0)) {
    return { error: 'run job requires at least one command' };
  }
  const job = newJob('run');
  job.argv = argvs[0];
  job.argvs = argvs.map((argv) => [...argv]);
  void runCommands(job, job.argvs).catch(() => finish(job, 1));
  return toStatus(job);
}

/** SIGTERM the active run job's CLI process, escalating to SIGKILL after a
 * grace window. The runner's own signal handling aborts the session fail-closed
 * (custody, ledgers, and the funded lock are retained; the next funded
 * preflight recovers), and onExit finishes the job normally. Diff jobs run
 * in-process and cannot be killed. */
export function killActiveJob(): { ok: true; id: string } | { error: string } {
  if (!active) return { error: 'no job is running' };
  if (active.kind !== 'run') {
    return { error: `${active.kind} job cannot be killed` };
  }
  const { child, id } = { child: active.child, id: active.id };
  active.cancelRequested = true;
  if (!child) return { ok: true, id };
  try {
    child.kill('SIGTERM');
  } catch {
    // already exited
  }
  setTimeout(() => {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch {
      // exited inside the grace window
    }
  }, 15_000);
  return { ok: true, id };
}

export function startDiffJob(
  run: (onProgress: (progress: { done: number; total: number }) => void) => Promise<unknown>
): JobStatus | { error: string } {
  if (active) return { error: `job ${active.id} is still running` };
  const job = newJob('diff');
  void run((progress) => {
    job.progress = progress;
    emit(job, { event: 'progress', data: progress });
  })
    .then(() => finish(job, 0))
    .catch(() => finish(job, 1));
  return toStatus(job);
}

/** SSE stream for a job: replays buffered lines, then follows live events. */
export function jobStream(id: string): Response | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  const encoder = new TextEncoder();
  let listener: ((event: JobEvent) => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: JobEvent) => {
        controller.enqueue(
          encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
        );
      };
      for (const line of job.lines) send({ event: 'line', data: line });
      for (const runId of job.runIds) send({ event: 'run-discovered', data: { runId } });
      if (job.status === 'exited') {
        send({ event: 'exit', data: { code: job.exitCode } });
        controller.close();
        return;
      }
      listener = (event) => {
        try {
          send(event);
          if (event.event === 'exit') controller.close();
        } catch {
          // client went away
        }
      };
      job.listeners.add(listener);
    },
    cancel() {
      if (listener) job.listeners.delete(listener);
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}
