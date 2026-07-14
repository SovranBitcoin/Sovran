import type { Subprocess } from 'bun';

import { APP_ROOT } from './paths';
import { evictRun, listRunDirNames, liveRunIds } from './scan';
import type { JobStatus, TriggerRequest } from './types';

/** One job at a time: the simulator (and the funded-run lock) are global
 * resources, and diffs share the same slot to keep memory bounded. */

export interface JobEvent {
  event: 'line' | 'run-discovered' | 'progress' | 'exit';
  data: unknown;
}

interface Job {
  id: string;
  kind: 'run' | 'diff';
  status: 'running' | 'exited';
  exitCode?: number;
  runId?: string;
  argv?: string[];
  progress?: { done: number; total: number };
  lines: string[];
  listeners: Set<(event: JobEvent) => void>;
  child?: Subprocess;
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
    argv: job.argv,
    progress: job.progress,
  };
}

function emit(job: Job, event: JobEvent): void {
  if (event.event === 'line') job.lines.push(String(event.data));
  for (const listener of job.listeners) listener(event);
}

function finish(job: Job, exitCode: number): void {
  job.status = 'exited';
  job.exitCode = exitCode;
  if (job.runId) {
    liveRunIds.delete(job.runId);
    evictRun(job.runId); // pick up run.end on next read
  }
  if (active === job) active = undefined;
  emit(job, { event: 'exit', data: { code: exitCode } });
}

function newJob(kind: Job['kind']): Job {
  const job: Job = {
    id: `job-${++counter}`,
    kind,
    status: 'running',
    lines: [],
    listeners: new Set(),
  };
  jobs.set(job.id, job);
  active = job;
  return job;
}

export function buildRunArgv(
  request: TriggerRequest,
  fundedScenarioIds: ReadonlySet<string>,
  knownScenarioIds: ReadonlySet<string>
): { argv: string[] } | { error: string } {
  const argv = ['bun', 'e2e/cli.ts', 'run', '--driver', 'sim', '--i-approve-destructive-reset'];
  let fundedSelected = false;
  if (request.kind === 'scenario') {
    if (!knownScenarioIds.has(request.scenarioId)) return { error: 'unknown scenario' };
    // The full suite is validated to reference every scenario, so it can host
    // any single-scenario selection.
    argv.push('--suite', 'full', '--scenario', request.scenarioId);
    fundedSelected = fundedScenarioIds.has(request.scenarioId);
  } else {
    const suite = request.kind === 'suite' ? request.suite : (request.suite ?? 'default');
    if (suite !== 'default' && suite !== 'full') return { error: 'unknown suite' };
    argv.push('--suite', suite);
    fundedSelected = suite === 'full' && fundedScenarioIds.size > 0;
  }
  if (request.kind === 'commit-run') argv.push('--require-clean-git');
  if (request.acceptFundLoss === true && fundedSelected) argv.push('--i-accept-test-fund-loss');
  return { argv };
}

export function startRunJob(argv: string[]): JobStatus | { error: string } {
  if (active) return { error: `job ${active.id} is still running` };
  const job = newJob('run');
  job.argv = argv;
  // The CLI never prints its run dir; discover it as the run-* dir that
  // appears after spawn.
  const preexisting = new Set(listRunDirNames());
  const child = Bun.spawn(argv, {
    cwd: APP_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0' },
    onExit: (_proc, exitCode) => {
      clearInterval(discovery);
      finish(job, exitCode ?? -1);
    },
  });
  job.child = child;
  const discovery = setInterval(() => {
    if (job.runId) {
      clearInterval(discovery);
      return;
    }
    const fresh = listRunDirNames().find((name) => !preexisting.has(name));
    if (fresh) {
      job.runId = fresh;
      liveRunIds.add(fresh);
      emit(job, { event: 'run-discovered', data: { runId: fresh } });
      clearInterval(discovery);
    }
  }, 1_000);
  const pump = async (stream: ReadableStream<Uint8Array> | undefined | number) => {
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
  };
  void pump(child.stdout);
  void pump(child.stderr);
  return toStatus(job);
}

/** SIGTERM the active run job's CLI process, escalating to SIGKILL after a
 * grace window. The runner's own signal handling aborts the session fail-closed
 * (custody, ledgers, and the funded lock are retained; the next funded
 * preflight recovers), and onExit finishes the job normally. Diff jobs run
 * in-process and cannot be killed. */
export function killActiveJob(): { ok: true; id: string } | { error: string } {
  if (!active) return { error: 'no job is running' };
  if (active.kind !== 'run' || !active.child) {
    return { error: `${active.kind} job cannot be killed` };
  }
  const { child, id } = { child: active.child, id: active.id };
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
      if (job.runId) send({ event: 'run-discovered', data: { runId: job.runId } });
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
