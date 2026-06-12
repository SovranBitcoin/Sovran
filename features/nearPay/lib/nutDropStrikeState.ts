/**
 * Pure derivation of the NearPay lightning-strike map from the Nut Drop
 * redeem queue. No timers, no store access — the hook feeds snapshots in and
 * schedules a re-derive for `nextDeadline`; this module decides what each
 * sender's avatar should be doing.
 *
 * Lifecycle per peer:
 *   live entry (pending/redeeming)        → 'active'  (crackle)
 *   all tracked entries redeemed + ≥MIN   → 'success' (resolve pulse, then gone)
 *   all terminal but not redeemed         → 'fading'  (quiet fade, then gone)
 *   still active at MAX cap               → 'fading'  (backoff-stuck entries)
 *
 * Entries that were already terminal when the screen mounted (the baseline
 * set) never animate — reopening the screen after a redemption shows nothing.
 */

export type StrikeStatus = 'active' | 'success' | 'fading';

export interface StrikeState {
  status: StrikeStatus;
  /** When this peer's strike first became active (UNIX ms). */
  activatedAt: number;
  /** 'ambient' when the entry was already mid-redemption at first snapshot. */
  entrance: 'strike' | 'ambient';
  /** When the current status was entered (UNIX ms) — drives removal. */
  statusChangedAt: number;
  /**
   * Sum of this sender's redeemed (non-baseline) amounts — present on
   * 'success' states only. Feeds the receive celebration's amount reveal.
   */
  redeemedAmount?: number;
  /** Unit of `redeemedAmount` (first seen; mesh drops are sat-only today). */
  unit?: string;
}

export interface StrikeQueueEntry {
  status: 'pending' | 'redeeming' | 'redeemed' | 'spent' | 'untrusted-mint' | 'failed';
  senderPeerID?: string;
  receivedAt: number;
  amount: number;
  unit: string;
}

/** Minimum visible strike duration — instant redemptions still get a beat. */
export const STRIKE_MIN_VISIBLE_MS = 1400;
/** Hard cap — backoff-stuck entries stop strobing here. */
export const STRIKE_MAX_ACTIVE_MS = 8000;
/** How long the success resolve stays mounted before removal. */
export const STRIKE_SUCCESS_LINGER_MS = 900;
/** How long the fade-out stays mounted before removal. */
export const STRIKE_FADE_LINGER_MS = 350;

const LIVE_STATUSES = new Set(['pending', 'redeeming']);
const FAILURE_STATUSES = new Set(['spent', 'untrusted-mint', 'failed']);

export interface DeriveStrikeMapInput {
  entries: Record<string, StrikeQueueEntry>;
  prev: ReadonlyMap<string, StrikeState>;
  /** Token hashes already terminal when the screen mounted — never animate. */
  baselineTerminalHashes: ReadonlySet<string>;
  /** Token hashes already LIVE at the first snapshot — ambient entrance. */
  baselineLiveHashes: ReadonlySet<string>;
  now: number;
}

interface DeriveStrikeMapResult {
  map: Map<string, StrikeState>;
  /** Earliest future time (UNIX ms) at which the map must be re-derived, or null. */
  nextDeadline: number | null;
}

export function deriveStrikeMap(input: DeriveStrikeMapInput): DeriveStrikeMapResult {
  const { entries, prev, baselineTerminalHashes, baselineLiveHashes, now } = input;

  // Group the queue by sender, ignoring baseline-terminal entries and
  // entries with no sender attribution.
  const byPeer = new Map<
    string,
    {
      live: number;
      redeemed: number;
      failed: number;
      ambient: boolean;
      redeemedAmount: number;
      unit: string | null;
    }
  >();
  for (const [hash, entry] of Object.entries(entries)) {
    if (!entry.senderPeerID) continue;
    if (baselineTerminalHashes.has(hash)) continue;
    const bucket = byPeer.get(entry.senderPeerID) ?? {
      live: 0,
      redeemed: 0,
      failed: 0,
      ambient: false,
      redeemedAmount: 0,
      unit: null,
    };
    if (LIVE_STATUSES.has(entry.status)) {
      bucket.live += 1;
      if (baselineLiveHashes.has(hash)) bucket.ambient = true;
    } else if (entry.status === 'redeemed') {
      bucket.redeemed += 1;
      bucket.redeemedAmount += entry.amount;
      if (bucket.unit === null) bucket.unit = entry.unit;
    } else if (FAILURE_STATUSES.has(entry.status)) {
      bucket.failed += 1;
    }
    byPeer.set(entry.senderPeerID, bucket);
  }

  const map = new Map<string, StrikeState>();
  let nextDeadline: number | null = null;
  const propose = (deadline: number) => {
    if (deadline <= now) return;
    nextDeadline = nextDeadline === null ? deadline : Math.min(nextDeadline, deadline);
  };

  for (const [peerID, bucket] of byPeer) {
    const previous = prev.get(peerID);
    // A success/fading state that already ran its linger is gone for good —
    // don't resurrect it from the same (now stale) queue entries.
    if (previous && previous.status !== 'active') {
      const linger =
        previous.status === 'success' ? STRIKE_SUCCESS_LINGER_MS : STRIKE_FADE_LINGER_MS;
      if (now - previous.statusChangedAt >= linger) continue;
      map.set(peerID, previous);
      propose(previous.statusChangedAt + linger);
      continue;
    }

    const activatedAt = previous?.activatedAt ?? now;
    const entrance = previous?.entrance ?? (bucket.ambient ? 'ambient' : 'strike');
    const activeFor = now - activatedAt;

    if (bucket.live > 0) {
      if (activeFor >= STRIKE_MAX_ACTIVE_MS) {
        map.set(peerID, { status: 'fading', activatedAt, entrance, statusChangedAt: now });
        propose(now + STRIKE_FADE_LINGER_MS);
      } else {
        map.set(peerID, { status: 'active', activatedAt, entrance, statusChangedAt: activatedAt });
        propose(activatedAt + STRIKE_MAX_ACTIVE_MS);
      }
      continue;
    }

    if (bucket.redeemed > 0 && bucket.failed === 0) {
      if (!previous) continue; // redeemed without ever being tracked live — stale
      if (activeFor < STRIKE_MIN_VISIBLE_MS) {
        // Hold the crackle until the minimum beat has played.
        map.set(peerID, { status: 'active', activatedAt, entrance, statusChangedAt: activatedAt });
        propose(activatedAt + STRIKE_MIN_VISIBLE_MS);
      } else {
        map.set(peerID, {
          status: 'success',
          activatedAt,
          entrance,
          statusChangedAt: now,
          redeemedAmount: bucket.redeemedAmount,
          ...(bucket.unit !== null ? { unit: bucket.unit } : {}),
        });
        propose(now + STRIKE_SUCCESS_LINGER_MS);
      }
      continue;
    }

    if (bucket.failed > 0 && previous) {
      map.set(peerID, { status: 'fading', activatedAt, entrance, statusChangedAt: now });
      propose(now + STRIKE_FADE_LINGER_MS);
    }
  }

  // Carry forward lingering success/fading states whose peers vanished from
  // the queue grouping (e.g. entries pruned mid-linger).
  for (const [peerID, state] of prev) {
    if (map.has(peerID) || state.status === 'active') continue;
    const linger = state.status === 'success' ? STRIKE_SUCCESS_LINGER_MS : STRIKE_FADE_LINGER_MS;
    if (now - state.statusChangedAt < linger) {
      map.set(peerID, state);
      propose(state.statusChangedAt + linger);
    }
  }

  return { map, nextDeadline };
}
