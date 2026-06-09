/**
 * Central configuration for the iOS Freedom Store release tool.
 *
 * All paths, identifiers, and repo coordinates live here so the rest of the
 * tooling has no scattered constants. Paths are resolved relative to this file
 * (scripts/ → sovran-app → workspace root), matching the sibling-repo layout:
 *
 *   <workspace>/sovran-app      (this repo — the tool lives here)
 *   <workspace>/sovran.money    (hosts release binaries + screenshots)
 *   <workspace>/freedomstore    (fork of the AltStore source repo)
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** sovran-app root (one level up from scripts/). */
export const APP_DIR = path.resolve(__dirname, '..');
/** Workspace root that holds all sibling repos. */
export const WORKSPACE_DIR = path.resolve(APP_DIR, '..');

export const SOVRAN_MONEY_DIR = path.join(WORKSPACE_DIR, 'sovran.money');
export const FREEDOMSTORE_DIR = path.join(WORKSPACE_DIR, 'freedomstore');

/** Where release packages and screenshots are served from. */
export const IOS_PUBLIC_DIR = path.join(SOVRAN_MONEY_DIR, 'public', 'ios');
export const RELEASES_DIR = path.join(IOS_PUBLIC_DIR, 'releases');
export const SCREENSHOTS_TS_PATH = path.join(SOVRAN_MONEY_DIR, 'src', 'screenshots.ts');
export const ALTSTORE_SOURCE_PATH = path.join(FREEDOMSTORE_DIR, 'altstore-source.json');

/** Public base URL the listing points at (no trailing slash). */
export const SOVRAN_MONEY_BASE = 'https://sovran.money';

/** App identity. */
export const BUNDLE_ID = 'com.sovranbitcoin';
export const APP_ID = '6499554529'; // App Store / marketplace ID
export const DEVELOPER_NAME = 'Sovran';

/** APIs. */
export const ALTSTORE_API_BASE = 'https://api.altstore.io/adps';
export const ASC_API_BASE = 'https://api.appstoreconnect.apple.com/v1';
export const PREFERRED_LOCALES = ['en-US', 'en-GB'];

/** Device screenshot sets we publish, in display-preference order. The first
 *  one present on disk becomes the "primary" device used for the listing and
 *  the composite preview. */
export const DEVICE_PREFERENCE = [
  'APP_IPHONE_67',
  'APP_IPHONE_65',
  'APP_IPHONE_61',
  'APP_IPHONE_58',
  'APP_IPHONE_55',
];

export const DEVICE_NAMES = {
  APP_IPHONE_67: 'iPhone 6.7"',
  APP_IPHONE_65: 'iPhone 6.5"',
  APP_IPHONE_61: 'iPhone 6.1"',
  APP_IPHONE_58: 'iPhone 5.8"',
  APP_IPHONE_55: 'iPhone 5.5"',
};

/** Git / GitHub coordinates. */
export const UPSTREAM_REMOTE = 'upstream';
export const ORIGIN_REMOTE = 'origin';
export const BASE_BRANCH = 'main';
/** PR target — the real Freedom Store repo, not our fork. */
export const PR_TARGET_REPO = 'freedomstore/freedomstore';

/** Deploy gate. */
export const DEPLOY_POLL_INTERVAL_MS = 15_000;
export const DEPLOY_TIMEOUT_MS = 15 * 60_000;
export const HTTP_USER_AGENT = 'freedomstore-url-checker';

/** AltStore listing constants for the Sovran app entry. */
export const APP_DEFAULTS = {
  name: 'Sovran',
  category: 'social',
  tintColor: '#c53163',
  beta: true,
  iconURL: `${SOVRAN_MONEY_BASE}/ios/logo.png`,
};
