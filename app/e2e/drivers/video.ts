/**
 * Per-scenario screen recording for simulator runs. A dedicated
 * `xcrun simctl io <udid> recordVideo` child covers exactly the test+verify
 * window (the orchestrator starts it after setup and stops it before cleanup),
 * independent of the serve-sim bridge, which deliberately never streams the
 * framebuffer. The recorder is evidence, not a gate: every failure path warns
 * and degrades to "no video" instead of failing the scenario.
 */
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface VideoRecorder {
  /** Begin recording for one scenario; resolves to the absolute output path,
   *  or null when recording could not start (never throws). */
  start(scenarioId: string): Promise<string | null>;
  /** Finalize the active recording (SIGINT, bounded wait). True only when the
   *  recorder exited cleanly and left a non-empty file behind. */
  stop(): Promise<boolean>;
  /** Session-teardown belt-and-braces: finalize or kill any live recorder. */
  dispose(): Promise<void>;
}

export interface RecorderProcess {
  readonly exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
}

export interface SimVideoRecorderOptions {
  udid: string;
  /** Run directory; the video lands at `<runDir>/<scenarioId>/video.mp4`. */
  runDir: string;
  spawn?: (argv: string[]) => RecorderProcess;
  /** True when the recording output exists with at least one byte. */
  hasOutput?: (path: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
  onWarning?: (message: string) => void;
  /** Budget for the recorder to create its output file before the first test step. */
  startTimeoutMs?: number;
  /** Budget for SIGINT finalization before falling back to SIGKILL. */
  stopTimeoutMs?: number;
}

const defaultSpawn = (argv: string[]): RecorderProcess =>
  Bun.spawn(argv, { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });

const defaultHasOutput = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).size > 0;
  } catch {
    return false;
  }
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ActiveRecording {
  child: RecorderProcess;
  outPath: string;
}

export function createSimVideoRecorder(options: SimVideoRecorderOptions): VideoRecorder {
  const {
    udid,
    runDir,
    spawn = defaultSpawn,
    hasOutput = defaultHasOutput,
    sleep = defaultSleep,
    onWarning = (message) => process.stderr.write(`[e2e] ${message}\n`),
    startTimeoutMs = 3000,
    stopTimeoutMs = 10_000,
  } = options;
  let active: ActiveRecording | undefined;

  const awaitExit = async (child: RecorderProcess, budgetMs: number): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((r) => {
      timer = setTimeout(() => r('timeout'), budgetMs);
    });
    const outcome = await Promise.race([child.exited, timeout]);
    clearTimeout(timer);
    return outcome !== 'timeout';
  };

  const forceKill = async (child: RecorderProcess) => {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
    await awaitExit(child, 1000);
  };

  const stop = async (): Promise<boolean> => {
    if (!active) return false;
    const { child, outPath } = active;
    active = undefined;
    try {
      // SIGINT is the only stop signal recordVideo finalizes on; anything
      // harder leaves an unreadable container behind.
      child.kill('SIGINT');
    } catch {
      // recorder already exited; the file may still have finalized
    }
    const exited = await awaitExit(child, stopTimeoutMs);
    if (!exited) {
      await forceKill(child);
      onWarning(`video recorder did not finalize within ${stopTimeoutMs}ms — recording dropped`);
      return false;
    }
    if (!hasOutput(outPath)) {
      onWarning('video recorder exited without producing a recording');
      return false;
    }
    try {
      chmodSync(outPath, 0o600);
    } catch {
      // permissions are best-effort; the run dir itself is already 0o700
    }
    return true;
  };

  return {
    async start(scenarioId: string): Promise<string | null> {
      if (active) {
        onWarning('video recorder was still active at scenario start — finalizing previous one');
        await stop();
      }
      const outPath = join(runDir, scenarioId, 'video.mp4');
      let child: RecorderProcess;
      try {
        mkdirSync(dirname(outPath), { recursive: true, mode: 0o700 });
        child = spawn([
          'xcrun',
          'simctl',
          'io',
          udid,
          'recordVideo',
          '--codec',
          'h264',
          '--force',
          outPath,
        ]);
      } catch (error) {
        onWarning(
          `video recording unavailable: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
      }
      // Only report started once frames are actually being written, so the
      // scenario's first test frame is guaranteed to be inside the video.
      let exitedEarly = false;
      void child.exited.then(() => {
        exitedEarly = true;
      });
      const deadline = Date.now() + startTimeoutMs;
      while (!hasOutput(outPath)) {
        if (exitedEarly || Date.now() >= deadline) {
          // forceKill resolves `exited`, so pick the reason before killing.
          const message = exitedEarly
            ? 'video recorder exited before producing output — recording disabled for this scenario'
            : `video recorder produced no output within ${startTimeoutMs}ms — recording disabled for this scenario`;
          await forceKill(child);
          onWarning(message);
          return null;
        }
        await sleep(100);
      }
      active = { child, outPath };
      return outPath;
    },
    stop,
    async dispose(): Promise<void> {
      if (!active) return;
      await stop();
    },
  };
}
