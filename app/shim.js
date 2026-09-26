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

// Install react-native-quick-crypto FIRST so `globalThis.crypto.subtle` is
// available before any crypto consumer initializes. ts-mls / @hpke/core (used
// by White Noise / Marmot MLS) requires SubtleCrypto for KEM operations,
// which Hermes does not provide natively.
import { install as installQuickCrypto } from 'react-native-quick-crypto';

installStreamCapableResponse();

installQuickCrypto();

if (typeof globalThis.TextEncoder !== 'function' || typeof globalThis.TextDecoder !== 'function') {
  throw new Error('UTF-8 bootstrap failed: TextEncoder or TextDecoder is unavailable');
}
if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  throw new Error('Secure random bootstrap failed: crypto.getRandomValues is unavailable');
}
try {
  globalThis.crypto.getRandomValues(new Uint8Array(1));
} catch {
  throw new Error('Secure random bootstrap failed: native provider is unavailable');
}
if (!globalThis.crypto.subtle) {
  throw new Error('Secure crypto bootstrap failed: crypto.subtle is unavailable');
}

if (typeof __dirname === 'undefined') global.__dirname = '/';
if (typeof __filename === 'undefined') global.__filename = '';
process.env ??= {};

const isDev = typeof __DEV__ === 'boolean' && __DEV__;
process.env['NODE_ENV'] = isDev ? 'development' : 'production';
if (typeof localStorage !== 'undefined') {
  localStorage.debug = isDev ? '*' : '';
}
