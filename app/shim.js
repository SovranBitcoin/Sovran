import '@bacons/text-decoder/install';
import './polyfills';

// Import RN core before wrapping fetch/Response so `new Response(stream)` keeps
// streaming bodies intact under Expo's WinterCG runtime.
import 'react-native/Libraries/Core/InitializeCore';

import { Buffer } from 'buffer';
import { getRandomValues as nativeGetRandomValues } from 'expo-crypto';
import { installStreamCapableResponse } from './shared/lib/http/streamResponse';

installStreamCapableResponse();

// Preserve global Buffer + process.nextTick (previously installed as side effects
// of react-native-quick-crypto). cashu-ts / coco-core rely on globalThis.Buffer
// for base64 encoding of payloads >32 KiB without chunk-boundary corruption.
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

if (typeof globalThis.crypto !== 'object' || globalThis.crypto === null) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: {} });
}
if (typeof globalThis.crypto.getRandomValues !== 'function') {
  if (typeof nativeGetRandomValues !== 'function') {
    throw new Error('Secure random bootstrap failed: crypto.getRandomValues is unavailable');
  }
  let inRandomCall = false;
  // Use expo-crypto's getRandomValues (direct OS CSPRNG, no __DEV__ Math.random
  // fallback) with a re-entrancy guard so ExpoCrypto.web.js cannot recurse when
  // Web Crypto is absent.
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    configurable: true,
    writable: true,
    value: (typedArray) => {
      if (inRandomCall) {
        throw new Error('Secure random bootstrap failed: recursive crypto.getRandomValues');
      }
      inRandomCall = true;
      try {
        return nativeGetRandomValues(typedArray);
      } finally {
        inRandomCall = false;
      }
    },
  });
}

if (typeof globalThis.TextEncoder !== 'function' || typeof globalThis.TextDecoder !== 'function') {
  throw new Error('UTF-8 bootstrap failed: TextEncoder or TextDecoder is unavailable');
}
const entropyProbe = new Uint8Array(32);
try {
  globalThis.crypto.getRandomValues(entropyProbe);
} catch {
  throw new Error('Secure random bootstrap failed: native provider is unavailable');
}
if (!entropyProbe.some((byte) => byte !== 0)) {
  throw new Error('Secure random bootstrap failed: native provider returned all-zero bytes');
}

if (typeof __dirname === 'undefined') global.__dirname = '/';
if (typeof __filename === 'undefined') global.__filename = '';
process.env ??= {};
if (typeof process.nextTick !== 'function') {
  process.nextTick = (fn, ...args) => {
    Promise.resolve().then(() => fn(...args));
  };
}

const isDev = typeof __DEV__ === 'boolean' && __DEV__;
process.env['NODE_ENV'] = isDev ? 'development' : 'production';
if (typeof localStorage !== 'undefined') {
  localStorage.debug = isDev ? '*' : '';
}
