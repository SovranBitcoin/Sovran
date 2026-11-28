// ---------------------------------------------------------------------------
// NUT-18 `sm` / NUT-26 `0x0a`: the payment methods a payee accepts
//
// The patched cashu-ts refuses any request that carries them, because it would
// otherwise drop them silently. Refusing made every such request unpayable,
// including the ones this wallet can honour. So the methods are split off
// here, before the SDK sees the request: the caller gets them as data to
// honour or refuse on (`supportedMethodsRefusal`), and the SDK gets the same
// request without them. Nothing else in the request is rewritten.
//
// A request whose methods cannot be read is left as it was, so the SDK still
// refuses it: unreadable constraints are never treated as none.
// ---------------------------------------------------------------------------

import {
  base64UrlDecode,
  base64UrlEncode,
  cborHeader,
  cborItemEnd,
  encodeCborHeader,
} from "./payment-request-canonical";
import type { PaymentRequestSupportedMethod } from "./types";

interface SplitRequest {
  /** The request with its supported methods removed. */
  request: string;
  methods: PaymentRequestSupportedMethod[];
}

class Unreadable extends Error {}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function uint(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Unreadable("fee");
  return value;
}

// ── creqA: CBOR ────────────────────────────────────────────────────────────

function cborText(bytes: Uint8Array, at: number): { text: string; end: number } {
  const { major, arg, size } = cborHeader(bytes, at);
  const end = at + size + arg;
  if (major !== 3 || end > bytes.length) throw new Unreadable("text");
  return { text: utf8.decode(bytes.subarray(at + size, end)), end };
}

/** `sm`: an array of `{ mn: text, mf?: uint }`. Unknown keys are skipped. */
function cborMethods(
  bytes: Uint8Array,
  at: number,
): PaymentRequestSupportedMethod[] {
  const list = cborHeader(bytes, at);
  if (list.major !== 4) throw new Unreadable("sm is not an array");
  const methods: PaymentRequestSupportedMethod[] = [];
  let next = at + list.size;
  for (let i = 0; i < list.arg; i++) {
    const entry = cborHeader(bytes, next);
    if (entry.major !== 5) throw new Unreadable("method is not a map");
    next += entry.size;
    let method: string | undefined;
    let fee = 0;
    for (let k = 0; k < entry.arg; k++) {
      const key = cborText(bytes, next);
      if (key.text === "mn") {
        const name = cborText(bytes, key.end);
        method = name.text;
        next = name.end;
      } else if (key.text === "mf") {
        const value = cborHeader(bytes, key.end);
        if (value.major !== 0) throw new Unreadable("fee is not a uint");
        fee = uint(value.arg);
        next = key.end + value.size;
      } else {
        next = cborItemEnd(bytes, key.end);
      }
    }
    if (!method) throw new Unreadable("method without a name");
    methods.push({ method, fee });
  }
  return methods;
}

function splitCreqA(value: string): SplitRequest | null {
  const bytes = base64UrlDecode(value.slice(5));
  if (!bytes) return null;
  const top = cborHeader(bytes, 0);
  if (top.major !== 5) return null;
  const kept: number[] = [];
  let keptEntries = 0;
  let methods: PaymentRequestSupportedMethod[] | null = null;
  let next = top.size;
  for (let i = 0; i < top.arg; i++) {
    const valueAt = cborItemEnd(bytes, next);
    const end = cborItemEnd(bytes, valueAt);
    const key = cborHeader(bytes, next);
    const isMethods =
      key.major === 3 && cborText(bytes, next).text === "sm";
    if (isMethods) {
      if (methods) throw new Unreadable("sm twice");
      methods = cborMethods(bytes, valueAt);
    } else {
      kept.push(...bytes.subarray(next, end));
      keptEntries++;
    }
    next = end;
  }
  if (next !== bytes.length || !methods) return null;
  return {
    request: `${value.slice(0, 5)}${base64UrlEncode(
      Uint8Array.from([...encodeCborHeader(5, keptEntries), ...kept]),
    )}`,
    methods,
  };
}

// ── creqB: bech32m TLV ─────────────────────────────────────────────────────

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONST = 0x2bc830a3;
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const HRP = "creqb";
const TAG_SUPPORTED_METHOD = 0x0a;

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i];
  }
  return chk >>> 0;
}

const hrpExpanded = [
  ...[...HRP].map((char) => char.charCodeAt(0) >>> 5),
  0,
  ...[...HRP].map((char) => char.charCodeAt(0) & 31),
];

function regroup(data: number[], from: number, to: number, pad: boolean) {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >>> bits) & ((1 << to) - 1));
    }
    acc &= (1 << bits) - 1;
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & ((1 << to) - 1));
  return out;
}

function creqBBytes(value: string): Uint8Array | null {
  const lower = value.toLowerCase();
  if (!lower.startsWith(`${HRP}1`)) return null;
  const words: number[] = [];
  for (const char of lower.slice(HRP.length + 1)) {
    const word = CHARSET.indexOf(char);
    if (word < 0) return null;
    words.push(word);
  }
  if (words.length < 6) return null;
  if (polymod([...hrpExpanded, ...words]) !== BECH32M_CONST) return null;
  return Uint8Array.from(regroup(words.slice(0, -6), 5, 8, false));
}

function creqBEncode(bytes: number[]): string {
  const words = regroup(bytes, 8, 5, true);
  const mod =
    polymod([...hrpExpanded, ...words, 0, 0, 0, 0, 0, 0]) ^ BECH32M_CONST;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `${HRP}1${[...words, ...checksum].map((word) => CHARSET[word]).join("")}`;
}

/** NUT-26 TLV: a 1-byte tag, a 2-byte big-endian length, then the value. */
function* tlv(bytes: Uint8Array): Generator<{ tag: number; from: number; to: number; at: number }> {
  let at = 0;
  while (at < bytes.length) {
    if (at + 3 > bytes.length) throw new Unreadable("tlv header");
    const from = at + 3;
    const to = from + ((bytes[at + 1] << 8) | bytes[at + 2]);
    if (to > bytes.length) throw new Unreadable("tlv length");
    yield { tag: bytes[at], from, to, at };
    at = to;
  }
}

/** Sub-TLV `0x01` method name, `0x02` fee as a big-endian u64. */
function tlvMethod(bytes: Uint8Array): PaymentRequestSupportedMethod {
  let method: string | undefined;
  let fee = 0;
  for (const field of tlv(bytes)) {
    const value = bytes.subarray(field.from, field.to);
    if (field.tag === 0x01) method = utf8.decode(value);
    if (field.tag === 0x02) {
      if (value.length !== 8) throw new Unreadable("fee width");
      fee = uint(value.reduce((sum, byte) => sum * 256 + byte, 0));
    }
  }
  if (!method) throw new Unreadable("method without a name");
  return { method, fee };
}

function splitCreqB(value: string): SplitRequest | null {
  const bytes = creqBBytes(value);
  if (!bytes) return null;
  const kept: number[] = [];
  const methods: PaymentRequestSupportedMethod[] = [];
  for (const field of tlv(bytes)) {
    if (field.tag === TAG_SUPPORTED_METHOD) {
      methods.push(tlvMethod(bytes.subarray(field.from, field.to)));
    } else {
      kept.push(...bytes.subarray(field.at, field.to));
    }
  }
  if (methods.length === 0) return null;
  const request = creqBEncode(kept);
  // bech32m is all one case; keep the case the request came in.
  return {
    request: value === value.toUpperCase() ? request.toUpperCase() : request,
    methods,
  };
}

/**
 * Splits the supported methods off a canonical `creqA` or a `creqB` request.
 * Null when it carries none, or when they cannot be read.
 */
export function splitSupportedMethods(value: string): SplitRequest | null {
  try {
    if (/^creqa/i.test(value)) return splitCreqA(value);
    if (/^creqb1/i.test(value)) return splitCreqB(value);
    return null;
  } catch {
    // Unreadable CBOR, TLV or text: leave the request for the SDK to refuse.
    return null;
  }
}
