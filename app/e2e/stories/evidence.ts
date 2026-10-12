/**
 * A story's evidence (ADR 0033): one continuous video, and a picture for each
 * step cut from that video afterwards. Nothing is captured between steps, so
 * recording never pauses the app or changes what is being tested.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Long edge of the kept video and pictures: legible, and a tenth of the raw size. */
const KEPT_HEIGHT = 1280;
/** Frames a second in the kept video. */
const KEPT_FPS = 30;

/** How long the screen kept changing, and whether it was still changing when the watch gave up. */
interface ScreenMotion {
  movedForMs: number;
  stillMoving: boolean;
}

interface Recording {
  /** Wall clock at the recording's first frame. */
  startedAtWallMs: number;
  /** Resolves once the picture on screen has stopped changing. */
  pixelsStill(): Promise<ScreenMotion>;
  /** End the recording; resolves once the file is complete. */
  stop(): Promise<void>;
}

/**
 * Record a simulator's screen. Resolves when the first frame has been captured,
 * which is when `simctl` says "Recording started".
 */
export function recordSimulator(udid: string, file: string): Promise<Recording> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'xcrun',
      ['simctl', 'io', udid, 'recordVideo', '--codec', 'h264', '--force', file],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    const exited = new Promise<void>((done) => child.once('exit', () => done()));
    let said = '';
    const failed = setTimeout(
      () =>
        reject(new Error(`The simulator did not start recording: ${said.trim() || 'no output'}`)),
      10_000
    );
    child.once('error', reject);
    child.stderr.on('data', (chunk: Buffer) => {
      said += chunk.toString();
      if (!said.includes('Recording started')) return;
      clearTimeout(failed);
      resolve({
        startedAtWallMs: Date.now(),
        pixelsStill: () =>
          watchPixels({
            size: () => {
              try {
                return statSync(file).size;
              } catch {
                return 0;
              }
            },
            now: () => performance.now(),
            wait: (ms) => new Promise((done) => setTimeout(done, ms)),
          }),
        stop: async () => {
          child.kill('SIGINT');
          await exited;
        },
      });
    });
  });
}

/** The recording must not have grown for this long for the screen to count as still. */
const STILL_FOR_MS = 100;
/** A screen that never stops (a spinner, a moving background) is not waited for beyond this. */
const MOVING_CAP_MS = 900;
const SAMPLE_EVERY_MS = 8;

/**
 * Whether the picture on screen is changing, read from the recording itself.
 * The simulator writes a frame only when the screen changes, so the file grows
 * while pixels move and stops when they stop: measured at no growth on an idle
 * screen, and growth from 52 ms after a touch until its animation ended. This
 * sees what the app cannot report, an animation running off its JavaScript
 * thread, and needs nothing from the app.
 */
export async function watchPixels(io: {
  size: () => number;
  now: () => number;
  wait: (ms: number) => Promise<void>;
}): Promise<ScreenMotion> {
  const started = io.now();
  let lastSize = io.size();
  let lastGrewAt = started;
  let moved = false;
  for (;;) {
    await io.wait(SAMPLE_EVERY_MS);
    const now = io.now();
    const size = io.size();
    if (size !== lastSize) {
      lastSize = size;
      lastGrewAt = now;
      moved = true;
    }
    if (now - lastGrewAt >= STILL_FOR_MS)
      return { movedForMs: moved ? Math.round(lastGrewAt - started) : 0, stillMoving: false };
    if (now - started >= MOVING_CAP_MS)
      return { movedForMs: Math.round(now - started), stillMoving: true };
  }
}

interface StepPicture {
  /** File name without extension. */
  name: string;
  /** Seconds into the video. */
  atSeconds: number;
}

/** Where in the video each step's picture is: the moment the step was satisfied. */
export function stepPictures(
  recordingStartedAtWallMs: number,
  steps: { name: string; endedAtWallMs: number }[]
): StepPicture[] {
  return steps.map((step, index) => ({
    name: `${String(index + 1).padStart(2, '0')}-${step.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    atSeconds: Math.max(0, step.endedAtWallMs - recordingStartedAtWallMs) / 1000,
  }));
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let said = '';
    child.stderr.on('data', (chunk: Buffer) => (said += chunk.toString()));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${said.trim().slice(-400)}`))
    );
  });
}

/**
 * The frame the kept video shows at a moment, as a picture. The simulator only
 * writes a frame when the screen changes, so the raw recording has no frame for
 * a moment when the screen was still; the kept video has one every thirtieth of
 * a second, each repeating what was on screen. A moment past the end is the
 * last frame.
 */
async function cutPicture(video: string, atSeconds: number, file: string): Promise<void> {
  const picture = ['-frames:v', '1', '-q:v', '3', file];
  // One frame back, so the picture is never of what happened next.
  const at = Math.max(0, Math.floor(atSeconds * KEPT_FPS) - 1) / KEPT_FPS;
  try {
    await ffmpeg(['-ss', at.toFixed(3), '-i', video, ...picture]);
  } catch {
    await ffmpeg(['-sseof', '-0.1', '-i', video, '-update', '1', ...picture]);
  }
}

/**
 * Turn the raw recording into what is kept: a smaller video at a steady 30
 * frames a second, and one picture per step cut from it. The raw file is the caller's to
 * delete.
 */
export async function keepEvidence(
  rawVideo: string,
  outDir: string,
  pictures: StepPicture[]
): Promise<{ video: string; pictures: string[] }> {
  mkdirSync(outDir, { recursive: true });
  const video = join(outDir, 'story.mp4');
  const files = pictures.map((picture) => join(outDir, `${picture.name}.jpg`));
  await ffmpeg([
    '-i',
    rawVideo,
    '-vf',
    `scale=-2:${KEPT_HEIGHT}`,
    '-r',
    String(KEPT_FPS),
    '-c:v',
    'h264_videotoolbox',
    '-b:v',
    '2000k',
    '-movflags',
    '+faststart',
    video,
  ]);
  await Promise.all(
    pictures.map((picture, index) => cutPicture(video, picture.atSeconds, files[index]))
  );
  return { video, pictures: files };
}
