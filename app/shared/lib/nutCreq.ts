import { PaymentRequest, type NUT10Option } from '@cashu/cashu-ts';
import { decodePaymentRequestInfo, lockableMintsFromRequest } from 'wallet';

import { CASHU_P2PK_PUBKEY_RE, type CashuP2pkPubkey } from '@/shared/lib/ids';
import { cashuLog } from '@/shared/lib/logger';

/**
 * NUT-18 payment request (`creq…`) used as Nut Drop's capability + mint signal,
 * replacing the earlier `:nut` flag. A receiver advertises a *standing* request
 * (no amount, no transport, reusable) carrying:
 *  - the **mints it accepts** — so a sender never locks a token to a mint the
 *    receiver can't redeem at (the numo mint-advertisement pattern), and
 *  - a **P2PK lock** (`nut10`) to its identity key.
 *
 * coco doesn't build standing requests, so we build/parse via `@cashu/cashu-ts`
 * directly. `creqA…` is URL-safe base64 (no `:`), so it rides inside the
 * `[FAVORITED]:<npub>:<creq>` favorite. It exceeds 255 bytes — that's why the
 * favorite needs the extended private-message length.
 */

/** Cap the advertised mint list so the eager-favorite stays a sane size. */
const MAX_ADVERTISED_MINTS = 5;

/**
 * Build our standing `creq` from the mints we accept + our P2PK key (branded —
 * produced by `cashuP2pkPubkeyFromNostrHex`, the one owner of the `02`+x-only
 * lift). Returns null if we have no mint or the key is malformed (→ caller
 * falls back to no creq, i.e. not advertised). The shape re-check here accepts
 * the general NUT-11 `02`/`03` compressed form as defense in depth.
 */
export function buildStandingCreq(params: {
  mints: string[];
  pubkey33: CashuP2pkPubkey;
}): string | null {
  const mints = Array.from(new Set(params.mints.filter(Boolean))).slice(0, MAX_ADVERTISED_MINTS);
  const base = {
    inputMintCount: params.mints.length,
    advertisedMintCount: mints.length,
    pubkeyLength: params.pubkey33.length,
    pubkeyValid: CASHU_P2PK_PUBKEY_RE.test(params.pubkey33),
  };
  if (mints.length === 0) {
    cashuLog.info('cashu.creq.build.skipped', { ...base, reason: 'no-mints' });
    return null;
  }
  if (!CASHU_P2PK_PUBKEY_RE.test(params.pubkey33)) {
    cashuLog.warn('cashu.creq.build.skipped', { ...base, reason: 'invalid-p2pk-pubkey' });
    return null;
  }
  try {
    const request = new PaymentRequest(
      undefined, // transports — delivery is the BLE DM, not Nostr/HTTP
      undefined, // id
      undefined, // amount — standing/reusable
      'sat',
      mints,
      undefined, // description
      false, // singleUse
      { kind: 'P2PK', data: params.pubkey33, tags: [] } satisfies NUT10Option
    );
    const creq = request.toEncodedRequest();
    cashuLog.info('cashu.creq.build.done', {
      ...base,
      creqLength: creq.length,
    });
    return creq;
  } catch {
    cashuLog.warn('cashu.creq.build.failed', base);
    return null;
  }
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
 * A peer is cashu-capable/lockable iff its favorite carried a valid `creq`
 * whose `nut10` P2PK key matches its announced identity (`02`+nostrPubkeyHex).
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
