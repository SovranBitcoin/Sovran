/**
 * Watches one simulator's screen, in a process of its own:
 *   bun e2e/stories/screenFrames.ts <udid> <native addon>
 *
 * The simulator hands over every frame it draws within a sixtieth of a second,
 * and repeats the last one a few times a second while nothing moves. This
 * writes `c` each time a frame differs from the one before, and, for each
 * line read (a file path), saves the frame now on screen there as a JPEG and
 * answers `w`, or `x` when no frame has arrived yet.
 *
 * It is a separate process because the capture inside the native addon
 * crashes about once in fifteen stories (a memory fault on its own threads);
 * here that ends this process, which the runner starts again, not the story.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

interface Native {
  SimCapture: new (
    udid: string,
    onFrame: (codec: number, data: Buffer) => void
  ) => { start(): void; stop(): void };
}
/** The capture's code for a frame that is a whole JPEG picture. */
const JPEG_FRAME = 0;

const [udid, addon] = process.argv.slice(2);
const native = createRequire(import.meta.url)(addon) as Native;
let latest: Buffer | undefined;
const capture = new native.SimCapture(udid, (codec, data) => {
  if (codec !== JPEG_FRAME || latest?.equals(data)) return;
  // The capture reuses its memory for the next frame.
  latest = Buffer.from(data);
  process.stdout.write('c\n');
});
capture.start();

const asked = createInterface({ input: process.stdin });
asked.on('line', (file) => {
  if (!latest) return void process.stdout.write('x\n');
  writeFileSync(file, latest);
  process.stdout.write('w\n');
});
asked.on('close', () => {
  capture.stop();
  process.exit(0);
});
