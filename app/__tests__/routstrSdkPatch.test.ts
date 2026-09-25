/**
 * @jest-environment node
 */

/**
 * app/patches/README.md: a successful install is not proof the patch landed.
 *
 * `isTorContext` guards on `typeof window === "undefined"` — true in a browser,
 * true in Node, and wrong in React Native, where `window` IS defined (it is
 * `globalThis`) but carries no `location`. The next line then threw
 * `TypeError: Cannot read property 'hostname' of undefined` inside
 * `findNextBestProvider`, whose `catch` returns null — so the SDK reported "no
 * next provider" and gave up.
 *
 * The user-visible effect was total: one node answering 404 for a model it does
 * not serve ended the whole request, with eleven other candidates untried, and
 * the app could only say `no_providers`. A dropped patch puts that back, so it
 * has to fail here rather than on a device.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** Every build that carries the check; the workspace may hoist the package. */
const ENTRIES = ['browser.js', 'browser.mjs', 'index.js', 'index.mjs'];
const ROOTS = [
  resolve(__dirname, '..', 'node_modules', '@routstr', 'sdk', 'dist'),
  resolve(__dirname, '..', '..', 'node_modules', '@routstr', 'sdk', 'dist'),
];
const distRoot = ROOTS.find((root) => existsSync(root));

function read(entry: string): string {
  const path = resolve(distRoot ?? '', entry);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('@routstr/sdk patch — provider failover under React Native', () => {
  it('found the installed package to check', () => {
    expect(distRoot).toBeTruthy();
  });

  // The app imports `@routstr/sdk/browser`; Metro may resolve either spelling,
  // and the other entries share the file, so all of them are checked.
  it.each(ENTRIES)('%s no longer reads hostname off a missing location', (entry) => {
    const bundle = read(entry);
    expect(bundle).not.toBe('');
    expect(bundle).not.toContain('window.location.hostname.toLowerCase()');
    expect(bundle).toContain('window.location?.hostname?.toLowerCase()');
  });

  it('treats an absent location as "not Tor" rather than falling through', () => {
    // Without this line the optional chain yields undefined and the next call,
    // `.endsWith`, throws for the same reason the original did.
    expect(read('browser.mjs')).toMatch(/if \(!hostname\) return false;/);
  });
});
