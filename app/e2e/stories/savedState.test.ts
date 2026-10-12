import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { emptyAppFolders, hasState, restoreState, saveState, type StatePlaces } from './savedState';

let root: string;
let places: StatePlaces;
const write = (path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const read = (path: string) =>
  existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sovran-e2e-state-'));
  places = {
    appData: join(root, 'app'),
    keychains: join(root, 'keychains'),
    store: join(root, 'states'),
  };
  // A wallet that has finished onboarding, with its seed in the keychain.
  write('app/Documents/SQLite/wallet.db', 'onboarded wallet');
  write('app/Library/Preferences/settings.plist', 'terms accepted');
  write('app/tmp/scratch', 'x');
  write('app/.com.apple.mobile_container_manager.metadata.plist', 'container record');
  write('keychains/keychain-2-debug.db', 'seed one');
  write('keychains/keychain-2-debug.db-wal', 'seed one journal');
  write('keychains/Analytics/keep', 'not the keychain');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('a saved state of the app', () => {
  test('brings back the wallet and its seed after both were replaced', () => {
    saveState(places, 'onboarded', 'v1');

    // Another story ran: a fresh wallet with another seed.
    emptyAppFolders(places.appData);
    write('app/Documents/SQLite/wallet.db', 'someone else');
    write('app/Documents/left-by-the-other-story', 'x');
    write('keychains/keychain-2-debug.db', 'seed two');
    write('keychains/keychain-2-debug.db-shm', 'seed two index');
    restoreState(places, 'onboarded');

    expect(read('app/Documents/SQLite/wallet.db')).toBe('onboarded wallet');
    expect(read('app/Library/Preferences/settings.plist')).toBe('terms accepted');
    expect(read('app/Documents/left-by-the-other-story')).toBeNull();
    expect(read('keychains/keychain-2-debug.db')).toBe('seed one');
    expect(read('keychains/keychain-2-debug.db-wal')).toBe('seed one journal');
    // A journal file the saved keychain did not have would be replayed over it.
    expect(read('keychains/keychain-2-debug.db-shm')).toBeNull();
  });

  test("leaves alone what is not the app's or the keychain's", () => {
    saveState(places, 'onboarded', 'v1');
    emptyAppFolders(places.appData);
    restoreState(places, 'onboarded');

    expect(read('app/.com.apple.mobile_container_manager.metadata.plist')).toBe('container record');
    expect(read('keychains/Analytics/keep')).toBe('not the keychain');
  });

  test("does not carry the last runner's address or the log of how the state was reached", () => {
    write('app/Documents/e2e/runner.json', '{"url":"ws://127.0.0.1:1"}');
    write('app/Documents/sovran-logs/log.txt', 'old entries');
    saveState(places, 'onboarded', 'v1');
    emptyAppFolders(places.appData);
    restoreState(places, 'onboarded');

    expect(read('app/Documents/e2e/runner.json')).toBeNull();
    expect(read('app/Documents/sovran-logs/log.txt')).toBeNull();
  });

  test('is only used when it was made the same way', () => {
    saveState(places, 'onboarded', 'v1');

    expect(hasState(places, 'onboarded', 'v1')).toBe(true);
    expect(hasState(places, 'onboarded', 'v2')).toBe(false);
    expect(hasState(places, 'funded', 'v1')).toBe(false);
  });

  test('refuses to restore a state that is not there, leaving the app as it was', () => {
    expect(() => restoreState(places, 'funded')).toThrow(/No saved state "funded"/);
    expect(read('app/Documents/SQLite/wallet.db')).toBe('onboarded wallet');
  });
});
