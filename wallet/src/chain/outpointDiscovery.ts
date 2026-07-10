// ---------------------------------------------------------------------------
// Heuristic outpoint discovery for onchain melts (NUT-30 sends)
// ---------------------------------------------------------------------------
//
// Some mint backends (cdk-bdk today) only publish the melt outpoint after the
// transaction CONFIRMS, even though NUT-30 says it should be present once
// broadcast. While the melt is PENDING with no outpoint, the wallet still
// knows the destination address and the exact amount it asked the mint to
// send — enough to find a candidate transaction on mempool.space and light up
// the confirmations ring + explorer link with an explicit heuristic warning.
//
// Best-effort by design: adopt ONLY a globally unique exact-amount match.
// Address reuse, mint batching that splits/adjusts payouts, or two identical
// payments in flight all produce ambiguity — and ambiguity means "no match",
// never a guess. A mint-provided outpoint always overrides an adopted one.

import type { AddressOutpointCandidateTx } from "./mempool";

export interface OutpointMatchCriteria {
  /** The melt destination address (NUT-30 quote `request`). */
  address: string;
  /** The exact amount the mint was asked to pay to `address`. */
  amountSats: number;
  /** Quote creation time (seconds). Confirmed txs mined before this cannot be
   *  our payment. Esplora exposes no first-seen time for unconfirmed txs, so
   *  they cannot be age-gated and remain explicitly heuristic. */
  notBeforeSec: number;
}

/**
 * Find the single `txid:vout` paying exactly `amountSats` to `address` in
 * transactions, rejecting confirmed candidates mined before the quote was
 * created. Returns `null` unless the match is unique across every returned
 * transaction AND every output —
 * two candidate outputs anywhere (even within one transaction) disqualify
 * both.
 */
export function matchUniqueSendOutpoint(
  txs: AddressOutpointCandidateTx[],
  criteria: OutpointMatchCriteria,
): string | null {
  const { address, amountSats, notBeforeSec } = criteria;
  if (!address || !Number.isFinite(amountSats) || amountSats <= 0) return null;

  const matches: string[] = [];
  for (const tx of txs) {
    // A tx confirmed before the quote existed cannot be this payment. An
    // unconfirmed tx has no first-seen timestamp on Esplora, so it cannot be
    // age-gated here; callers must continue to treat that match as heuristic.
    if (
      tx.confirmed &&
      tx.blockTimeSec != null &&
      tx.blockTimeSec < notBeforeSec
    ) {
      continue;
    }
    tx.vout.forEach((output, index) => {
      if (output.address === address && output.valueSats === amountSats) {
        matches.push(`${tx.txid}:${index}`);
      }
    });
  }

  return matches.length === 1 ? matches[0]! : null;
}
