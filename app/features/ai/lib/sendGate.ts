import type { LineupEntry } from '@/shared/lib/routstr/lineup';
import { routstrMintKey } from '@/shared/lib/routstr/payingMint';

import { maxSpendSats } from './format';

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
  /** Ready, and the user has asked to see the ceiling first. */
  | { state: 'confirm'; maxSats: number; modelName: string }
  /** Ready to send. */
  | { state: 'ready'; maxSats: number };

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

  const maxSats = maxSpendSats(input.entry, input.imageCount);
  // The figure that has to be funded is the node's admission gate, not the
  // expected cost: it reserves the ceiling up front and returns the rest as
  // change. Gating on the estimate would let a send through that the node then
  // refuses, which is the 402 loop this replaced.
  if (maxSats > 0 && input.walletSats < maxSats) {
    return { state: 'insufficient-funds', needSats: maxSats, haveSats: input.walletSats };
  }

  if (input.confirmSpend) {
    return {
      state: 'confirm',
      maxSats,
      modelName: input.entry?.displayName ?? 'this model',
    };
  }
  return { state: 'ready', maxSats };
}
