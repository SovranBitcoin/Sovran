// ---------------------------------------------------------------------------
// The lock a send is asked to apply.
//
// A key alone cannot express the only question users actually ask about a
// locked payment — "can I get this back if they never claim it?" — so the send
// path carries terms, not a string. Normalising them in one place keeps the
// two shapes NUT-11 forbids from ever reaching a mint.
// ---------------------------------------------------------------------------

import { logger } from "../logger";
import { P2PK_PUBKEY_RE } from "./secret";

export interface P2pkLockSpec {
  /** 33-byte compressed secp256k1 hex, `02` or `03`. */
  pubkey: string;
  /**
   * Unix SECONDS after which `refundKeys` may spend. Absent means no
   * `locktime` tag at all: the lock never opens, and the send can never be
   * taken back.
   */
  locktimeSec?: number;
  /**
   * Keys allowed to spend once `locktimeSec` passes. Must be non-empty when a
   * locktime is set, and absent when it is not.
   */
  refundKeys?: string[];
}

/** Anything that might describe a locked send, however it was seeded. */
interface LockedContext {
  p2pkLock?: P2pkLockSpec;
  p2pkLockPubkey?: string;
}

function validKey(value: string | undefined): boolean {
  return typeof value === "string" && P2PK_PUBKEY_RE.test(value);
}

/**
 * Normalise a lock into the one shape the send path may act on, or `null` when
 * it is malformed. Callers treat `null` as a hard error rather than dropping
 * the lock: silently sending unlocked what the user asked to lock is the one
 * failure that cannot be undone afterwards.
 *
 * Two NUT-11 shapes are refused outright:
 *
 *   - a locktime with no refund keys — after it passes, ANYONE holding the
 *     token can spend it. That is strictly worse than not locking at all,
 *     because the sender believes the opposite.
 *   - refund keys with no locktime — the refund path only opens after a
 *     locktime, so those keys can never be used. cashu-ts throws on this too.
 */
export function normalizeP2pkLock(
  input: P2pkLockSpec | string | undefined | null,
): P2pkLockSpec | null {
  if (!input) return null;
  const spec: P2pkLockSpec =
    typeof input === "string" ? { pubkey: input } : input;

  if (!validKey(spec.pubkey)) {
    logger.warn("p2pk.lock.invalidPubkey", {
      pubkeyLength: spec.pubkey?.length ?? 0,
    });
    return null;
  }

  const refundKeys = spec.refundKeys?.map((key) => key.toLowerCase()) ?? [];
  if (refundKeys.some((key) => !validKey(key))) {
    logger.warn("p2pk.lock.invalidRefundKey", {
      refundKeyCount: refundKeys.length,
    });
    return null;
  }

  const locktimeSec = spec.locktimeSec;
  const hasLocktime =
    typeof locktimeSec === "number" &&
    Number.isInteger(locktimeSec) &&
    locktimeSec > 0;
  if (locktimeSec !== undefined && !hasLocktime) {
    logger.warn("p2pk.lock.invalidLocktime", { hasLocktime: false });
    return null;
  }

  if (hasLocktime && refundKeys.length === 0) {
    logger.warn("p2pk.lock.locktimeWithoutRefund");
    return null;
  }
  if (!hasLocktime && refundKeys.length > 0) {
    logger.warn("p2pk.lock.refundWithoutLocktime");
    return null;
  }

  return {
    pubkey: spec.pubkey.toLowerCase(),
    ...(hasLocktime ? { locktimeSec } : {}),
    ...(refundKeys.length > 0 ? { refundKeys } : {}),
  };
}

/**
 * Whether a flow is sending locked ecash. One predicate, because "is this
 * locked" decides three unrelated things — no offline send, no local-proof
 * composition, and a mint swap — and they must never disagree.
 */
export function isLockedSend(context: LockedContext): boolean {
  return !!(context.p2pkLock ?? context.p2pkLockPubkey);
}
