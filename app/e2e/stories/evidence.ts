/**
 * A story's evidence (ADR 0033): one continuous video, and a picture for each
 * step. The video is continuous; checkpoint pictures are new simulator captures.
 * Capture latency is included in the run and is not app-performance evidence.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { join } from 'node:path';
import { SIMCTL } from './simctl';

/** Last observed change and whether equal samples were not obtained within the budget. */
interface ScreenMotion {
  movedForMs: number;
  stillMoving: boolean;
}

interface Recording {
  /** End the recording; resolves once the file is complete. */
  stop(): Promise<void>;
}

type Launch = (command: string, args: string[]) => ChildProcess;
interface RecorderIo {
  launch?: Launch;
  startupMs?: number;
  stopMs?: number;
}

/**
 * Record a simulator's screen for the story's video. Resolves when the first
 * frame has been captured, which is when `simctl` says "Recording started".
 * Nothing is timed from this file: on a busy Mac it is written seconds late.
 */
const spawnRecorder: Launch = (command, args) =>
  spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

export function recordSimulator(udid: string, file: string, io: RecorderIo = {}) {
  const child = (io.launch ?? spawnRecorder)(SIMCTL[0], [
    ...SIMCTL.slice(1),
    'io',
    udid,
    'recordVideo',
    '--codec',
    'h264',
    '--force',
    file,
  ]);
  return recordScreen(child, { ...io, ready: 'Recording started' });
}

/** Where an Android recording is written on the device before it is pulled. */
export const ANDROID_RECORDING = '/data/local/tmp/sovran-story.mp4';
/** `screenrecord` stops itself after this; a story still running then has a gap. */
const ANDROID_RECORDING_LIMIT_S = 180;

/**
 * Record an emulator's screen with `screenrecord` for the story's video. Ready
 * once it reports the content area it captures. It finalizes only on an
 * interrupt delivered on the device: interrupting the local adb client leaves
 * an unreadable file. A story longer than the time limit fails as a gap.
 */
export function recordAndroid(
  adb: readonly [string, ...string[]],
  io: RecorderIo & { interrupt?: () => Promise<unknown> } = {}
) {
  const shell = (args: string[]) => [...adb.slice(1), 'shell', ...args];
  const child = (io.launch ?? spawnRecorder)(
    adb[0],
    shell([
      'screenrecord',
      '--verbose',
      '--time-limit',
      String(ANDROID_RECORDING_LIMIT_S),
      ANDROID_RECORDING,
    ])
  );
  const interrupt =
    io.interrupt ??
    (() =>
      new Promise<void>((resolve, reject) =>
        execFile(adb[0], shell(['pkill', '-INT', '-x', 'screenrecord']), { timeout: 10_000 }, (error) =>
          error ? reject(error) : resolve()
        )
      ));
  return recordScreen(child, { ...io, ready: 'Content area is', interrupt });
}

/**
 * The recorder lifecycle both platforms share. Exiting before stop, even with
 * status 0, leaves a gap in the video and fails; so does any unclean finish.
 */
async function recordScreen(
  child: ChildProcess,
  io: RecorderIo & { ready: string; interrupt?: () => Promise<unknown> }
): Promise<Recording> {
  type End = { code: number | null; signal: NodeJS.Signals | null } | { error: Error };
  let ended: End | undefined;
  const exited = new Promise<End>((resolve) => {
    const finish = (result: End) => {
      ended = result;
      resolve(result);
    };
    child.once('exit', (code, signal) => finish({ code, signal }));
    child.once('error', (error) => {
      // A failed signal is not termination. Only a spawn with no PID has nothing to reap.
      if (child.pid === undefined) finish({ error });
    });
  });
  let processError: Error | undefined;
  const failed = new Promise<never>((_, reject) =>
    child.on('error', (error) => {
      processError ??= error;
      reject(error);
    })
  );
  const describe = (end: End) =>
    'error' in end ? end.error.message : `code ${end.code}, signal ${end.signal}`;
  let said = '';
  const ready = new Promise<void>((resolve) => {
    const hear = (chunk: Buffer) => {
      said = (said + chunk.toString()).slice(-4000);
      if (said.includes(io.ready)) resolve();
    };
    child.stdout?.on('data', hear);
    child.stderr?.on('data', hear);
  });
  const bounded = async <T>(work: Promise<T>, ms: number, message: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${message}: ${said.trim() || 'no output'}`)),
            ms
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const reap = async () => {
    if (!ended) child.kill('SIGKILL');
    await bounded(exited, 5000, 'Recorder did not exit after forced cleanup');
    child.stdout?.destroy();
    child.stderr?.destroy();
  };
  const cleanFailure = async (error: unknown): Promise<never> => {
    try {
      await reap();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        `Recorder failed: ${String(error)}; cleanup failed: ${String(cleanup)}`
      );
    }
    throw error;
  };
  try {
    await bounded(
      Promise.race([
        ready,
        failed,
        exited.then((end) => {
          throw new Error(`Recorder exited before readiness: ${describe(end)}`);
        }),
      ]),
      io.startupMs ?? 10000,
      'The screen did not start recording'
    );
  } catch (error) {
    return cleanFailure(new Error(`Recorder failed before readiness: ${String(error)}`));
  }
  let stopping: Promise<void> | undefined;
  return {
    stop() {
      stopping ??= (async () => {
        try {
          // Even exit(0) before this request leaves a gap in the story's video.
          if (processError) throw processError;
          if (ended) throw new Error(`Recorder exited before stop: ${describe(ended)}`);
          if (io.interrupt) await io.interrupt();
          else if (!child.kill('SIGINT')) throw new Error('Recorder was gone before stop');
          const end = await bounded(
            Promise.race([exited, failed]),
            io.stopMs ?? 10000,
            'Recorder did not stop gracefully'
          );
          if ('error' in end || end.code !== 0 || end.signal !== null)
            throw new Error(`Recorder did not finalize successfully: ${describe(end)}`);
          child.stdout?.destroy();
          child.stderr?.destroy();
        } catch (error) {
          return cleanFailure(error);
        }
      })();
      return stopping;
    },
  };
}

/**
 * One fresh capture of the internal display. stdout belongs to this invocation;
 * a previous file or a responsive process serving cached bytes cannot satisfy it.
 */
export async function captureSimulatorScreen(
  udid: string,
  timeoutMs = 5000,
  command: readonly [string, ...string[]] = SIMCTL
) {
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    execFile(
      command[0],
      [...command.slice(1), 'io', udid, 'screenshot', '--type=jpeg', '--display=internal', '-'],
      { encoding: 'buffer', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 24_000_000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    );
  });
  const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 }).timeout({
    seconds: Math.max(1, Math.ceil(timeoutMs / 1000)),
  });
  const metadata = await image.metadata();
  if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height)
    throw new Error('The simulator did not return a JPEG screen');
  // Metadata alone accepts a truncated image. Decode before accepting the capture.
  const { data: pixels, info } = await image
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { jpeg: bytes, pixels, width: info.width, height: info.height };
}

/**
 * Compare fresh display samples, never a cached addon surface. Equal samples
 * are evidence at those observation points, not continuous motion measurement.
 */
export function createScreenWatch(io: {
  capture: (timeoutMs: number) => ReturnType<typeof captureSimulatorScreen>;
  now: () => number;
  wait: (ms: number) => Promise<void>;
}) {
  return {
    async picture(file: string) {
      const startedAtWallMs = Date.now();
      const bytes = await io.capture(5000);
      writeFileSync(file, bytes.jpeg, { flag: 'wx' });
      return { startedAtWallMs, endedAtWallMs: Date.now() };
    },
    async pixelsStill(stillForMs = 100, giveUpAfterMs = 3000): Promise<ScreenMotion> {
      const started = io.now();
      const deadline = started + giveUpAfterMs;
      let longestCaptureMs = 0;
      const sample = async () => {
        const captureStarted = io.now();
        const remaining = deadline - captureStarted;
        if (remaining <= 0) throw new Error('Screen capture exceeded the settling deadline');
        const bytes = await io.capture(Math.max(1, Math.floor(remaining)));
        if (io.now() >= deadline) throw new Error('Screen capture exceeded the settling deadline');
        longestCaptureMs = Math.max(longestCaptureMs, io.now() - captureStarted);
        return bytes;
      };
      let previous = await sample();
      let movedForMs = 0;
      for (;;) {
        // Capture may happen anywhere during a request. Begin the confirming
        // request only after the observation interval has elapsed after completion.
        if (deadline - io.now() <= stillForMs + longestCaptureMs)
          return { movedForMs, stillMoving: true };
        await io.wait(stillForMs);
        const current = await sample();
        if (
          previous.width === current.width &&
          previous.height === current.height &&
          previous.pixels.equals(current.pixels)
        )
          return { movedForMs, stillMoving: false };
        movedForMs = Math.round(io.now() - started);
        previous = current;
      }
    },
  };
}

/** File name, without extension, of a step's picture. */
export function pictureName(index: number, stepName: string): string {
  return `${String(index + 1).padStart(2, '0')}-${stepName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let said = '';
    child.stderr?.on('data', (chunk: Buffer) => (said += chunk.toString()));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${said.trim().slice(-400)}`))
    );
  });
}

/**
 * Keep the story's video as the simulator recorded it: full size, and a frame
 * for every one the screen drew, so it is as smooth as the app was. Only the
 * file's index is moved to the front, so it starts playing at once; nothing is
 * encoded again. Shrinking it to a steady 30 frames a second took 0.9 s a
 * story alone and 4.7 s with six stories finishing together, for a file a
 * quarter of the size. The raw file is the caller's to delete.
 */
export async function keepVideo(rawVideo: string, outDir: string): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const video = join(outDir, 'story.mp4');
  await ffmpeg(['-i', rawVideo, '-c', 'copy', '-movflags', '+faststart', video]);
  return video;
}
