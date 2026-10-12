/**
 * An iPhone simulator, as far as a story needs one: start the test build fresh
 * with its runner's address, touch the glass and watch the screen. Touches and
 * frames go through the simulator's own input and display, by the same native
 * addon the earlier driver used.
 */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolveServeSimNativeAddon } from '../drivers/simulator-session';
import { writeRunnerNote } from '../link/appLink';
import { keepScreenWatcher, type ScreenFrames } from './screenWatcher';
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
      // A story whose runner died leaves its recorder behind, still attached to this screen.
      spawnSync('pkill', ['-f', `simctl io ${udid} recordVideo`]);
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

function watchScreenFrames(udid: string, addon: string, onChange: () => void): ScreenFrames {
  const script = fileURLToPath(new URL('./screenFrames.ts', import.meta.url));
  return keepScreenWatcher({
    onChange,
    launch: () => {
      const child = spawn(process.execPath, [script, udid, addon], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      child.stdin.on('error', () => undefined);
      return {
        onLine: (listener) => void createInterface({ input: child.stdout }).on('line', listener),
        onExit: (listener) => void child.once('exit', listener),
        write: (line) => void child.stdin.write(line),
        kill: () => void child.kill('SIGKILL'),
        end: () => child.stdin.end(),
      };
    },
  });
}
