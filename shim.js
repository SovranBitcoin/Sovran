import 'text-encoding-polyfill';
import 'react-native-get-random-values';
import './polyfills';

// Install react-native-quick-crypto FIRST so `globalThis.crypto.subtle` is
// available before any crypto consumer initializes. ts-mls / @hpke/core (used
// by White Noise / Marmot MLS) requires SubtleCrypto for KEM operations,
// which Hermes does not provide natively.
import { install as installQuickCrypto } from 'react-native-quick-crypto';

import * as c from 'expo-crypto';
installQuickCrypto();

if (
  typeof global?.Crypto === 'undefined' &&
  typeof global?.crypto === 'undefined' &&
  typeof global?.window?.crypto === 'undefined'
) {
  // @ts-expect-error -- crypto types do not align across polyfill + shim
  global.crypto = c;
}

if (typeof __dirname === 'undefined') global.__dirname = '/';
if (typeof __filename === 'undefined') global.__filename = '';
if (typeof process === 'undefined') {
  global.process = require('process');
} else {
  const bProcess = require('process');
  for (let p in bProcess) {
    if (!(p in process)) {
      process[p] = bProcess[p];
    }
  }
}

process.browser = false;
if (typeof Buffer === 'undefined') global.Buffer = require('buffer').Buffer;

// global.location = global.location || { port: 80 }
const isDev = typeof __DEV__ === 'boolean' && __DEV__;
process.env['NODE_ENV'] = isDev ? 'development' : 'production';
if (typeof localStorage !== 'undefined') {
  localStorage.debug = isDev ? '*' : '';
}
