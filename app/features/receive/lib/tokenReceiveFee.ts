/**
 * The fee a token pays to be redeemed. Redeeming swaps every proof in it, and
 * NUT-02 charges each input its keyset's `input_fee_ppk`, the total rounded up
 * to a whole unit — the sum cashu-ts's `getFeesForProofs` takes.
 *
 * Pure: it decodes the token against keysets already read, and touches no
 * wallet, counter or network. Any proof whose keyset is unknown, or a fee that
 * is not a whole non-negative number, makes the answer `undefined`, so nothing
 * is shown rather than a guess.
 */
import { getDecodedToken } from '@cashu/cashu-ts';

interface KeysetFee {
  id?: string;
  feePpk?: number;
}

export function tokenReceiveFee(token: string, keysets: readonly KeysetFee[]): number | undefined {
  const feeById = new Map<string, number | undefined>();
  for (const keyset of keysets) if (keyset.id) feeById.set(keyset.id, keyset.feePpk);
  let proofs: { id: string }[];
  try {
    proofs = getDecodedToken(token, [...feeById.keys()]).proofs;
  } catch {
    return undefined;
  }
  if (proofs.length === 0) return undefined;
  let ppk = 0;
  for (const proof of proofs) {
    if (!feeById.has(proof.id)) return undefined;
    const fee = feeById.get(proof.id) ?? 0;
    if (!Number.isInteger(fee) || fee < 0) return undefined;
    ppk += fee;
  }
  return Math.ceil(ppk / 1000);
}
