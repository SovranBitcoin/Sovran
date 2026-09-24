import { ungzip } from 'pako';

/**
 * The one `zlib` entry point `@tinfoilsh/verifier` needs, for React Native.
 *
 * A SEV-SNP attestation report arrives gzipped inside the bundle. The verifier
 * reaches for `DecompressionStream('gzip')` and falls back to Node's `zlib`;
 * Hermes has neither, so Metro aliases `zlib` to this module (see
 * `metro.config.js`). Only `gunzipSync` is provided — anything else importing
 * `zlib` should fail loudly here rather than silently get a stub.
 */
export function gunzipSync(data: Uint8Array | ArrayBuffer): Uint8Array {
  return ungzip(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
}
