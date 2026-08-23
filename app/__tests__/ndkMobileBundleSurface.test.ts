/**
 * @jest-environment node
 *
 * Guards the `@nostr-dev-kit/ndk-wallet` Metro stub.
 *
 * `@nostr-dev-kit/ndk-mobile`'s entry re-exports its hooks barrel, whose
 * `hooks/session.js` statically imports `walletFromLoadingString` from
 * `@nostr-dev-kit/ndk-wallet`. A static import inside a barrel is
 * unconditional, so all 32 app files importing `ndk-mobile` dragged in NDK's
 * whole Cashu/NWC wallet — and its `@cashu/crypto` peer, which carries
 * `@noble/hashes@1` and `@scure/bip39@1` beside our exactly-pinned `2.3.0`.
 * Sovran's wallet is coco + cashu-ts + colada. `metro.config.js` resolves the
 * package to `{ type: 'empty' }`, worth ~141 KB of iOS Hermes bytecode.
 *
 * That stub is only safe while nothing reaches the hooks it feeds. This test is
 * the tripwire: if a future caller wants `useNDKSession` / `useNDKWallet`, it
 * fails here with the reason, rather than at runtime with an unhelpful
 * "walletFromLoadingString is not a function".
 */
import fs from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(__dirname, '..');

/** Hook exports of `ndk-mobile`'s `hooks/session.js` and `hooks/wallet.js`. */
const STUB_DEPENDENT_EXPORTS = [
  'useNDKSession',
  'useNDKWallet',
  'useFollows',
  'useMuteList',
  'useWOT',
  'useSessionEvents',
  'useNDKSessionEvents',
  'useNDKSessionEventKind',
] as const;

const SOURCE_DIRS = ['app', 'features', 'shared', 'navigation', 'config', 'stores', 'hooks'];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  for (const dir of SOURCE_DIRS) walk(path.join(APP_ROOT, dir));
  return out;
}

describe('@nostr-dev-kit/ndk-wallet bundle stub', () => {
  it('is resolved to an empty module by metro.config.js', () => {
    const metroConfig = fs.readFileSync(path.join(APP_ROOT, 'metro.config.js'), 'utf8');
    expect(metroConfig).toMatch(
      /moduleName === '@nostr-dev-kit\/ndk-wallet'\)\s*\{\s*return \{ type: 'empty' \};/
    );
  });

  it('has no caller of the ndk-mobile hooks that depend on it', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      for (const symbol of STUB_DEPENDENT_EXPORTS) {
        if (new RegExp(`\\b${symbol}\\b`).test(source)) {
          offenders.push(`${path.relative(APP_ROOT, file)} → ${symbol}`);
        }
      }
    }
    // If this fails: the stub has to go before that hook can be used, and the
    // ~141 KB comes back. Prefer implementing the behaviour on the app's own
    // Nostr layer over restoring NDK's wallet stack.
    expect(offenders).toEqual([]);
  });

  it('still routes the hooks the app does use through ndk-mobile', () => {
    // Sanity: the stub must not have been "fixed" by dropping ndk-mobile's
    // useful surface instead. These three are why the package is still here.
    const used = sourceFiles()
      .flatMap((file) => fs.readFileSync(file, 'utf8').split('\n'))
      .filter((line) => line.includes("from '@nostr-dev-kit/ndk-mobile'"))
      .join('\n');
    expect(used).toContain('useNDK');
    expect(used).toContain('useSubscribe');
    expect(used).toContain('NDKCacheAdapterSqlite');
  });
});
