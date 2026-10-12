import { describe, expect, test } from 'bun:test';
import { keepScreenWatcher, type WatcherProcess } from './screenWatcher';

const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A watching process the test drives by hand. */
function fakeWatcher() {
  let line: (text: string) => void = () => {};
  let exit: () => void = () => {};
  const asked: string[] = [];
  const process: WatcherProcess = {
    onLine: (listener) => (line = listener),
    onExit: (listener) => (exit = listener),
    write: (text) => asked.push(text.trim()),
    kill: () => exit(),
    end: () => exit(),
  };
  return { process, asked, says: (text: string) => line(text), dies: () => exit() };
}

/** A keeper whose every launch hands out the next fake, and counts reported changes. */
function keeper(options: { answerWithinMs?: number; pictureWithinMs?: number } = {}) {
  const launched: ReturnType<typeof fakeWatcher>[] = [];
  let changes = 0;
  const frames = keepScreenWatcher({
    launch: () => {
      const watcher = fakeWatcher();
      launched.push(watcher);
      return watcher.process;
    },
    onChange: () => (changes += 1),
    blindEveryMs: 5,
    ...options,
  });
  return { frames, launched, changes: () => changes };
}

describe('keeping the screen watched through a story', () => {
  test('a frame that differs is passed on as the screen changing', () => {
    const { frames, launched, changes } = keeper();
    launched[0].says('c');
    const before = changes();

    launched[0].says('c');

    expect(changes()).toBe(before + 1);
    frames.stop();
  });

  test('a picture is saved by the watcher and reported once it says so', async () => {
    const { frames, launched } = keeper();
    launched[0].says('c');

    const saved = frames.picture('/out/01-step.jpg');
    await after(1);
    expect(launched[0].asked).toEqual(['/out/01-step.jpg']);
    launched[0].says('w');

    expect(await saved).toBe(true);
    frames.stop();
  });

  test('a watcher that dies is replaced, and the picture comes from the new one', async () => {
    const { frames, launched } = keeper();
    launched[0].says('c');

    const saved = frames.picture('/out/02-step.jpg');
    await after(1);
    launched[0].dies();
    await after(40);
    launched[1].says('c');
    await after(40);
    launched[1].says('w');

    expect(await saved).toBe(true);
    expect(frames.restarts()).toBe(1);
    frames.stop();
  });

  test('while no watcher has a frame, the screen is reported as changing', async () => {
    const { frames, launched, changes } = keeper();
    launched[0].says('c');
    launched[0].dies();
    const atDeath = changes();

    await after(40);
    const whileBlind = changes();
    launched[1].says('c');
    const atFirstFrame = changes();
    await after(40);

    expect(whileBlind).toBeGreaterThan(atDeath + 2);
    // Seeing again: only real changes are reported from here.
    expect(changes()).toBe(atFirstFrame);
    frames.stop();
  });

  test('a watcher that stops answering is killed and replaced', async () => {
    const { frames, launched } = keeper({ answerWithinMs: 10, pictureWithinMs: 400 });
    launched[0].says('c');

    const saved = frames.picture('/out/03-step.jpg');
    // The first watcher never answers. Its replacement does, as soon as it is asked.
    while (launched.length < 2) await after(2);
    const replacement = launched[1];
    replacement.says('c');
    while (replacement.asked.length === 0) await after(2);
    replacement.says('w');

    expect(await saved).toBe(true);
    expect(frames.restarts()).toBe(1);
    frames.stop();
  });

  test('a watcher that keeps dying is given up on, and says why', async () => {
    const { frames, launched, changes } = keeper();

    for (let death = 0; death < 6; death++) launched.at(-1)?.dies();

    expect(launched.length).toBe(6);
    expect(frames.failure()).toMatch(/could not be watched/);
    expect(await frames.picture('/out/04-step.jpg')).toBe(false);
    // Nothing is watching and nothing pretends to: no more reports.
    const settled = changes();
    await after(30);
    expect(changes()).toBe(settled);
    frames.stop();
  });

  test('stopping ends the watcher and starts no other', async () => {
    const { frames, launched, changes } = keeper();

    frames.stop();
    const settled = changes();
    await after(30);

    expect(launched.length).toBe(1);
    expect(changes()).toBe(settled);
  });
});
