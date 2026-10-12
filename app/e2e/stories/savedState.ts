/**
 * A saved state of the app on one simulator (ADR 0033): everything the app
 * wrote, and the simulator's keychain, which holds the wallet's seed. A story
 * starts from a named state by having it copied back, in a fraction of a
 * second, instead of tapping its way there.
 *
 * Both halves are needed. The app's files alone would be a wallet whose seed
 * the keychain no longer has; measured on a simulator, restoring the keychain
 * files brought back the same identity, where resetting it made a new one.
 *
 * The states are kept inside the simulator's own folder, so a clone of the
 * simulator carries them.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** Where an app keeps what it saves. The container's own records beside them are left alone. */
const APP_FOLDERS = ['Documents', 'Library', 'tmp'];
/** The keychain's database and its journal files. */
const KEYCHAIN_FILE = /^keychain-.*\.db(-wal|-shm)?$/;
/** Left out of a saved state: the last runner's address, and the log of how the state was reached. */
const NOT_SAVED = ['Documents/e2e', 'Documents/sovran-logs'];
const MADE_FROM = 'made-from';

export interface StatePlaces {
  /** The app's data container. */
  appData: string;
  /** The simulator's `Library/Keychains`. */
  keychains: string;
  /** Where this simulator's saved states are kept. */
  store: string;
}

function emptyFolder(folder: string): void {
  if (!existsSync(folder)) return;
  for (const entry of readdirSync(folder))
    rmSync(join(folder, entry), { recursive: true, force: true });
}

/** Remove everything the app has written. */
export function emptyAppFolders(appData: string): void {
  for (const folder of APP_FOLDERS) emptyFolder(join(appData, folder));
}

/**
 * Whether a state is saved here and was made the same way: `madeFrom`
 * identifies the story that builds it and every state before it, so a state
 * built by an older story is not mistaken for this one.
 */
export function hasState(places: StatePlaces, name: string, madeFrom: string): boolean {
  const record = join(places.store, name, MADE_FROM);
  return existsSync(record) && readFileSync(record, 'utf8') === madeFrom;
}

/** Save what the app and the keychain hold now. Both must be stopped: a file half-written is a broken state. */
export function saveState(places: StatePlaces, name: string, madeFrom: string): void {
  const saved = join(places.store, name);
  rmSync(saved, { recursive: true, force: true });
  for (const folder of APP_FOLDERS) {
    const from = join(places.appData, folder);
    if (existsSync(from)) cpSync(from, join(saved, 'app', folder), { recursive: true });
    else mkdirSync(join(saved, 'app', folder), { recursive: true });
  }
  for (const left of NOT_SAVED) rmSync(join(saved, 'app', left), { recursive: true, force: true });
  mkdirSync(join(saved, 'keychain'), { recursive: true });
  for (const file of readdirSync(places.keychains)) {
    if (KEYCHAIN_FILE.test(file))
      cpSync(join(places.keychains, file), join(saved, 'keychain', file));
  }
  // Written last: a state without it was interrupted and is not used.
  writeFileSync(join(saved, MADE_FROM), madeFrom);
}

/** Put a saved state back in place of whatever the app and the keychain hold. Both must be stopped. */
export function restoreState(places: StatePlaces, name: string): void {
  const saved = join(places.store, name);
  if (!existsSync(join(saved, MADE_FROM))) throw new Error(`No saved state "${name}" here.`);
  emptyAppFolders(places.appData);
  for (const folder of APP_FOLDERS)
    cpSync(join(saved, 'app', folder), join(places.appData, folder), { recursive: true });
  for (const file of readdirSync(places.keychains)) {
    if (KEYCHAIN_FILE.test(file)) rmSync(join(places.keychains, file), { force: true });
  }
  for (const file of readdirSync(join(saved, 'keychain')))
    cpSync(join(saved, 'keychain', file), join(places.keychains, file));
}
