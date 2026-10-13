/**
 * A story's evidence (ADR 0033): one continuous video, and a picture for each
 * step. Both come from the simulator's screen as it is drawn, so collecting
 * them never pauses the app or changes what is being tested.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SIMCTL } from './simctl';

/** How long the screen kept changing, and whether it was still changing when the watch gave up. */
interface ScreenMotion {
  movedForMs: number;
  stillMoving: boolean;
}

interface Recording {
  /** End the recording; resolves once the file is complete. */
  stop(): Promise<void>;
}

/**
 * Record a simulator's screen for the story's video. Resolves when the first
 * frame has been captured, which is when `simctl` says "Recording started".
 * Nothing is timed from this file: on a busy Mac it is written seconds late.
 */
export function recordSimulator(udid: string, file: string): Promise<Recording> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      SIMCTL[0],
      [...SIMCTL.slice(1), 'io', udid, 'recordVideo', '--codec', 'h264', '--force', file],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    const exited = new Promise<void>((done) => child.once('exit', () => done()));
    let said = '';
    const failed = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`The simulator did not start recording: ${said.trim() || 'no output'}`));
    }, 10_000);
    child.once('error', reject);
    child.stderr.on('data', (chunk: Buffer) => {
      said += chunk.toString();
      if (!said.includes('Recording started')) return;
      clearTimeout(failed);
      resolve({
        stop: async () => {
          child.kill('SIGINT');
          await exited;
        },
      });
    });
  });
}

/** The picture must not have changed for this long for the screen to count as still. */
const STILL_FOR_MS = 100;
/** A screen that never stops (a spinner, a moving background) is not waited for beyond this. */
const MOVING_CAP_MS = 900;
const SAMPLE_EVERY_MS = 8;

interface ScreenWatch {
  /** The picture on the simulator's screen has just changed. */
  changed(): void;
  /** Resolves once the picture on screen has not changed for `stillForMs` (100 ms unless said). */
  pixelsStill(stillForMs?: number, giveUpAfterMs?: number): Promise<ScreenMotion>;
}

/**
 * Whether the picture on screen is changing, from the screen itself: told of
 * every frame that differs from the one before, within a sixtieth of a second
 * of its being drawn. This sees what the app cannot report, an animation
 * running off its JavaScript thread, and needs nothing from the app. (The
 * video file cannot be used for this: on a busy Mac it is written late, and
 * steps were called still while they were moving.)
 */
export function createScreenWatch(io: {
  now: () => number;
  wait: (ms: number) => Promise<void>;
}): ScreenWatch {
  let changedAt = Number.NEGATIVE_INFINITY;
  return {
    changed() {
      changedAt = io.now();
    },
    async pixelsStill(stillForMs = STILL_FOR_MS, giveUpAfterMs = MOVING_CAP_MS) {
      const started = io.now();
      for (;;) {
        await io.wait(SAMPLE_EVERY_MS);
        const now = io.now();
        // A change from before the watch began says nothing about what the step set off.
        const moved = changedAt > started;
        if (now - Math.max(started, changedAt) >= stillForMs)
          return { movedForMs: moved ? Math.round(changedAt - started) : 0, stillMoving: false };
        if (now - started >= giveUpAfterMs)
          return { movedForMs: Math.round(now - started), stillMoving: true };
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
    child.stderr.on('data', (chunk: Buffer) => (said += chunk.toString()));
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
