// ---------------------------------------------------------------------------
// Canonical `creqA` spelling for payment requests other wallets emit
//
// Real wallets write NUT-18 requests that cashu-ts rejects:
//  - cashubtc/wallet (Android) pads the base64url body with `=` and writes
//    absent optional fields as CBOR `null` — `a: null` makes cashu-ts throw,
//    so every amountless request from that wallet was unreadable.
//  - BIP-321 URIs are upper-cased for QR alphanumeric mode, giving `CREQA…`.
// NUT-18 treats a null field as absent, so dropping it changes no meaning.
// Only the prefix and CBOR framing are rewritten; field values are untouched.
// ---------------------------------------------------------------------------

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlDecode(input: string): Uint8Array | null {
  const body = input.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  if (body.length % 4 === 1) return null;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of body) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.ceil(((Math.min(3, bytes.length - i)) * 8) / 6);
    for (let c = 0; c < chars; c++) out += ALPHABET[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

const CBOR_NULL = 0xf6;
const CBOR_UNDEFINED = 0xf7;

class UnsupportedCbor extends Error {}

/** Header of the item at `at`: major type, argument, and header length. */
function header(bytes: Uint8Array, at: number) {
  const initial = bytes[at];
  if (initial === undefined) throw new UnsupportedCbor("truncated");
  const major = initial >> 5;
  const info = initial & 31;
  if (info < 24) return { major, arg: info, size: 1 };
  const width = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
  // Indefinite lengths and reserved values: leave the request as it was.
  if (width === 0 || at + width >= bytes.length) throw new UnsupportedCbor("length");
  let arg = 0;
  for (let i = 1; i <= width; i++) arg = arg * 256 + bytes[at + i];
  return { major, arg, size: 1 + width };
}

function encodeHeader(major: number, arg: number): number[] {
  const m = major << 5;
  if (arg < 24) return [m | arg];
  if (arg < 0x100) return [m | 24, arg];
  if (arg < 0x10000) return [m | 25, arg >> 8, arg & 0xff];
  return [m | 26, (arg >>> 24) & 0xff, (arg >> 16) & 0xff, (arg >> 8) & 0xff, arg & 0xff];
}

/** Copy one CBOR item, dropping map entries whose value is null/undefined. */
function copyItem(bytes: Uint8Array, at: number, out: number[]): number {
  const { major, arg, size } = header(bytes, at);
  if (major === 2 || major === 3) {
    const end = at + size + arg;
    if (end > bytes.length) throw new UnsupportedCbor("truncated");
    out.push(...bytes.subarray(at, end));
    return end;
  }
  if (major === 4) {
    out.push(...encodeHeader(4, arg));
    let next = at + size;
    for (let i = 0; i < arg; i++) next = copyItem(bytes, next, out);
    return next;
  }
  if (major === 5) {
    const entries: number[] = [];
    let kept = 0;
    let next = at + size;
    for (let i = 0; i < arg; i++) {
      const entry: number[] = [];
      next = copyItem(bytes, next, entry);
      const valueAt = next;
      next = copyItem(bytes, next, entry);
      if (bytes[valueAt] === CBOR_NULL || bytes[valueAt] === CBOR_UNDEFINED) continue;
      entries.push(...entry);
      kept++;
    }
    out.push(...encodeHeader(5, kept), ...entries);
    return next;
  }
  if (major === 6) {
    out.push(...bytes.subarray(at, at + size));
    return copyItem(bytes, at + size, out);
  }
  // Integers, simple values and floats are wholly inside their header.
  out.push(...bytes.subarray(at, at + size));
  return at + size;
}

/**
 * Rewrite a `creqA` request into the spelling cashu-ts accepts: lowercase
 * `creq`, capital `A`, unpadded base64url and no null-valued fields. Returns
 * the input unchanged for anything else (creqB, non-requests, or CBOR this
 * cannot walk), so decoding still reports its own error for those.
 */
export function canonicalizePaymentRequest(value: string): string {
  const trimmed = value.trim();
  if (!/^creqa/i.test(trimmed)) return trimmed;
  const bytes = base64UrlDecode(trimmed.slice(5));
  if (!bytes) return trimmed;
  try {
    const out: number[] = [];
    if (copyItem(bytes, 0, out) !== bytes.length) return trimmed;
    return `creqA${base64UrlEncode(Uint8Array.from(out))}`;
  } catch (error) {
    if (error instanceof UnsupportedCbor) return trimmed;
    throw error;
  }
}
