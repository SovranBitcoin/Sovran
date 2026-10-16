import { CheckStateEnum, Mint, MintOperationError, MintQuoteState, Wallet } from '@cashu/cashu-ts';
import { LegacyClaimFault, type LegacyClaimPorts } from 'wallet';

/**
 * Whether a mint's refusal says it has no such quote. Neither mint has an
 * error code for this, so its wording is all there is:
 *
 * - nutshell raises a plain exception, sent as code 0, "quote not found";
 * - cdk sends code 50000, "Unknown quote". It sends the same code for
 *   "Payment state is unknown" and for database and backend failures, which
 *   say nothing about whether ecash is waiting.
 *
 * Any other refusal is not an answer. The invoice is asked about again and,
 * if it never resolves, keeps the old row.
 */
function saysQuoteIsUnknown(error: unknown): boolean {
  if (!(error instanceof MintOperationError)) return false;
  return (
    (error.code === 0 && error.message === 'quote not found') ||
    (error.code === 50000 && error.message === 'Unknown quote')
  );
}

/**
 * The three questions the redux-era claim puts to a mint. All are reads that
 * any mint answers without the wallet trusting it or holding its keys: proof
 * states are asked by the hash of each secret (NUT-07), and a quote by its id.
 */

/** A mint that has not answered by now counts as unreachable for this launch. */
const MINT_DEADLINE_MS = 15_000;

async function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LegacyClaimFault('transient')), MINT_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const legacyEcashMint: LegacyClaimPorts['mint'] = {
  async checkStates(mintUrl, proofs) {
    const states = await withDeadline(
      new Wallet(mintUrl).checkProofsStates(proofs.map(({ id, secret }) => ({ id, secret })))
    );
    return states.map(({ state }) =>
      state === CheckStateEnum.SPENT
        ? 'SPENT'
        : state === CheckStateEnum.UNSPENT
          ? 'UNSPENT'
          : 'PENDING'
    );
  },

  async keysetUnits(mintUrl) {
    const { keysets } = await withDeadline(new Mint(mintUrl).getKeySets());
    return new Map(keysets.map((keyset) => [keyset.id, keyset.unit]));
  },

  async quoteState(mintUrl, mintQuoteId) {
    try {
      const { state, expiry } = await withDeadline(
        new Mint(mintUrl).checkMintQuoteBolt11(mintQuoteId)
      );
      const expirySec = typeof expiry === 'number' && Number.isFinite(expiry) ? expiry : null;
      if (state === MintQuoteState.PAID) return { state: 'paid', expirySec };
      if (state === MintQuoteState.ISSUED) return { state: 'issued', expirySec };
      if (state === MintQuoteState.UNPAID) return { state: 'unpaid', expirySec };
      // A state this wallet does not know proves nothing.
      throw new LegacyClaimFault('transient');
    } catch (error) {
      if (saysQuoteIsUnknown(error)) return { state: 'unknown-quote', expirySec: null };
      throw error;
    }
  },
};
