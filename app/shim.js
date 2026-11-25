import '@bacons/text-decoder/install';
import './polyfills';

// React Native installs `Headers`/`Request`/`Response` lazily from its own
// `whatwg-fetch` copy, and Expo's WinterCG runtime then swaps `fetch` for the
// streaming `expo/fetch` while leaving that `Response` in place. The pair does
// not match: anything that re-wraps a streaming response with `new Response(…)`
// gets the string "[object ReadableStream]" instead of the body. Import RN's
// core first — the same guard Expo uses — so the class exists to be wrapped
// regardless of module order.
import 'react-native/Libraries/Core/InitializeCore';

import { installStreamCapableResponse } from './shared/lib/http/streamResponse';

// Install native CSPRNG (`SecRandomCopyBytes` on iOS, `java.security.SecureRandom`
// on Android via `expo-crypto`) onto `globalThis.crypto.getRandomValues` before any
// crypto consumer initializes. Never fall back to a JS PRNG; fail closed on boot.
// Note: use `getRandomValues` (direct native call, no __DEV__ Math.random fallback),
// never `getRandomBytes`.
import { getRandomValues as nativeGetRandomValues } from 'expo-crypto';

installStreamCapableResponse();

if (typeof globalThis.crypto !== 'object' || globalThis.crypto === null) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    writable: true,
    value: {},
  });
}

if (typeof globalThis.crypto.getRandomValues !== 'function') {
  if (typeof nativeGetRandomValues !== 'function') {
    throw new Error('Secure random bootstrap failed: crypto.getRandomValues is unavailable');
  }
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    configurable: true,
    writable: true,
    value: nativeGetRandomValues,
  });
}

if (typeof globalThis.TextEncoder !== 'function' || typeof globalThis.TextDecoder !== 'function') {
  throw new Error('UTF-8 bootstrap failed: TextEncoder or TextDecoder is unavailable');
}
if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  throw new Error('Secure random bootstrap failed: crypto.getRandomValues is unavailable');
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

const isDev = typeof __DEV__ === 'boolean' && __DEV__;
process.env['NODE_ENV'] = isDev ? 'development' : 'production';
if (typeof localStorage !== 'undefined') {
  localStorage.debug = isDev ? '*' : '';
}
