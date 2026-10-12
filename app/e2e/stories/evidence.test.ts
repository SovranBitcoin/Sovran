import { expect, test } from 'bun:test';
import { stepPictures, watchPixels } from './evidence';

test('a step is pictured at the moment it was satisfied, by the recording clock', () => {
  const pictures = stepPictures(1_000_000, [
    { name: 'the Terms are shown first', endedAtWallMs: 1_003_500 },
    { name: 'agree to the Terms', endedAtWallMs: 1_003_640 },
  ]);

  expect(pictures).toEqual([
    { name: '01-the-terms-are-shown-first', atSeconds: 3.5 },
    { name: '02-agree-to-the-terms', atSeconds: 3.64 },
  ]);
});

test('a step that ended before the first frame is pictured at the start', () => {
  expect(stepPictures(1_000_000, [{ name: 'launch', endedAtWallMs: 999_000 }])[0].atSeconds).toBe(
    0
  );
});

/** A recording that grows at the given times; each wait moves the clock on. */
function recordingThatGrowsAt(times: number[]) {
  let clock = 0;
  return {
    size: () => times.filter((time) => time <= clock).length,
    now: () => clock,
    wait: async (ms: number) => {
      clock += ms;
    },
  };
}

test('a screen that is not changing is still after the shortest watch', async () => {
  expect(await watchPixels(recordingThatGrowsAt([]))).toEqual({
    movedForMs: 0,
    stillMoving: false,
  });
});

test('a screen that animates is still once the recording stops growing', async () => {
  const fade = [48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208];

  expect(await watchPixels(recordingThatGrowsAt(fade))).toEqual({
    movedForMs: 208,
    stillMoving: false,
  });
});

test('a screen that never stops is given up on, and the result says so', async () => {
  const spinner = Array.from({ length: 200 }, (_, index) => index * 16);

  expect(await watchPixels(recordingThatGrowsAt(spinner))).toEqual({
    movedForMs: 904,
    stillMoving: true,
  });
});
