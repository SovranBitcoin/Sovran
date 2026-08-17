/**
 * Child CLI process ownership. One chunk = one `bun e2e/cli.ts run …` child;
 * the orchestrator survives whatever kills the child (emulator wedge, thrown
 * session error, operator Ctrl-C) and classifies the durable run dir instead.
 */
import { appendFileSync } from 'node:fs';

import { listRunDirNames } from '../viewer/lib/scan';

export interface ChildResult {
  exitCode: number;
  /** The run dir the child created (diffed against a pre-spawn snapshot). */
  runDirName?: string;
  /** True when terminate() was used — outcome must be 'interrupted'. */
  interrupted: boolean;
}

export interface ChildHandle {
  done: Promise<ChildResult>;
  /** SIGTERM now; SIGKILL if the child survives the grace window. */
  terminate(): void;
}

interface SpawnChunkOptions {
  cwd: string;
  /** Absolute path; every child line is appended here as well as stdout. */
  logFile: string;
  killGraceMs?: number;
}

const KILL_GRACE_MS = 15_000;

export function spawnChunkChild(argv: string[], options: SpawnChunkOptions): ChildHandle {
  const before = new Set(listRunDirNames());
  const child = Bun.spawn(argv, {
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });
  let interrupted = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const emit = (line: string) => {
    process.stdout.write(`${line}\n`);
    try {
      appendFileSync(options.logFile, `${line}\n`);
    } catch {
      // logging must never kill the campaign
    }
  };

  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let carry = '';
    for (;;) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) emit(line);
    }
    if (carry.length > 0) emit(carry);
  };

  const done = (async (): Promise<ChildResult> => {
    await Promise.all([pump(child.stdout), pump(child.stderr)]);
    const exitCode = await child.exited;
    if (killTimer) clearTimeout(killTimer);
    const fresh = listRunDirNames()
      .filter((name) => !before.has(name))
      .sort();
    if (fresh.length > 1) {
      emit(
        `⚠ orchestrator: ${fresh.length} new run dirs appeared for one chunk; using ${fresh.at(-1)}`
      );
    }
    return { exitCode, runDirName: fresh.at(-1), interrupted };
  })();

  return {
    done,
    terminate: () => {
      if (interrupted) return;
      interrupted = true;
      try {
        child.kill('SIGTERM');
      } catch {
        return;
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
      }, options.killGraceMs ?? KILL_GRACE_MS);
    },
  };
}
