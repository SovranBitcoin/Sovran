/**
 * @fileoverview Cashu token and Lightning invoice amount decoders.
 *
 * Used by the test DSL's `assert $var cashu-amount eq N` and
 * `assert $var bolt11-amount eq N` operators to verify payment amounts
 * without shelling out to cocod.
 */

/**
 * Decode a cashu token (V3 cashuA or V4 cashuB prefix) and return the
 * total amount in sats by summing all proof amounts.
 */
export function decodeCashuAmount(token: string): number {
  if (token.startsWith('cashuB')) {
    return decodeCashuV4Amount(token);
  }
  if (token.startsWith('cashuA')) {
    return decodeCashuV3Amount(token);
  }
  throw new Error(`not a cashu token (expected cashuA or cashuB prefix)`);
}

function decodeCashuV4Amount(token: string): number {
  const raw = token.slice('cashuB'.length);
  const buf = base64urlDecode(raw);
  // V4 tokens are CBOR-encoded. The structure is a map with key "t"
  // containing an array of token entries, each with key "p" containing
  // an array of proofs with key "a" for amount.
  //
  // Simplified CBOR parsing: V4 tokens from cashu-ts also support
  // JSON encoding as a fallback, so try JSON first.
  try {
    const json = JSON.parse(new TextDecoder().decode(buf));
    return sumProofsFromV4(json);
  } catch {
    // Fall through to CBOR
  }
  // Minimal CBOR decode for the specific structure we need.
  const decoded = decodeCBOR(buf);
  return sumProofsFromV4(decoded);
}

function sumProofsFromV4(obj: any): number {
  // V4 structure: { t: [{ p: [{ a: N }, ...] }], ... }
  // or flat: { t: [{ p: [{ a: N }] }] }
  let total = 0;
  const tokenEntries = obj.t || obj.token || [];
  for (const entry of tokenEntries) {
    const proofs = entry.p || entry.proofs || [];
    for (const proof of proofs) {
      total += proof.a ?? proof.amount ?? 0;
    }
  }
  if (total === 0 && !obj.t && !obj.token) {
    throw new Error('could not find proofs in cashu V4 token');
  }
  return total;
}

function decodeCashuV3Amount(token: string): number {
  const raw = token.slice('cashuA'.length);
  const buf = base64urlDecode(raw);
  const json = JSON.parse(new TextDecoder().decode(buf));
  // V3 structure: { token: [{ proofs: [{ amount: N }, ...] }] }
  let total = 0;
  for (const entry of json.token || []) {
    for (const proof of entry.proofs || []) {
      total += proof.amount ?? 0;
    }
  }
  return total;
}

/**
 * Decode a BOLT11 lightning invoice and return the amount in sats.
 * Parses the human-readable part of the bech32 string.
 */
export function decodeBolt11Amount(invoice: string): number {
  const lower = invoice.toLowerCase();
  if (!lower.startsWith('lnbc') && !lower.startsWith('lntb') && !lower.startsWith('lnbcrt')) {
    throw new Error(`not a bolt11 invoice (expected lnbc/lntb/lnbcrt prefix)`);
  }
  // Find the prefix (lnbc, lntb, lnbcrt) and extract the amount+multiplier
  // Format: ln<network><amount><multiplier>1<data...>
  // The "1" separator is the last "1" before the data part
  const lastOne = lower.lastIndexOf('1');
  if (lastOne === -1) throw new Error('invalid bolt11: no separator');
  const hrp = lower.slice(0, lastOne);
  // Strip the network prefix
  let amountStr: string;
  if (hrp.startsWith('lnbcrt')) {
    amountStr = hrp.slice('lnbcrt'.length);
  } else if (hrp.startsWith('lntbs')) {
    amountStr = hrp.slice('lntbs'.length);
  } else if (hrp.startsWith('lnbc')) {
    amountStr = hrp.slice('lnbc'.length);
  } else if (hrp.startsWith('lntb')) {
    amountStr = hrp.slice('lntb'.length);
  } else {
    throw new Error(`unrecognized bolt11 network prefix: ${hrp}`);
  }

  if (amountStr.length === 0) {
    throw new Error('bolt11 invoice has no amount (zero-amount invoice)');
  }

  // The last character may be a multiplier: m (milli), u (micro), n (nano), p (pico)
  const multipliers: Record<string, number> = {
    m: 100_000, // milli-BTC = 100,000 sats
    u: 100, // micro-BTC = 100 sats
    n: 0.1, // nano-BTC  = 0.1 sats
    p: 0.0001, // pico-BTC  = 0.0001 sats
  };
  const lastChar = amountStr[amountStr.length - 1];
  if (multipliers[lastChar] !== undefined) {
    const num = parseInt(amountStr.slice(0, -1), 10);
    if (isNaN(num)) throw new Error(`invalid bolt11 amount: ${amountStr}`);
    return Math.round(num * multipliers[lastChar]);
  }
  // No multiplier — amount is in BTC
  const btc = parseFloat(amountStr);
  if (isNaN(btc)) throw new Error(`invalid bolt11 amount: ${amountStr}`);
  return Math.round(btc * 100_000_000);
}

// ── Helpers ──

function base64urlDecode(str: string): Uint8Array {
  // Pad to multiple of 4
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4 !== 0) padded += '=';
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Minimal CBOR decoder — handles maps, arrays, integers, strings, byte strings. */
function decodeCBOR(data: Uint8Array): any {
  let offset = 0;

  function readByte(): number {
    if (offset >= data.length) throw new Error('CBOR: unexpected end of data');
    return data[offset++];
  }

  function readUint(additionalInfo: number): number {
    if (additionalInfo < 24) return additionalInfo;
    if (additionalInfo === 24) return readByte();
    if (additionalInfo === 25) {
      const hi = readByte(),
        lo = readByte();
      return (hi << 8) | lo;
    }
    if (additionalInfo === 26) {
      let val = 0;
      for (let i = 0; i < 4; i++) val = (val << 8) | readByte();
      return val >>> 0;
    }
    throw new Error(`CBOR: unsupported additional info ${additionalInfo}`);
  }

  function decode(): any {
    const initial = readByte();
    const majorType = initial >> 5;
    const additionalInfo = initial & 0x1f;

    switch (majorType) {
      case 0: // unsigned integer
        return readUint(additionalInfo);
      case 1: // negative integer
        return -1 - readUint(additionalInfo);
      case 2: {
        // byte string
        const len = readUint(additionalInfo);
        const bytes = data.slice(offset, offset + len);
        offset += len;
        return bytes;
      }
      case 3: {
        // text string
        const len = readUint(additionalInfo);
        const bytes = data.slice(offset, offset + len);
        offset += len;
        return new TextDecoder().decode(bytes);
      }
      case 4: {
        // array
        const len = readUint(additionalInfo);
        const arr: any[] = [];
        for (let i = 0; i < len; i++) arr.push(decode());
        return arr;
      }
      case 5: {
        // map
        const len = readUint(additionalInfo);
        const obj: Record<string, any> = {};
        for (let i = 0; i < len; i++) {
          const key = decode();
          const value = decode();
          obj[String(key)] = value;
        }
        return obj;
      }
      case 7: // simple/float
        if (additionalInfo === 20) return false;
        if (additionalInfo === 21) return true;
        if (additionalInfo === 22) return null;
        throw new Error(`CBOR: unsupported simple value ${additionalInfo}`);
      default:
        throw new Error(`CBOR: unsupported major type ${majorType}`);
    }
  }

  return decode();
}
