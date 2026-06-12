import type { PeerLayoutConfig } from '@/features/nearPay/lib/peerLayout';
import { spacing } from '@/shared/styles/tokens';

/**
 * Adaptive radar avatar sizing. With few peers around (the typical Nut Drop
 * session is 1–5 people) the honeycomb renders hero-sized avatars; past the
 * crowding threshold it steps back to the original compact size. Two
 * quantized steps — never a continuous scale — so `Avatar`'s layout-prop
 * `size` changes at most once per threshold crossing and the existing
 * rebalance spring masks the single re-layout.
 */

export type PeerFieldSizingStep = 'hero' | 'standard';

export interface PeerFieldSizing {
  step: PeerFieldSizingStep;
  avatarSize: number;
  nodeWidth: number;
  nodeHeight: number;
  /** Avatar's offset from the node top (label band sits below). */
  avatarTop: number;
  /** Avatar center Y inside the node — drives the scale-origin correction. */
  avatarCenterY: number;
  edgeScaleFalloff: number;
  labelFontSize: number;
  bearerBadgeSize: number;
  bearerBadgeIconSize: number;
}

/** Enter (or stay) hero at this many registry entries or fewer. */
export const PEER_FIELD_HERO_MAX_PEERS = 6;
/** Leave hero only at this many or more — the 7-peer gap is hysteresis. */
export const PEER_FIELD_STANDARD_MIN_PEERS = 8;

/**
 * Step transition with hysteresis so peers blinking in and out around the
 * threshold never flap the grid size. Feed the layout REGISTRY length
 * (visible + exiting) — an exit animation must not trigger a resize
 * mid-flight.
 */
export function getPeerFieldSizingStep(
  registryCount: number,
  prevStep: PeerFieldSizingStep | null
): PeerFieldSizingStep {
  if (prevStep === 'hero') {
    return registryCount >= PEER_FIELD_STANDARD_MIN_PEERS ? 'standard' : 'hero';
  }
  if (prevStep === 'standard') {
    return registryCount <= PEER_FIELD_HERO_MAX_PEERS ? 'hero' : 'standard';
  }
  return registryCount <= PEER_FIELD_HERO_MAX_PEERS ? 'hero' : 'standard';
}

/** Horizontal label/touch slop on each node beyond the avatar (76 − 48). */
const NODE_HORIZONTAL_PADDING = spacing['2xl'] + spacing.xs;
/** Vertical band under the avatar for the name label (74 − 48). */
const NODE_LABEL_BAND = spacing['2xl'] + 2;

function buildSizing(
  step: PeerFieldSizingStep,
  avatarSize: number,
  labelFontSize: number,
  bearerBadgeSize: number,
  bearerBadgeIconSize: number
): PeerFieldSizing {
  const avatarTop = spacing.xs;
  return {
    step,
    avatarSize,
    nodeWidth: avatarSize + NODE_HORIZONTAL_PADDING,
    nodeHeight: avatarSize + NODE_LABEL_BAND,
    avatarTop,
    avatarCenterY: avatarTop + avatarSize / 2,
    edgeScaleFalloff: avatarSize * 2,
    labelFontSize,
    bearerBadgeSize,
    bearerBadgeIconSize,
  };
}

/**
 * Module singletons — reference equality is the memo-comparator contract for
 * `PeerNode` and the layout-config memo.
 */
const SIZINGS: Record<PeerFieldSizingStep, PeerFieldSizing> = {
  // The originally shipped radar constants.
  standard: buildSizing('standard', 48, 10, 18, 11),
  hero: buildSizing('hero', 72, 11, 20, 12),
};

export function getPeerFieldSizing(step: PeerFieldSizingStep): PeerFieldSizing {
  return SIZINGS[step];
}

// Size-independent honeycomb tuning (formerly NearPayScreen's
// PEER_LAYOUT_CONFIG constants). Spacing self-adapts to avatarSize inside
// peerLayout's buildHoneycombSlot (avatarSpacing = avatarSize + gap).
const PEER_AVATAR_GAP = spacing.sm;
const PEER_AVATAR_SPACIOUS_GAP = spacing['4xl'];
const PEER_AVATAR_SPACIOUS_COUNT = 7;
const PEER_AVATAR_DENSE_COUNT = 31;
const PEER_AVATAR_SPACING_CAP_COUNT = 20;
const PEER_CANDIDATE_HEADER_AVOIDANCE = spacing['4xl'] + spacing['3xl'];
const FIELD_EDGE_PADDING = 0;
const EDGE_BOUNDARY_SCALE = 0.9;
const EDGE_TRANSLATION_STRENGTH = 1;
const MIN_VISIBLE_PEER_SCALE = 0.16;
const PEER_LABEL_MIN_SCALE = 0.58;

export function buildPeerLayoutConfigForSizing(
  sizing: PeerFieldSizing,
  preferredBottomInset: number
): PeerLayoutConfig {
  return {
    nodeWidth: sizing.nodeWidth,
    nodeHeight: sizing.nodeHeight,
    avatarSize: sizing.avatarSize,
    avatarGap: PEER_AVATAR_GAP,
    spaciousAvatarGap: PEER_AVATAR_SPACIOUS_GAP,
    spaciousPeerCount: PEER_AVATAR_SPACIOUS_COUNT,
    densePeerCount: PEER_AVATAR_DENSE_COUNT,
    spacingCapPeerCount: PEER_AVATAR_SPACING_CAP_COUNT,
    preferredTopInset: PEER_CANDIDATE_HEADER_AVOIDANCE,
    preferredBottomInset,
    edgePadding: FIELD_EDGE_PADDING,
    edgeScaleFalloff: sizing.edgeScaleFalloff,
    edgeBoundaryScale: EDGE_BOUNDARY_SCALE,
    edgeTranslationStrength: EDGE_TRANSLATION_STRENGTH,
    minVisibleScale: MIN_VISIBLE_PEER_SCALE,
    labelMinScale: PEER_LABEL_MIN_SCALE,
  };
}
