/**
 * Web globals React Native ships but `jest-expo/node` does not.
 *
 * `nostr-tools/nip19` reads `TextDecoder` at module scope, so any module that
 * imports it — directly or three files down — fails to LOAD here, with a
 * `ReferenceError` that names the import rather than the missing global. Node
 * has had both classes on `node:util` since v11; this just puts them where the
 * device runtime already has them.
 */
const { TextDecoder, TextEncoder } = require('node:util');

if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = TextDecoder;
if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = TextEncoder;
