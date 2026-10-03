import { decodePaymentRequestInfo, lockableMintsFromRequest } from 'wallet';

import { cashuLog } from '@/shared/lib/logger';

/**
 * Order the mints we accept so the cap keeps the ones a sender can most likely
 * pay from: the mint we have selected, then the mints we hold funds in, then
 * the rest. A sender can only pay from a mint on this list that it also holds
 * funds in, and the mints we actually use are the ones a contact is likeliest
 * to share. Taking the first five alphabetically advertised whichever mints
 * sorted first, and a wallet with more than five could end up offering none
 * that its sender had money in.
 *
 * Ranks on "funded", not on the amount, so the advertised capability only changes when a mint gains or loses its whole balance.
 */
export function rankAdvertisedMints(params: {
  mints: readonly string[];
  fundedMints: ReadonlySet<string>;
  preferredMint?: string | null;
}): string[] {
  const { fundedMints, preferredMint } = params;
  const rank = (mintUrl: string) =>
    mintUrl === preferredMint ? 0 : fundedMints.has(mintUrl) ? 1 : 2;
  return Array.from(new Set(params.mints.filter(Boolean))).sort(
    (a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)
  );
}

interface ParsedCreq {
  /** Mints the receiver accepts (may be empty). */
  mints: string[];
  /** The 33-byte `02`-prefixed P2PK lock key from `nut10`, or null. */
  lockPubkey33: string | null;
}

/**
 * Decode a peer's `creq` → accepted mints + P2PK lock key. Null if invalid.
 * Decoding is owned by colada's `decodePaymentRequestInfo` (which validates the
 * nut10 P2PK key against `02` + 32-byte hex); this adds the Nut-Drop-shaped
 * `lockPubkey33` naming + logging.
 */
export function parseCreq(creq: string): ParsedCreq | null {
  if (!creq.toLowerCase().startsWith('creq')) {
    cashuLog.debug('cashu.creq.parse.rejected', {
      creqLength: creq.length,
      reason: 'missing-prefix',
    });
    return null;
  }
  const info = decodePaymentRequestInfo(creq);
  if (!info) {
    cashuLog.warn('cashu.creq.parse.failed', { creqLength: creq.length });
    return null;
  }
  const mints = info.mints.filter(Boolean);
  const lockPubkey33 = info.lockP2pkPubkey ?? null;
  cashuLog.debug('cashu.creq.parse.done', {
    creqLength: creq.length,
    mintCount: mints.length,
    hasValidLockPubkey: !!lockPubkey33,
    lockPubkeyLength: lockPubkey33?.length ?? 0,
  });
  return { mints, lockPubkey33 };
}

/**
 * Check request/key compatibility after the wallet directory authenticates
 * identity. This parser alone does not authenticate a peer.
 * Returns the accepted mints when lockable, else null.
 */
export function lockableMintsFromCreq(
  creq: string | undefined,
  nostrPubkeyHex: string | undefined
): string[] | null {
  // The lock gate (nut10 P2PK key === `02` + nostr pubkey) is owned by colada's
  // `lockableMintsFromRequest`; this keeps the Nut-Drop-named entry + logging.
  const mints = lockableMintsFromRequest(creq, nostrPubkeyHex);
  cashuLog.debug('cashu.creq.lockable.result', {
    hasCreq: !!creq,
    creqLength: creq?.length ?? 0,
    hasNostrPubkey: !!nostrPubkeyHex,
    nostrPubkeyLength: nostrPubkeyHex?.length ?? 0,
    lockable: mints !== null,
    mintCount: mints?.length ?? 0,
  });
  return mints;
}

/**
 * Loggable breakdown of how the sender read a peer's creq — answers "did we
 * decode the receiver's creq and which mints did we extract?" at send time.
 * Pure (no side effects); the caller logs the result.
 *  - `creqDecoded` — the base64 NUT-18 request parsed at all.
 *  - `creqMints` — the raw accepted-mint list from the creq (pre-gate).
 *  - `creqLockMatchesNpub` — the `nut10` key equals `02`+npub (the lock gate).
 *  - `receiverMints` — the mints we'll actually consider (null unless lockable).
 */
export function creqParseDiagnostics(peer: { creq?: string; nostrPubkeyHex?: string }): {
  peerHasCreq: boolean;
  creqDecoded: boolean;
  creqMints: string[] | null;
  creqLockMatchesNpub: boolean;
  receiverMints: string[] | null;
} {
  const parsed = peer.creq ? parseCreq(peer.creq) : null;
  const receiverMints = lockableMintsFromCreq(peer.creq, peer.nostrPubkeyHex);
  cashuLog.debug('cashu.creq.diagnostics', {
    peerHasCreq: !!peer.creq,
    creqLength: peer.creq?.length ?? 0,
    peerHasNostrPubkey: !!peer.nostrPubkeyHex,
    nostrPubkeyLength: peer.nostrPubkeyHex?.length ?? 0,
    creqDecoded: !!parsed,
    creqMintCount: parsed?.mints.length ?? 0,
    creqLockMatchesNpub: receiverMints !== null,
    receiverMintCount: receiverMints?.length ?? 0,
  });
  return {
    peerHasCreq: !!peer.creq,
    creqDecoded: !!parsed,
    creqMints: parsed?.mints ?? null,
    creqLockMatchesNpub: receiverMints !== null,
    receiverMints,
  };
}
