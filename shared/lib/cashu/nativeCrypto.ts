/**
 * Native crypto bridge for cashu-ts.
 *
 * Call `initNativeCrypto()` after cashu-ts has been imported (so that
 * `globalThis.__CASHU_NATIVE` exists from the cashu-ts patch). The best
 * place is during CocoManager.initialize().
 *
 * When active, `hashToCurve` and `blindMessage` inside cashu-ts delegate to
 * native C code (~100x faster than noble-curves BigInt on Hermes).
 *
 * If nutpatch / NitroModules aren't available (Expo Go, web), this is a
 * no-op — cashu-ts falls back to the JS implementation automatically.
 */

import { cashuLog } from '../logger';

declare global {
  var __CASHU_NATIVE:
    | {
        crypto: any;
        active: boolean;
        init(cryptoInstance: any): void;
      }
    | undefined;
}

let _initialized = false;

export function initNativeCrypto(): void {
  if (_initialized) return;
  _initialized = true;

  try {
    // Force cashu-ts's top-level to execute before we check for the
    // global it installs. Metro's `inlineRequires: true` defers each
    // import to first reference, so a static `import` of cashu-ts
    // wouldn't actually load the module here — it only loads when
    // a bound name is touched. The cashu-ts patch installs
    // `globalThis.__CASHU_NATIVE` at module scope, so we have to
    // load the module explicitly before reading the global.
    require('@cashu/cashu-ts');

    const { NitroModules } = require('react-native-nitro-modules');
    const crypto = NitroModules.createHybridObject('Crypto');

    if (!crypto || typeof crypto.hashToCurve !== 'function') {
      cashuLog.warn('cashu.native_crypto.invalid_instance', {
        reason: 'Crypto hybrid object missing hashToCurve',
      });
      return;
    }

    if (globalThis.__CASHU_NATIVE) {
      globalThis.__CASHU_NATIVE.init(crypto);
      const fns = ['hashToCurve', 'blind', 'unblind', 'hashE', 'verifyDleqProof'];
      // pbkdf2HmacSha512 is consumed by `shared/lib/nostr/keyDerivation.ts`
      // (BIP-39 mnemonicToSeed), independent of the cashu-ts patch.
      // Surfacing it in the enabled-functions log makes it obvious whether
      // a fresh build picked up the new native method without rebuilding
      // the dev client.
      if (typeof crypto.pbkdf2HmacSha512 === 'function') fns.push('pbkdf2HmacSha512');
      cashuLog.info('cashu.native_crypto.enabled', { functions: fns });
    } else {
      cashuLog.warn('cashu.native_crypto.hook_missing', {
        reason: '__CASHU_NATIVE not found — cashu-ts patch not applied?',
      });
    }
  } catch (error) {
    cashuLog.debug('cashu.native_crypto.unavailable', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
