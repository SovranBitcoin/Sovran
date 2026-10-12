/**
 * An iPhone simulator, as far as a story needs one: start the test build fresh
 * with its runner's address, touch the glass and watch the screen. Touches and
 * frames go through the simulator's own input and display, by the same native
 * addon the earlier driver used.
 */
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolveServeSimNativeAddon } from '../drivers/simulator-session';
import { writeRunnerNote } from '../link/appLink';
import { emptyAppFolders, hasState, restoreState, saveState, type StatePlaces } from './savedState';
import { keepScreenWatcher, type ScreenFrames } from './screenWatcher';
import { simctl } from './simctl';
import type { TouchDevice } from './play';

const BUNDLE_ID = 'com.sovranbitcoin.dev';
/** The state of an app that has never been opened. */
export const FRESH = 'fresh';
/** Saved states live inside the simulator's own folder, so a clone carries them. */
const STATES_FOLDER = 'sovran-e2e-states';
const KEYCHAIN_SERVICE = 'com.apple.securityd';
const SETTINGS_SERVICE = 'com.apple.cfprefsd.xpc.daemon';
/** A swipe takes a quarter of a second: quick enough to be a swipe, slow enough to be followed. */
const SWIPE_FRAMES = 15;
const FRAME_MS = 16;
/** How long a finger rests for a tap. Shorter than a long press, longer than a frame. */
const TAP_HOLD_MS = 40;

interface Native {
  SimHID: new (udid: string) => {
    touch(type: string, x: number, y: number, width: number, height: number, edge: number): void;
  };
}

interface StorySimulator extends TouchDevice {
  /**
   * Stop the app and put it in the state a story starts from. `fresh` is as if
   * it had never been opened: its files, its settings and the keychain, which
   * outlives an uninstall. Any other name is a state saved here earlier.
   * Installs the build only when the simulator does not have it, since
   * installing takes six seconds.
   */
  startFrom(appPath: string, state: string): Promise<void>;
  /** Whether a state of this name, made this way, is saved on this simulator. */
  hasState(name: string, madeFrom: string): boolean;
  /** Stop the app and save the state it is in under a name. */
  saveState(name: string, madeFrom: string): Promise<void>;
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
  /** Run a program inside the simulator; false when it fails. */
  const inSimulator = (...command: string[]) => {
    try {
      simctl('spawn', udid, ...command);
      return true;
    } catch {
      return false;
    }
  };
  const places = (): StatePlaces => {
    const appData = simctl('get_app_container', udid, BUNDLE_ID, 'data');
    const deviceData = appData.slice(0, appData.indexOf('/Containers/'));
    return {
      appData,
      keychains: join(deviceData, 'Library/Keychains'),
      store: join(deviceData, STATES_FOLDER),
    };
  };
  /**
   * Stop one of the simulator's services and wait until that process has
   * gone. It is started again the next time something asks for it, which for
   * a busy service is at once, and reads its files then.
   */
  const stopService = async (label: string) => {
    const service = `user/${process.getuid?.() ?? 501}/${label}`;
    const running = () => {
      try {
        return /\bpid = (\d+)/.exec(simctl('spawn', udid, 'launchctl', 'print', service))?.[1];
      } catch {
        // Not known to the simulator at all.
        return undefined;
      }
    };
    const stopping = running();
    if (stopping === undefined) return;
    inSimulator('launchctl', 'kill', 'SIGTERM', service);
    for (let checks = 0; checks < 20; checks++) {
      if (running() !== stopping) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`The simulator's ${label} did not stop.`);
  };
  return {
    async startFrom(appPath, state) {
      simctl('bootstatus', udid, '-b');
      this.terminate();
      // A story whose runner died leaves its recorder behind, still attached to this screen.
      spawnSync('pkill', ['-f', `simctl io ${udid} recordVideo`]);
      let installed = true;
      try {
        simctl('get_app_container', udid, BUNDLE_ID, 'data');
      } catch {
        installed = false;
        simctl('install', udid, appPath);
      }
      if (state === FRESH) {
        if (installed) emptyAppFolders(places().appData);
        // Settings are held by a system service, not only by the files just removed.
        inSimulator('defaults', 'delete', BUNDLE_ID);
        simctl('keychain', udid, 'reset');
        return;
      }
      await stopService(KEYCHAIN_SERVICE);
      restoreState(places(), state);
      // The settings service would go on answering with what the last story saved.
      await stopService(SETTINGS_SERVICE);
    },
    hasState: (name, madeFrom) => hasState(places(), name, madeFrom),
    async saveState(name, madeFrom) {
      this.terminate();
      // Both write through to their files as they stop.
      await stopService(SETTINGS_SERVICE);
      await stopService(KEYCHAIN_SERVICE);
      saveState(places(), name, madeFrom);
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
    async swipe(from, to) {
      // A finger moving at a steady pace, a point every frame, then lifted where it stopped.
      hid.touch('begin', from[0], from[1], 1, 1, 0);
      for (let frame = 1; frame <= SWIPE_FRAMES; frame++) {
        await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
        const along = frame / SWIPE_FRAMES;
        hid.touch(
          'move',
          from[0] + (to[0] - from[0]) * along,
          from[1] + (to[1] - from[1]) * along,
          1,
          1,
          0
        );
      }
      hid.touch('end', to[0], to[1], 1, 1, 0);
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
