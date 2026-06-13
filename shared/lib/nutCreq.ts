import { PaymentRequest, decodePaymentRequest, type NUT10Option } from '@cashu/cashu-ts';

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
const P2PK_PUBKEY_RE = /^02[0-9a-f]{64}$/i;

/**
 * Build our standing `creq` from the mints we accept + our P2PK key
 * (`02`-prefixed x-only Nostr key). Returns null if we have no mint or the key
 * is malformed (→ caller falls back to no creq, i.e. not advertised).
 */
export function buildStandingCreq(params: { mints: string[]; pubkey33: string }): string | null {
  const mints = Array.from(new Set(params.mints.filter(Boolean))).slice(0, MAX_ADVERTISED_MINTS);
  if (mints.length === 0) return null;
  if (!P2PK_PUBKEY_RE.test(params.pubkey33)) return null;
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
    return request.toEncodedRequest();
  } catch {
    return null;
  }
}

interface ParsedCreq {
  /** Mints the receiver accepts (may be empty). */
  mints: string[];
  /** The 33-byte `02`-prefixed P2PK lock key from `nut10`, or null. */
  lockPubkey33: string | null;
}

/** Decode a peer's `creq` → accepted mints + P2PK lock key. Null if invalid. */
export function parseCreq(creq: string): ParsedCreq | null {
  if (!creq.toLowerCase().startsWith('creq')) return null;
  try {
    const request = decodePaymentRequest(creq);
    const mints = (request.mints ?? []).filter(Boolean);
    let lockPubkey33: string | null = null;
    const nut10 = request.nut10;
    if (nut10 && nut10.kind?.toUpperCase() === 'P2PK' && typeof nut10.data === 'string') {
      lockPubkey33 = P2PK_PUBKEY_RE.test(nut10.data) ? nut10.data : null;
    }
    return { mints, lockPubkey33 };
  } catch {
    return null;
  }
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
  if (!creq || !nostrPubkeyHex) return null;
  const parsed = parseCreq(creq);
  if (!parsed) return null;
  const expected = `02${nostrPubkeyHex}`.toLowerCase();
  if (!parsed.lockPubkey33 || parsed.lockPubkey33.toLowerCase() !== expected) return null;
  return parsed.mints;
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
  return {
    peerHasCreq: !!peer.creq,
    creqDecoded: !!parsed,
    creqMints: parsed?.mints ?? null,
    creqLockMatchesNpub: receiverMints !== null,
    receiverMints,
  };
}
