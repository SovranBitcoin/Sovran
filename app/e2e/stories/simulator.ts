/**
 * An iPhone simulator, as far as a story needs one: start the test build fresh
 * with its runner's address, touch the glass and watch the screen. Touches and
 * frames go through the simulator's own input and display, by the same native
 * addon the earlier driver used.
 */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolveServeSimNativeAddon } from '../drivers/simulator-session';
import { writeRunnerNote } from '../link/appLink';
import { simctl } from './simctl';
import type { TouchDevice } from './play';

const BUNDLE_ID = 'com.sovranbitcoin.dev';
/** Where an app keeps what it saves. The container's own records beside them are left alone. */
const APP_FOLDERS = ['Documents', 'Library', 'tmp'];
/** How long a finger rests for a tap. Shorter than a long press, longer than a frame. */
const TAP_HOLD_MS = 40;

interface Native {
  SimHID: new (udid: string) => {
    touch(type: string, x: number, y: number, width: number, height: number, edge: number): void;
  };
}

/** What is asked of the process that watches the screen. */
interface ScreenFrames {
  /** Save what is on screen now as a JPEG; false when there was no frame to save. */
  picture(file: string): Promise<boolean>;
  /** How many times the watching process died and was started again. */
  restarts(): number;
  stop(): void;
}

interface StorySimulator extends TouchDevice {
  /**
   * Leave the app as if it had never been opened: its files, its settings and
   * the keychain, which outlives an uninstall. Installs the build only when the
   * simulator does not have it, since installing takes six seconds.
   */
  startFresh(appPath: string): void;
  /** Start the app, telling it where its runner listens. */
  launch(runner: { url: string; run: string }): void;
  terminate(): void;
  /** Watch the screen, calling back each time the picture on it changes. */
  watchScreen(onChange: () => void): ScreenFrames;
}

export function storySimulator(udid: string): StorySimulator {
  const addon = resolveServeSimNativeAddon();
  const native = createRequire(import.meta.url)(addon) as Native;
  const hid = new native.SimHID(udid);
  return {
    startFresh(appPath) {
      simctl('bootstatus', udid, '-b');
      this.terminate();
      let data: string;
      try {
        data = simctl('get_app_container', udid, BUNDLE_ID, 'data');
      } catch {
        simctl('install', udid, appPath);
        simctl('keychain', udid, 'reset');
        return;
      }
      for (const folder of APP_FOLDERS) {
        for (const entry of readdirSync(join(data, folder))) {
          rmSync(join(data, folder, entry), { recursive: true, force: true });
        }
      }
      try {
        // Settings are held by a system service, not only by the file just removed.
        simctl('spawn', udid, 'defaults', 'delete', BUNDLE_ID);
      } catch {
        // Nothing saved yet.
      }
      simctl('keychain', udid, 'reset');
    },
    launch(runner) {
      writeRunnerNote(simctl('get_app_container', udid, BUNDLE_ID, 'data'), runner);
      simctl('launch', udid, BUNDLE_ID);
    },
    terminate() {
      try {
        simctl('terminate', udid, BUNDLE_ID);
      } catch {
        // Not running.
      }
    },
    watchScreen(onChange) {
      return watchScreenFrames(udid, addon, onChange);
    },
    async tap(x, y) {
      // The addon scales by the size it is given; fractions in, so a unit square.
      hid.touch('begin', x, y, 1, 1, 0);
      await new Promise((resolve) => setTimeout(resolve, TAP_HOLD_MS));
      hid.touch('end', x, y, 1, 1, 0);
    },
  };
}

/** How long a picture may take: the watcher answers in milliseconds unless it has just been restarted. */
const PICTURE_WITHIN_MS = 1500;

function watchScreenFrames(udid: string, addon: string, onChange: () => void): ScreenFrames {
  const script = fileURLToPath(new URL('./screenFrames.ts', import.meta.url));
  const launch = () =>
    spawn(process.execPath, [script, udid, addon], { stdio: ['pipe', 'pipe', 'ignore'] });
  let stopped = false;
  let restarts = 0;
  let child: ReturnType<typeof launch>;
  /** Pictures asked for and not yet answered, oldest first. */
  let waiting: ((saved: boolean) => void)[] = [];
  const start = () => {
    child = launch();
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line === 'c') onChange();
      else waiting.shift()?.(line === 'w');
    });
    child.stdin.on('error', () => undefined);
    child.once('exit', () => {
      if (stopped) return;
      // It died mid-story. Whatever it was asked is lost, and the screen may have moved unseen.
      for (const answer of waiting) answer(false);
      waiting = [];
      onChange();
      restarts += 1;
      start();
    });
  };
  start();
  const ask = (file: string) =>
    new Promise<boolean>((resolve) => {
      waiting.push(resolve);
      child.stdin.write(`${file}\n`);
    });
  return {
    async picture(file) {
      const deadline = performance.now() + PICTURE_WITHIN_MS;
      // A watcher that has just started has no frame for a few hundred milliseconds.
      while (performance.now() < deadline) {
        if (await ask(file)) return true;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return false;
    },
    restarts: () => restarts,
    stop() {
      stopped = true;
      child.stdin.end();
    },
  };
}
