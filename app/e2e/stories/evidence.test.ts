import { expect, test } from 'bun:test';
import { createScreenWatch, pictureName } from './evidence';

test("a step's picture is named by its place in the story and what it does", () => {
  expect(pictureName(1, 'agree to the Terms')).toBe('02-agree-to-the-terms');
});

/** A screen whose picture changes at the given times. */
function screenThatChangesAt(times: number[]) {
  let clock = 0;
  let told = 0;
  const watch = createScreenWatch({
    now: () => clock,
    wait: async (ms: number) => {
      clock += ms;
      for (; told < times.length && times[told] <= clock; told++) watch.changed();
    },
  });
  return { watch };
}

test('a screen that is not changing is still after the shortest watch', async () => {
  expect(await screenThatChangesAt([]).watch.pixelsStill()).toEqual({
    movedForMs: 0,
    stillMoving: false,
  });
});

test('a screen that animates is still once its picture stops changing', async () => {
  const fade = [48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208];

  expect(await screenThatChangesAt(fade).watch.pixelsStill()).toEqual({
    movedForMs: 208,
    stillMoving: false,
  });
});

test('a screen that never stops is given up on, and the result says so', async () => {
  const spinner = Array.from({ length: 200 }, (_, index) => index * 16);

  expect(await screenThatChangesAt(spinner).watch.pixelsStill()).toEqual({
    movedForMs: 904,
    stillMoving: true,
  });
});

test('a change from before the watch began is not counted as the step moving the screen', async () => {
  const { watch } = screenThatChangesAt([]);
  watch.changed();

  expect((await watch.pixelsStill()).movedForMs).toBe(0);
});
