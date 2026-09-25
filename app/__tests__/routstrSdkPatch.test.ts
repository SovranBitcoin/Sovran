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
 *
 * The second hunk is the same fault in a different disguise.
 * `isNetworkErrorMessage` is the SDK's only test for "the request never
 * reached the node", and it enumerates the Chrome, Firefox, Safari and Bun
 * spellings — none of which React Native ever produces. RN says
 * `Network request failed`; Expo's fetch says `The network connection was
 * lost`. With neither recognised, `_makeRequest`'s catch rethrows instead of
 * calling `_handleErrorResponse`, so the `X-Cashu` change is never reclaimed,
 * the original token is never received back, no provider is marked failed, and
 * the sats attached to that request are stranded until a later sweep. The app
 * sees a bare `status: 0` and blames the provider for its own dropped packet.
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

  // `wallet/index.*` carry `isNetworkErrorMessage` without `isTorContext`, so
  // this hunk covers two more entries than the one above.
  const NETWORK_ENTRIES = [
    ...ENTRIES,
    'client/index.js',
    'client/index.mjs',
    'wallet/index.js',
    'wallet/index.mjs',
  ];

  it.each(NETWORK_ENTRIES)('%s recognises React Native network failures', (entry) => {
    const bundle = read(entry);
    expect(bundle).not.toBe('');
    // The two spellings seen in this app's own logs: RN's XHR-backed fetch and
    // Expo's native fetch relaying NSURLErrorNetworkConnectionLost.
    expect(bundle).toContain('message.includes("Network request failed")');
    expect(bundle).toContain('message.includes("The network connection was lost")');
  });

  it('keeps the browser and Bun spellings it already knew', () => {
    const bundle = read('browser.mjs');
    expect(bundle).toContain('message.includes("Failed to fetch")');
    expect(bundle).toContain('message.includes("Load failed")');
    expect(bundle).toContain('message.includes("Unable to connect")');
  });
});
