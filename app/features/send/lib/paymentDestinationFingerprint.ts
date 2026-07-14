import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Stable equality-only fingerprint for device tests. The full destination is
 * intentionally never placed in accessibility output or logs.
 */
export function paymentDestinationFingerprint(destination: string): string {
  return bytesToHex(sha256(utf8ToBytes(destination))).slice(0, 16);
}
