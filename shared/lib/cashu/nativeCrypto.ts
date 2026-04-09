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
      cashuLog.info('cashu.native_crypto.enabled', {
        functions: ['hashToCurve', 'blind', 'unblind', 'hashE', 'verifyDleqProof'],
      });
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
