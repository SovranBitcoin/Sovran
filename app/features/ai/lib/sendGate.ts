import type { LineupEntry } from '@/shared/lib/routstr/lineup';
import { routstrMintKey } from '@/shared/lib/routstr/payingMint';

import { AFFORD_BUFFER, maxSpendSats } from './format';

/**
 * Everything that has to be true before an AI message leaves, decided in one
 * pure place.
 *
 * The wallet's own flows put their preconditions in a machine: named states, a
 * total transition, and a terminal state for every way a send can fail to
 * start. This send had them scattered through a long imperative handler, which
 * is why its failures read as "nothing happened" — a missing provider, a mint
 * the provider refuses and a declined confirmation all looked the same from
 * outside.
 *
 * `evaluateSendGate` is the transition. It is pure, total, and has no opinion
 * about UI: it names the situation, and the caller decides how to say it. The
 * one asynchronous step — asking the user — is a state (`confirm`) rather than
 * an `await` buried mid-function, so a decline is a first-class outcome with a
 * name instead of an early `return`.
 */

export interface SendGateInput {
  /** Trimmed message text. Empty is not an error, it is nothing to do. */
  text: string;
  /** The provider the user chose. `null` until they choose one — there is no
   *  default, because picking who gets paid is not this app's call. */
  providerBaseUrl: string | null;
  /** Mints this provider redeems ecash from. Empty means it publishes none,
   *  which reads as "any mint". */
  providerMints: readonly string[];
  /** Mints the wallet actually holds something in, canonicalised. */
  heldMints: ReadonlySet<string>;
  /** Sats in the mint this send would spend from. */
  walletSats: number;
  /** The model this send resolves to, or `null` when the lineup has not
   *  landed. */
  entry: LineupEntry | null;
  imageCount: number;
  /** Whether the user has asked to be shown the cost before each send. */
  confirmSpend: boolean;
  /**
   * What the node will actually reserve for THIS request, in whole sats —
   * `reservedSatsForSend` over the assembled messages. `null` when the model
   * cannot be priced, which is the only case where the typical-case estimate
   * has to stand in.
   *
   * It is an input rather than something this function computes because it
   * needs the real message bodies, images encoded and all, and a pure gate has
   * no business doing IO to find them.
   */
  reservedSats: number | null;
}

type SendGateOutcome =
  /** Nothing typed. Not a failure — there is simply nothing to send. */
  | { state: 'empty' }
  /** No provider chosen. The user has to name a recipient before money moves. */
  | { state: 'no-provider' }
  /** The provider redeems ecash only from mints the wallet does not hold. */
  | { state: 'mint-not-accepted'; providerMints: readonly string[] }
  /** The wallet cannot cover what this provider will reserve up front. */
  | { state: 'insufficient-funds'; needSats: number; haveSats: number }
  /** Ready, and the user has asked to see what leaves the wallet first. */
  | { state: 'confirm'; reserveSats: number; modelName: string; reserveKnown: boolean }
  /** Ready to send. */
  | { state: 'ready'; reserveSats: number; reserveKnown: boolean };

/**
 * The order is the point.
 *
 * Each check is only meaningful once the one before it passed: there is no
 * "can you afford it" without a provider to pay, and no mint question without
 * a provider to name the mints. Reordering them produces advice the user
 * cannot act on — "add funds" when the real problem is that they never picked
 * anyone to pay.
 */
export function evaluateSendGate(input: SendGateInput): SendGateOutcome {
  if (!input.text.trim()) return { state: 'empty' };
  if (!input.providerBaseUrl) return { state: 'no-provider' };

  if (
    input.providerMints.length > 0 &&
    !input.providerMints.some((mint) => input.heldMints.has(routstrMintKey(mint) ?? ''))
  ) {
    return { state: 'mint-not-accepted', providerMints: input.providerMints };
  }

  // Two different numbers, doing two different jobs, and conflating them is
  // what put a figure on the sheet that was not the one that left the wallet.
  //
  //   `reserveSats` is the truth: the node's admission gate for this exact
  //   body, computed the way the node computes it. It is what the user is
  //   asked to approve, unrounded by any safety margin of ours — padding a
  //   number presented as "this is what goes" makes it a different number.
  //
  //   `threshold` is the floor the wallet has to clear. It carries
  //   `AFFORD_BUFFER` because our catalogue snapshot and the SDK's can drift
  //   between refreshes, and a balance that only just covers the quote loses
  //   the race. A buffer belongs where being wrong costs a retry, not where
  //   being wrong is a lie.
  const reserveKnown = input.reservedSats != null;
  const reserveSats = input.reservedSats ?? maxSpendSats(input.entry, input.imageCount);
  const threshold = reserveKnown
    ? Math.ceil(reserveSats * AFFORD_BUFFER)
    : // The typical-case fallback already has the buffer baked in.
      reserveSats;
  if (threshold > 0 && input.walletSats < threshold) {
    return { state: 'insufficient-funds', needSats: threshold, haveSats: input.walletSats };
  }

  if (input.confirmSpend) {
    return {
      state: 'confirm',
      reserveSats,
      reserveKnown,
      modelName: input.entry?.displayName ?? 'this model',
    };
  }
  return { state: 'ready', reserveSats, reserveKnown };
}
