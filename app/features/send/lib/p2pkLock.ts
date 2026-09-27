/**
 * Reading a lock off a flow's entry. Presence and the key itself are separate
 * questions: most callers only need to know a lock is there, and must not be
 * handed the key to format or log.
 */

type P2PKLockState = {
  p2pkLockPubkey?: unknown;
  p2pkPubkey?: unknown;
  p2pkLock?: unknown;
  metadata?: Record<string, unknown> | null;
};

/** Presence-only detector; it never returns or formats the public lock key. */
export function hasP2PKLock(state: P2PKLockState | null | undefined): boolean {
  if (!state) return false;
  if (typeof state.p2pkLockPubkey === 'string' && state.p2pkLockPubkey.length > 0) return true;
  if (state.p2pkPubkey != null) return true;
  const metadata = state.metadata;
  return Boolean(
    metadata &&
    ((typeof metadata.p2pkLockPubkey === 'string' && metadata.p2pkLockPubkey.length > 0) ||
      metadata.p2pkPubkey != null)
  );
}

/**
 * The key a flow was SEEDED with (a Nut Drop, a scanned wallet receive key),
 * read the way colada's availability reads it. Null when the flow arrived
 * unlocked.
 */
export function seededLockKey(entry: P2PKLockState | null | undefined): string | null {
  if (!entry) return null;
  if (typeof entry.p2pkLockPubkey === 'string' && entry.p2pkLockPubkey.length > 0) {
    return entry.p2pkLockPubkey;
  }
  const terms = entry.p2pkLock;
  if (terms && typeof terms === 'object' && 'pubkey' in terms) {
    const pubkey = (terms as { pubkey?: unknown }).pubkey;
    if (typeof pubkey === 'string' && pubkey.length > 0) return pubkey;
  }
  return null;
}
