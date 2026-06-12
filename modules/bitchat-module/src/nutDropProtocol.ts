/**
 * Pure codecs for the Nut Drop NUT-18 exchange over bitchat's Noise channel.
 *
 * Wire context: each payload below is a complete "typed Noise payload" — the
 * first byte is the payload type, the rest is the value — carried inside a
 * standard `noiseEncrypted` bitchat packet (AEAD'd, transport-fragmented for
 * large sizes). The types live in a self-assigned vendor range that stock
 * clients drop silently; senders only emit them to peers whose announce
 * carried the capability beacon (see EcashAnnounceExtension.swift/.kt).
 *
 * There are deliberately NO per-payload magic or version bytes: the Cashu
 * artifacts are self-describing (`creqA…` carries its own prefix + version;
 * NUT-18 owns format evolution) and everything else is correlated by IDs we
 * issued, so foreign content on a squatted type byte fails parse or
 * correlation and drops. Layouts are append-only — decoders ignore trailing
 * bytes so future fields can be added without a version bump.
 *
 * The native layer is a dumb byte pipe; ALL semantics (creq parsing, solicit
 * correlation, payment validation) live above these codecs. Keep this file
 * dependency-free and runtime-agnostic — it is the JS half of the
 * cross-platform golden-vector tests (mirrored against the Swift/Kotlin
 * encoders in __tests__/nutDropProtocol.test.ts).
 */

// --- Payload types (vendor Noise payload range) ---

/** First/last byte of the vendor range — mirrors NutPayloadRange (native). */
export const NUT_PAYLOAD_TYPE_FIRST = 0xa0;
export const NUT_PAYLOAD_TYPE_LAST = 0xa3;

export const NUT_PAYLOAD_TYPE = {
  /** Sender → receiver: "issue me a NUT-18 payment request". */
  solicit: 0xa0,
  /** Receiver → sender: the single-use `creq…` answering a solicit. */
  request: 0xa1,
  /** Sender → receiver: NUT-18 PaymentRequestPayload JSON (the money). */
  payment: 0xa2,
  /** Receiver → sender: received / redeemed / rejected for a payment id. */
  status: 0xa3,
} as const;

export function isNutPayloadType(type: number): boolean {
  return type >= NUT_PAYLOAD_TYPE_FIRST && type <= NUT_PAYLOAD_TYPE_LAST;
}

// --- Solicit (0xA0): type(1) | solicitId(8) | flags(1) | future… ---

export const SOLICIT_ID_LENGTH = 8;
/**
 * The sender intends an offline (bearer) send — the receiver should omit
 * `nut10` from its payment request and expect proofs from its trusted mints.
 */
export const SOLICIT_FLAG_SENDER_OFFLINE = 0x01;

export interface NutSolicit {
  /** 8 random bytes — the correlation handle echoed by the 0xA1 response. */
  solicitId: Uint8Array;
  senderOffline: boolean;
}

export function encodeSolicit(solicit: NutSolicit): Uint8Array {
  if (solicit.solicitId.length !== SOLICIT_ID_LENGTH) {
    throw new Error(`solicitId must be ${SOLICIT_ID_LENGTH} bytes`);
  }
  const out = new Uint8Array(1 + SOLICIT_ID_LENGTH + 1);
  out[0] = NUT_PAYLOAD_TYPE.solicit;
  out.set(solicit.solicitId, 1);
  out[1 + SOLICIT_ID_LENGTH] = solicit.senderOffline ? SOLICIT_FLAG_SENDER_OFFLINE : 0;
  return out;
}

export function decodeSolicit(payload: Uint8Array): NutSolicit | null {
  if (payload.length < 1 + SOLICIT_ID_LENGTH + 1) return null;
  if (payload[0] !== NUT_PAYLOAD_TYPE.solicit) return null;
  const flags = payload[1 + SOLICIT_ID_LENGTH]!;
  return {
    solicitId: payload.slice(1, 1 + SOLICIT_ID_LENGTH),
    senderOffline: (flags & SOLICIT_FLAG_SENDER_OFFLINE) !== 0,
  };
}

/** Random 8-byte solicit id (crypto.getRandomValues — polyfilled in RN). */
export function generateSolicitId(): Uint8Array {
  const id = new Uint8Array(SOLICIT_ID_LENGTH);
  globalThis.crypto.getRandomValues(id);
  return id;
}

export function solicitIdHex(solicitId: Uint8Array): string {
  let hex = '';
  for (const byte of solicitId) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

// --- Request (0xA1): type(1) | solicitId(8) | UTF-8 "creq…" ---

const CREQ_PREFIX = 'creq';

export interface NutRequest {
  /** Echo of the solicit's correlation handle. */
  solicitId: Uint8Array;
  /** Serialized NUT-18 payment request ("creqA…"). */
  creq: string;
}

export function encodeRequest(request: NutRequest): Uint8Array {
  if (request.solicitId.length !== SOLICIT_ID_LENGTH) {
    throw new Error(`solicitId must be ${SOLICIT_ID_LENGTH} bytes`);
  }
  if (!request.creq.startsWith(CREQ_PREFIX)) {
    throw new Error('payment request must be a serialized NUT-18 "creq…" string');
  }
  const creqBytes = new TextEncoder().encode(request.creq);
  const out = new Uint8Array(1 + SOLICIT_ID_LENGTH + creqBytes.length);
  out[0] = NUT_PAYLOAD_TYPE.request;
  out.set(request.solicitId, 1);
  out.set(creqBytes, 1 + SOLICIT_ID_LENGTH);
  return out;
}

export function decodeRequest(payload: Uint8Array): NutRequest | null {
  if (payload.length <= 1 + SOLICIT_ID_LENGTH) return null;
  if (payload[0] !== NUT_PAYLOAD_TYPE.request) return null;
  const creq = utf8Decode(payload.subarray(1 + SOLICIT_ID_LENGTH));
  if (creq === null || !creq.startsWith(CREQ_PREFIX)) return null;
  return { solicitId: payload.slice(1, 1 + SOLICIT_ID_LENGTH), creq };
}

// --- Payment (0xA2): type(1) | UTF-8 PaymentRequestPayload JSON ---

export function encodePayment(paymentJson: string): Uint8Array {
  const jsonBytes = new TextEncoder().encode(paymentJson);
  const out = new Uint8Array(1 + jsonBytes.length);
  out[0] = NUT_PAYLOAD_TYPE.payment;
  out.set(jsonBytes, 1);
  return out;
}

/**
 * Returns the raw JSON string; structural validation (NUT-18
 * PaymentRequestPayload shape, id correlation, mint/lock checks) is the
 * caller's job — the codec only owns the byte layout.
 */
export function decodePayment(payload: Uint8Array): string | null {
  if (payload.length <= 1) return null;
  if (payload[0] !== NUT_PAYLOAD_TYPE.payment) return null;
  return utf8Decode(payload.subarray(1));
}

// --- Status (0xA3): type(1) | status(1) | reason(1) | UTF-8 payment id ---

export const NUT_PAYMENT_STATUS = {
  /** Payment validated and accepted into the redeem queue. */
  received: 0x01,
  /** Proofs swapped at the mint — the money is the receiver's. */
  redeemed: 0x02,
  /** Payment refused (see reason byte); sender should reclaim/rollback. */
  rejected: 0x03,
} as const;

export type NutPaymentStatusName = keyof typeof NUT_PAYMENT_STATUS;

/**
 * Log-grade rejection detail. 0x00 (`none`) for non-rejected statuses;
 * unknown future values decode as `unknown` rather than failing.
 */
export const NUT_REJECT_REASON = {
  none: 0x00,
  untrustedMint: 0x01,
  invalid: 0x02,
  mismatch: 0x03,
  duplicate: 0x04,
} as const;

export type NutRejectReasonName = keyof typeof NUT_REJECT_REASON | 'unknown';

export interface NutStatus {
  status: NutPaymentStatusName;
  reason: NutRejectReasonName;
  /** The NUT-18 payment id (`i` from the creq) this status refers to. */
  paymentId: string;
}

const STATUS_BY_BYTE: Record<number, NutPaymentStatusName> = {
  [NUT_PAYMENT_STATUS.received]: 'received',
  [NUT_PAYMENT_STATUS.redeemed]: 'redeemed',
  [NUT_PAYMENT_STATUS.rejected]: 'rejected',
};

const REASON_BY_BYTE: Record<number, NutRejectReasonName> = {
  [NUT_REJECT_REASON.none]: 'none',
  [NUT_REJECT_REASON.untrustedMint]: 'untrustedMint',
  [NUT_REJECT_REASON.invalid]: 'invalid',
  [NUT_REJECT_REASON.mismatch]: 'mismatch',
  [NUT_REJECT_REASON.duplicate]: 'duplicate',
};

export function encodeStatus(status: NutStatus): Uint8Array {
  if (status.paymentId.length === 0) {
    throw new Error('paymentId must be non-empty');
  }
  if (status.reason === 'unknown') {
    throw new Error('cannot encode an unknown reject reason');
  }
  const idBytes = new TextEncoder().encode(status.paymentId);
  const out = new Uint8Array(3 + idBytes.length);
  out[0] = NUT_PAYLOAD_TYPE.status;
  out[1] = NUT_PAYMENT_STATUS[status.status];
  out[2] = NUT_REJECT_REASON[status.reason];
  out.set(idBytes, 3);
  return out;
}

export function decodeStatus(payload: Uint8Array): NutStatus | null {
  if (payload.length <= 3) return null;
  if (payload[0] !== NUT_PAYLOAD_TYPE.status) return null;
  const status = STATUS_BY_BYTE[payload[1]!];
  if (!status) return null;
  const paymentId = utf8Decode(payload.subarray(3));
  if (paymentId === null || paymentId.length === 0) return null;
  return { status, reason: REASON_BY_BYTE[payload[2]!] ?? 'unknown', paymentId };
}

// --- Capability beacon (announce TLV 0xF0) ---
//
// The beacon is encoded/parsed natively (EcashAnnounceExtension.swift/.kt) —
// these constants + encoder exist so the cross-platform golden-vector test
// can assert the byte layout from JS, and so colada/spec code can reference
// the flag bits without magic numbers.

export const NUT_BEACON_TLV_TYPE = 0xf0;
export const NUT_BEACON_MAGIC = 'NUTB';
export const NUT_BEACON_VERSION = 0x02;
/** Answers NUT-18 payment-request solicits over the Noise channel. */
export const NUT_BEACON_FLAG_NUT_REQUESTS = 0x01;
/** Auto-redeems received ecash (informational — drives a radar badge). */
export const NUT_BEACON_FLAG_AUTO_REDEEM = 0x02;

export function encodeBeaconTLV(flags: number): Uint8Array {
  const magic = new TextEncoder().encode(NUT_BEACON_MAGIC);
  const out = new Uint8Array(2 + magic.length + 2);
  out[0] = NUT_BEACON_TLV_TYPE;
  out[1] = magic.length + 2;
  out.set(magic, 2);
  out[2 + magic.length] = NUT_BEACON_VERSION;
  out[3 + magic.length] = flags & 0xff;
  return out;
}

// --- Byte helpers (dependency-free; used at the bridge base64 boundary) ---

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += BASE64_ALPHABET[b0 >> 2]!;
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]! : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 0x3f]! : '=';
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array | null {
  const clean = base64.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | BASE64_ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

/** Strict UTF-8 decode; null on invalid byte sequences (malformed payload). */
function utf8Decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
