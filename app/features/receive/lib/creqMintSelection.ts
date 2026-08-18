/**
 * Derives which trusted mints the standing Cashu payment request ADVERTISES
 * (the Advanced per-mint toggles on the receive screen) and why a mint's
 * toggle is locked out.
 *
 * Two filters compose:
 *  - the user's persisted exclusions (mintStore.creqExcludedMints), and
 *  - when the P2PK lock is active, NUT-11 support — NUT-11 is an OPTIONAL
 *    mint feature and a mint without it treats P2PK-locked proofs as
 *    anyone-can-spend, so advertising such a mint under a lock would be a
 *    silent downgrade (NUT-11 "Caution" paragraph). These mints are forced
 *    off with a reason instead of merely defaulting off.
 *
 * Advertisement-only: excluded mints stay trusted, so payments sent to an
 * older copy of the request still claim.
 */

import { getMintDisplayName } from '@/shared/lib/url';
import { nutSupported, type MintNuts } from '@/shared/lib/cashu/mintNuts';

export interface CreqMintCandidate {
  mintUrl: string;
  mintInfo?: { name?: string; icon_url?: string; nuts?: unknown } | null;
}

interface CreqMintOption {
  mintUrl: string;
  displayName: string;
  /** Mint-advertised icon for the row's MintIcon (falls back internally). */
  iconUrl: string | undefined;
  /** Toggle value — the user wants this mint advertised. */
  enabled: boolean;
  /** The switch cannot be flipped (forced off by P2PK, or the last one on). */
  switchDisabled: boolean;
  /** Row subtitle when the switch is disabled or the mint can't be advertised. */
  reason: string | null;
}

export interface CreqMintSelection {
  options: CreqMintOption[];
  /** Effective advertised list for the displayed encoding (capped). */
  displayMints: string[];
  /** Any trusted mint supports NUT-11 — gates the P2PK lock toggle. */
  hasP2pkCapableMint: boolean;
  /** The lock is requested AND at least one mint can honor it — only then
   *  may the encoding carry the nut10 lock (never lock over incapable-only
   *  mints). */
  p2pkLockEffective: boolean;
  /** True when persisted exclusions turned off every P2PK-capable mint while
   *  the lock is on — the UI should reset those exclusions. */
  needsExclusionReset: boolean;
  advertisedCount: number;
  totalCount: number;
}

export const REASON_NO_P2PK = "Doesn't support P2PK locks";
export const REASON_LAST_MINT = 'At least one mint is required';
export const REASON_OVER_CAP = 'Not included — request is at its mint limit';

export function deriveCreqMintSelection(params: {
  mints: CreqMintCandidate[];
  excluded: Record<string, boolean>;
  p2pkLockActive: boolean;
  maxAdvertised: number;
}): CreqMintSelection {
  const { mints, excluded, p2pkLockActive, maxAdvertised } = params;

  const supportsP2pk = (m: CreqMintCandidate) =>
    nutSupported(m.mintInfo?.nuts as MintNuts | undefined, '11');

  const hasP2pkCapableMint = mints.some(supportsP2pk);
  // A lock over only-incapable mints would advertise anyone-can-spend ecash
  // as locked; with zero capable mints the lock simply doesn't apply (the
  // caller must also drop the nut10 lock from the encoding).
  const p2pkLockEffective = p2pkLockActive && hasP2pkCapableMint;
  const candidates = p2pkLockEffective ? mints.filter(supportsP2pk) : mints;
  const enabledCandidates = candidates.filter((m) => !excluded[m.mintUrl]);
  // Contradictory persisted state (lock on + every capable mint excluded):
  // advertise the capable set anyway — an empty list would mean "any mint",
  // the one thing the lock filter must never produce — and flag the caller
  // to reset the stale exclusions.
  const needsExclusionReset =
    p2pkLockEffective && candidates.length > 0 && enabledCandidates.length === 0;
  const effective = needsExclusionReset ? candidates : enabledCandidates;
  const displayMints = effective.slice(0, maxAdvertised).map((m) => m.mintUrl);
  const advertised = new Set(displayMints);

  const options: CreqMintOption[] = mints.map((m) => {
    const displayName = getMintDisplayName(m.mintUrl, m.mintInfo);
    const iconUrl = m.mintInfo?.icon_url;
    if (p2pkLockEffective && !supportsP2pk(m)) {
      return {
        mintUrl: m.mintUrl,
        displayName,
        iconUrl,
        enabled: false,
        switchDisabled: true,
        reason: REASON_NO_P2PK,
      };
    }
    const enabled = !excluded[m.mintUrl] || needsExclusionReset;
    const isLastEnabled = enabled && effective.length === 1;
    const overCap = enabled && !advertised.has(m.mintUrl);
    return {
      mintUrl: m.mintUrl,
      displayName,
      iconUrl,
      enabled,
      switchDisabled: isLastEnabled,
      reason: isLastEnabled ? REASON_LAST_MINT : overCap ? REASON_OVER_CAP : null,
    };
  });

  return {
    options,
    displayMints,
    hasP2pkCapableMint,
    p2pkLockEffective,
    needsExclusionReset,
    advertisedCount: displayMints.length,
    totalCount: mints.length,
  };
}
