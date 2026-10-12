/**
 * An iPhone simulator, as far as a story needs one: install and start the test
 * build with its runner's address, and touch the glass. Touches go through the
 * simulator's own input, the same native addon the earlier driver used.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolveServeSimNativeAddon } from '../drivers/simulator-session';
import { writeRunnerNote } from '../link/appLink';
import type { TouchDevice } from './play';

const BUNDLE_ID = 'com.sovranbitcoin.dev';
/** How long a finger rests for a tap. Shorter than a long press, longer than a frame. */
const TAP_HOLD_MS = 40;

interface NativeTouch {
  SimHID: new (udid: string) => {
    touch(type: string, x: number, y: number, width: number, height: number, edge: number): void;
  };
}

const simctl = (...args: string[]) =>
  execFileSync('xcrun', ['simctl', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

export interface StorySimulator extends TouchDevice {
  /** Boot the simulator if it is not running, and put this build on it fresh. */
  installFresh(appPath: string): void;
  /** Start the app, telling it where its runner listens. */
  launch(runner: { url: string; run: string }): void;
  terminate(): void;
}

export function storySimulator(udid: string): StorySimulator {
  const native = createRequire(import.meta.url)(resolveServeSimNativeAddon()) as NativeTouch;
  const hid = new native.SimHID(udid);
  return {
    installFresh(appPath) {
      simctl('bootstatus', udid, '-b');
      try {
        simctl('uninstall', udid, BUNDLE_ID);
      } catch {
        // Not installed yet.
      }
      simctl('install', udid, appPath);
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
    async tap(x, y) {
      // The addon scales by the size it is given; fractions in, so a unit square.
      hid.touch('begin', x, y, 1, 1, 0);
      await new Promise((resolve) => setTimeout(resolve, TAP_HOLD_MS));
      hid.touch('end', x, y, 1, 1, 0);
    },
  };
}
