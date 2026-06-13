/**
 * Capability beacon constants + encoder for the Nut Drop announce TLV (0xF0).
 *
 * The beacon is encoded/parsed natively (EcashAnnounceExtension.swift/.kt) —
 * these constants + encoder exist so the cross-platform golden-vector test
 * can assert the byte layout from JS, and so colada/spec code can reference
 * the flag bits without magic numbers. Keep this file dependency-free and
 * runtime-agnostic.
 *
 * Ecash itself is sent by locking a token to the recipient's announced P2PK
 * key and broadcasting it on the public mesh; there is no in-band Noise
 * handshake.
 */

// --- Capability beacon (announce TLV 0xF0) ---

export const NUT_BEACON_TLV_TYPE = 0xf0;
export const NUT_BEACON_MAGIC = 'NUTB';
export const NUT_BEACON_VERSION = 0x03;
/** Answers cashu payment requests (legacy/informational bit). */
export const NUT_BEACON_FLAG_NUT_REQUESTS = 0x01;
/** Auto-redeems received ecash (informational — drives a radar badge). */
export const NUT_BEACON_FLAG_AUTO_REDEEM = 0x02;
/** 33-byte compressed secp256k1 P2PK key ("02" + x-only Nostr pubkey). */
export const NUT_BEACON_P2PK_LENGTH = 33;

/**
 * Encodes the v3 capability beacon TLV: `0xF0 | len(39) | "NUTB" | 0x03 |
 * flags | p2pk(33)`. `p2pkPubkey` must be the 33-byte "02"-prefixed
 * compressed key. Native owns the wire encode/decode; this exists so the
 * cross-platform golden-vector test can assert the byte layout from JS.
 */
export function encodeBeaconTLV(flags: number, p2pkPubkey: Uint8Array): Uint8Array {
  const magic = new TextEncoder().encode(NUT_BEACON_MAGIC);
  const value = magic.length + 2 + NUT_BEACON_P2PK_LENGTH;
  const out = new Uint8Array(2 + value);
  out[0] = NUT_BEACON_TLV_TYPE;
  out[1] = value;
  out.set(magic, 2);
  out[2 + magic.length] = NUT_BEACON_VERSION;
  out[3 + magic.length] = flags & 0xff;
  out.set(p2pkPubkey.subarray(0, NUT_BEACON_P2PK_LENGTH), 4 + magic.length);
  return out;
}
