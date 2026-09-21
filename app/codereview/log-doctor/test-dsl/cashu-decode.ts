/**
 * @fileoverview Cashu token and Lightning invoice amount decoders.
 *
 * Used by the test DSL's `assert $var cashu-amount eq N` and
 * `assert $var bolt11-amount eq N` operators to verify payment amounts
 * without shelling out to cocod.
 */

import { getTokenMetadata } from '@cashu/cashu-ts';

/**
 * Decode a cashu token (V3 cashuA or V4 cashuB prefix) and return the
 * total amount in sats by summing all proof amounts.
 */
export function decodeCashuAmount(token: string): number {
  if (!token.startsWith('cashuA') && !token.startsWith('cashuB')) {
    throw new Error(`not a cashu token (expected cashuA or cashuB prefix)`);
  }
  return getTokenMetadata(token).amount.toNumber();
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
