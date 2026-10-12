/**
 * Keeps the process that watches a simulator's screen (`screenFrames.ts`)
 * running for the length of a story, and speaks its line protocol.
 *
 * That process can die at any moment (the capture inside the native addon
 * faults about once in fifteen stories). The story must neither end with it
 * nor be misled by it: while no watcher has a frame, the screen is reported
 * as changing, so a step is never called still on the strength of not looking.
 */

/** The watching process, as far as its keeper needs it. */
export interface WatcherProcess {
  onLine(listener: (line: string) => void): void;
  onExit(listener: () => void): void;
  write(line: string): void;
  kill(): void;
  /** Ask it to finish: its input is closed and it exits by itself. */
  end(): void;
}

export interface ScreenFrames {
  /** Save what is on screen now as a JPEG; false when there was no frame to save. */
  picture(file: string): Promise<boolean>;
  /** How many times the watching process died and was started again. */
  restarts(): number;
  /** Why the screen can no longer be watched, once the watcher has been given up on. */
  failure(): string | undefined;
  stop(): void;
}

/** A watcher that keeps dying is not started a sixth time; the story fails instead. */
const MAX_RESTARTS = 5;

export function keepScreenWatcher(io: {
  launch: () => WatcherProcess;
  /** The picture on screen changed, or may have while nothing was looking. */
  onChange: () => void;
  /** How often to report possible change while no watcher has a frame. */
  blindEveryMs?: number;
  /** A watcher that does not answer a request for this long is killed and replaced. */
  answerWithinMs?: number;
  /** How long a picture is tried for, across restarts. */
  pictureWithinMs?: number;
}): ScreenFrames {
  const blindEveryMs = io.blindEveryMs ?? 50;
  const answerWithinMs = io.answerWithinMs ?? 500;
  const pictureWithinMs = io.pictureWithinMs ?? 1500;
  let stopped = false;
  let restarts = 0;
  let failure: string | undefined;
  let child: WatcherProcess | undefined;
  /** Pictures asked for and not yet answered, oldest first. */
  let waiting: ((saved: boolean) => void)[] = [];
  let blind: ReturnType<typeof setInterval> | undefined;

  const see = () => {
    clearInterval(blind);
    blind = undefined;
  };
  const start = () => {
    const started = io.launch();
    child = started;
    // Until this watcher has its first frame, anything may be happening on screen.
    blind ??= setInterval(io.onChange, blindEveryMs);
    started.onLine((line) => {
      if (line === 'c') {
        see();
        io.onChange();
      } else waiting.shift()?.(line === 'w');
    });
    started.onExit(() => {
      if (child !== started) return;
      child = undefined;
      for (const answer of waiting) answer(false);
      waiting = [];
      if (stopped) return;
      io.onChange();
      if (restarts >= MAX_RESTARTS) {
        see();
        failure = `The screen could not be watched: the watcher died ${restarts + 1} times.`;
        return;
      }
      restarts += 1;
      start();
    });
  };
  start();

  const ask = (file: string) =>
    new Promise<boolean>((resolve) => {
      const asked = child;
      if (!asked) return resolve(false);
      const silent = setTimeout(() => asked.kill(), answerWithinMs);
      waiting.push((saved) => {
        clearTimeout(silent);
        resolve(saved);
      });
      asked.write(`${file}\n`);
    });

  return {
    async picture(file) {
      const deadline = performance.now() + pictureWithinMs;
      // A watcher that has just started has no frame for a few hundred milliseconds.
      while (!failure && !stopped && performance.now() < deadline) {
        if (await ask(file)) return true;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return false;
    },
    restarts: () => restarts,
    failure: () => failure,
    stop() {
      stopped = true;
      see();
      child?.end();
    },
  };
}
