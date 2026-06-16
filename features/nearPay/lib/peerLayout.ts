export const NEAR_PAY_EXIT_ANIMATION_MS = 460;

export type PeerLayoutPhase = 'visible' | 'exiting';

export interface NearPayLayoutPeer {
  peerID: string;
  nickname: string;
  isConnected: boolean;
  hasDirectLink: boolean;
  lastSeen: number;
  name: string;
  avatarUrl?: string | null;
  /**
   * True once the peer's favorite carried a valid `creq` (identity + accepted
   * mints) — i.e. a Sovran peer we can send an extended token DM to. False ⇒
   * stock/vanilla peer or one we haven't exchanged identity with yet.
   * Requires `nostrPubkeyHex`, `creq`, and a matching `nut10` lock key.
   */
  lockable: boolean;
  /**
   * The peer's x-only Nostr pubkey (64-hex), learned via the favorite exchange.
   * Use it for the kind-0 profile and "02"-prefix it for the NUT-11 P2PK lock
   * target.
   */
  nostrPubkeyHex?: string;
  /**
   * The peer's standing NUT-18 payment request (`creq…`) — accepted mints +
   * P2PK lock key. Decoded to verify the lock key and pick a shared mint.
   */
  creq?: string;
  /**
   * Identity seed for identicons/word-pair names. For Sovran peers it is the
   * x-only Nostr pubkey (real identity); for stock peers the announced noise
   * key (stable pseudonym), with the 16-hex peerID as final fallback.
   */
  identitySeed: string;
  /**
   * True while the peer's kind-0 profile fetch is in flight — the avatar
   * shows the loading state instead of flashing the identicon fallback.
   */
  profileLoading: boolean;
}

export interface PeerLayoutRegistryEntry {
  peer: NearPayLayoutPeer;
  phase: PeerLayoutPhase;
  slotIndex: number;
  exitStartedAt?: number;
}

export interface PeerLayoutSize {
  width: number;
  height: number;
}

export interface PeerLayoutConfig {
  nodeWidth: number;
  nodeHeight: number;
  avatarSize: number;
  avatarGap: number;
  spaciousAvatarGap: number;
  spaciousPeerCount: number;
  densePeerCount: number;
  spacingCapPeerCount: number;
  preferredTopInset: number;
  preferredBottomInset: number;
  edgePadding: number;
  edgeScaleFalloff: number;
  edgeBoundaryScale: number;
  edgeTranslationStrength: number;
  minVisibleScale: number;
  labelMinScale: number;
}

export interface PeerLayoutTarget extends PeerLayoutRegistryEntry {
  x: number;
  y: number;
  scale: number;
  entryX: number;
  entryY: number;
  exitX: number;
  exitY: number;
}

interface PeerLayoutPanOffset {
  x: number;
  y: number;
}

interface PeerLayoutPanBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface PeerLayoutOverviewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface PeerLayoutOverviewTransform {
  translateX: number;
  translateY: number;
  scale: number;
}

interface PeerViewportPresentation {
  x: number;
  y: number;
  centerX: number;
  centerY: number;
  scale: number;
  avatarOpacity: number;
  labelOpacity: number;
}

const HEX_VERTICAL_RATIO = Math.sqrt(3) / 2;
const HEX_RING_COORD_CACHE = new Map<number, HexCoord[]>();

function sortNearPayPeers(peers: readonly NearPayLayoutPeer[]): NearPayLayoutPeer[] {
  return [...peers].sort((a, b) => {
    if (a.hasDirectLink !== b.hasDirectLink) return a.hasDirectLink ? -1 : 1;
    if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
    if (a.lastSeen !== b.lastSeen) return b.lastSeen - a.lastSeen;
    return a.peerID.localeCompare(b.peerID);
  });
}

export function reconcilePeerLayoutRegistry(
  previous: readonly PeerLayoutRegistryEntry[],
  incomingPeers: readonly NearPayLayoutPeer[],
  now: number
): PeerLayoutRegistryEntry[] {
  const incomingById = new Map(incomingPeers.map((peer) => [peer.peerID, peer]));
  const previousIds = new Set(previous.map((entry) => entry.peer.peerID));
  const next: PeerLayoutRegistryEntry[] = [];
  const usedSlotIndexes = new Set<number>();

  for (const entry of previous) {
    const slotIndex = normalizeSlotIndex(entry.slotIndex, usedSlotIndexes);
    const stableEntry = { ...entry, slotIndex };
    const incoming = incomingById.get(entry.peer.peerID);
    if (incoming) {
      next.push({ peer: incoming, phase: 'visible', slotIndex });
      usedSlotIndexes.add(slotIndex);
      continue;
    }
    if (entry.phase === 'exiting') {
      if (now - (entry.exitStartedAt ?? now) < NEAR_PAY_EXIT_ANIMATION_MS) {
        next.push(stableEntry);
        usedSlotIndexes.add(slotIndex);
      }
      continue;
    }
    next.push({ ...stableEntry, phase: 'exiting', exitStartedAt: now });
    usedSlotIndexes.add(slotIndex);
  }

  const newPeers = sortNearPayPeers(incomingPeers).filter((peer) => !previousIds.has(peer.peerID));
  for (const peer of newPeers) {
    const slotIndex = getFirstAvailableSlotIndex(usedSlotIndexes);
    next.push({ peer, phase: 'visible', slotIndex });
    usedSlotIndexes.add(slotIndex);
  }

  return next;
}

export function pruneExitedPeerLayoutRegistry(
  entries: readonly PeerLayoutRegistryEntry[],
  now: number
): PeerLayoutRegistryEntry[] {
  return entries.filter(
    (entry) =>
      entry.phase !== 'exiting' || now - (entry.exitStartedAt ?? now) < NEAR_PAY_EXIT_ANIMATION_MS
  );
}

export function buildPeerLayoutTargets(
  entries: readonly PeerLayoutRegistryEntry[],
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): PeerLayoutTarget[] {
  if (size.width <= 0 || size.height <= 0) return [];
  const centerX = size.width / 2 - config.nodeWidth / 2;
  const centerY = size.height / 2 - config.nodeHeight / 2;

  if (entries.length === 1) {
    return entries.map((entry) => ({
      ...entry,
      x: centerX,
      y: centerY,
      scale: 1,
      ...stationaryPeerPosition(centerX, centerY),
    }));
  }

  const slotCount = entries.reduce((count, entry) => Math.max(count, entry.slotIndex + 1), 0);
  const slots = getCachedPeerLayoutSlots(slotCount, size, config);

  return entries.map((entry) => {
    const slot = slots[entry.slotIndex] ?? { x: centerX, y: centerY, scale: 1 };
    return {
      ...entry,
      ...slot,
      ...stationaryPeerPosition(slot.x, slot.y),
    };
  });
}

interface HexCoord {
  q: number;
  r: number;
}

interface PeerLayoutOffset {
  x: number;
  y: number;
}

interface PeerLayoutSlot {
  x: number;
  y: number;
  scale: number;
}

interface PeerLayoutSlotCandidate extends PeerLayoutSlot {
  unitOffset: PeerLayoutOffset;
}

const PEER_LAYOUT_SLOT_CACHE_MAX_ENTRIES = 48;
const PEER_LAYOUT_SLOT_CACHE = new Map<string, readonly PeerLayoutSlot[]>();

function buildPeerLayoutSlots(
  count: number,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): PeerLayoutSlot[] {
  const distributedSlots = buildDistributedOnScreenHoneycombSlots(count, size, config);
  if (distributedSlots.length >= count) return distributedSlots.slice(0, count);

  return [
    ...distributedSlots,
    ...buildCompactOverflowSlots(
      count - distributedSlots.length,
      count,
      distributedSlots,
      size,
      config
    ),
  ];
}

function getCachedPeerLayoutSlots(
  count: number,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): readonly PeerLayoutSlot[] {
  const key = getPeerLayoutSlotCacheKey(count, size, config);
  const cached = PEER_LAYOUT_SLOT_CACHE.get(key);
  if (cached) {
    PEER_LAYOUT_SLOT_CACHE.delete(key);
    PEER_LAYOUT_SLOT_CACHE.set(key, cached);
    return cached;
  }

  const slots = buildPeerLayoutSlots(count, size, config);
  PEER_LAYOUT_SLOT_CACHE.set(key, slots);
  if (PEER_LAYOUT_SLOT_CACHE.size > PEER_LAYOUT_SLOT_CACHE_MAX_ENTRIES) {
    const oldestKey = PEER_LAYOUT_SLOT_CACHE.keys().next().value;
    if (oldestKey) PEER_LAYOUT_SLOT_CACHE.delete(oldestKey);
  }
  return slots;
}

function getPeerLayoutSlotCacheKey(
  count: number,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): string {
  return [
    count,
    size.width,
    size.height,
    config.nodeWidth,
    config.nodeHeight,
    config.avatarSize,
    config.avatarGap,
    config.spaciousAvatarGap,
    config.spaciousPeerCount,
    config.densePeerCount,
    config.spacingCapPeerCount,
    config.preferredTopInset,
    config.preferredBottomInset,
    config.edgePadding,
    config.edgeScaleFalloff,
    config.edgeBoundaryScale,
    config.edgeTranslationStrength,
    config.minVisibleScale,
    config.labelMinScale,
  ].join('|');
}

function buildDistributedOnScreenHoneycombSlots(
  count: number,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): PeerLayoutSlot[] {
  if (count <= 0) return [];

  const candidateCount = Math.max(count * 4, 160);
  const roomyCandidates = buildHoneycombSlotCandidates(
    candidateCount,
    size,
    config,
    config.spaciousPeerCount
  );
  const onScreenCandidates = roomyCandidates
    .filter((slot) => slotFullyFits(slot, size, config))
    .map((candidate) => ({
      ...buildHoneycombSlot(candidate.unitOffset, size, config, config.spacingCapPeerCount),
      unitOffset: candidate.unitOffset,
    }));
  const preferredCandidates = onScreenCandidates.filter((slot) =>
    slotFitsPreferredVerticalBand(slot, size, config)
  );
  const deferredCandidates = onScreenCandidates.filter(
    (slot) => !slotFitsPreferredVerticalBand(slot, size, config)
  );
  const topDeferredCandidates = deferredCandidates.filter(
    (slot) =>
      slotOverlapsPreferredTopBand(slot, config) &&
      !slotOverlapsPreferredBottomBand(slot, size, config)
  );
  const orderedPreferredCandidates = orderSlotsByDistantSpread(preferredCandidates, size, config);
  const orderedTopDeferredCandidates = orderSlotsByDistantSpread(
    topDeferredCandidates,
    size,
    config,
    orderedPreferredCandidates
  );
  const orderedCandidates = [...orderedPreferredCandidates, ...orderedTopDeferredCandidates];

  return orderedCandidates.map((candidate) =>
    buildHoneycombSlot(candidate.unitOffset, size, config, count)
  );
}

function buildCompactOverflowSlots(
  neededCount: number,
  totalCount: number,
  featuredSlots: readonly PeerLayoutSlot[],
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): PeerLayoutSlot[] {
  const selectedCenters = featuredSlots.map((slot) => slotCenter(slot, config));
  const minSeparation = config.avatarSize + getPeerAvatarGap(totalCount, config) * 0.35;
  const candidateCount = Math.max(totalCount * 4, 160, featuredSlots.length + neededCount);
  const candidates = buildHoneycombBaseSlots(candidateCount, size, config, totalCount);
  const preferredOverflowCandidates = candidates.filter(
    (candidate) => !slotOverlapsPreferredBottomBand(candidate, size, config)
  );
  const bottomOverflowCandidates = candidates.filter((candidate) =>
    slotOverlapsPreferredBottomBand(candidate, size, config)
  );
  const overflowSlots: PeerLayoutSlot[] = [];

  for (const candidateGroup of [preferredOverflowCandidates, bottomOverflowCandidates]) {
    for (const candidate of candidateGroup) {
      const center = slotCenter(candidate, config);
      const tooClose = selectedCenters.some(
        (selectedCenter) => distanceBetween(center, selectedCenter) < minSeparation
      );
      if (tooClose) continue;
      overflowSlots.push(candidate);
      selectedCenters.push(center);
      if (overflowSlots.length === neededCount) return overflowSlots;
    }
  }

  for (const candidateGroup of [preferredOverflowCandidates, bottomOverflowCandidates]) {
    for (const candidate of candidateGroup) {
      const center = slotCenter(candidate, config);
      const duplicate = selectedCenters.some(
        (selectedCenter) => distanceBetween(center, selectedCenter) < 1
      );
      if (duplicate) continue;
      overflowSlots.push(candidate);
      selectedCenters.push(center);
      if (overflowSlots.length === neededCount) return overflowSlots;
    }
  }

  return overflowSlots;
}

function slotCenter(
  slot: Pick<PeerLayoutSlot, 'x' | 'y'>,
  config: PeerLayoutConfig
): PeerLayoutOffset {
  return {
    x: slot.x + config.nodeWidth / 2,
    y: slot.y + config.nodeHeight / 2,
  };
}

function distanceBetween(a: PeerLayoutOffset, b: PeerLayoutOffset): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function slotFullyFits(
  slot: Pick<PeerLayoutSlot, 'x' | 'y'>,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): boolean {
  const center = slotCenter(slot, config);
  const avatarRadius = config.avatarSize / 2;
  return (
    center.x - avatarRadius >= config.edgePadding &&
    center.y - avatarRadius >= config.edgePadding &&
    center.x + avatarRadius <= size.width - config.edgePadding &&
    center.y + avatarRadius <= size.height - config.edgePadding
  );
}

function slotFitsPreferredVerticalBand(
  slot: Pick<PeerLayoutSlot, 'x' | 'y'>,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): boolean {
  return (
    slot.y >= config.preferredTopInset &&
    slot.y + config.nodeHeight <= size.height - config.preferredBottomInset
  );
}

function slotOverlapsPreferredTopBand(
  slot: Pick<PeerLayoutSlot, 'y'>,
  config: PeerLayoutConfig
): boolean {
  return slot.y < config.preferredTopInset;
}

function slotOverlapsPreferredBottomBand(
  slot: Pick<PeerLayoutSlot, 'y'>,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): boolean {
  return slot.y + config.nodeHeight > size.height - config.preferredBottomInset;
}

function orderSlotsByDistantSpread(
  slots: readonly PeerLayoutSlotCandidate[],
  size: PeerLayoutSize,
  config: PeerLayoutConfig,
  initialSelectedSlots: readonly PeerLayoutSlotCandidate[] = []
): PeerLayoutSlotCandidate[] {
  const remaining = [...slots];
  const ordered: PeerLayoutSlotCandidate[] = [];
  const selectedForSpread = [...initialSelectedSlots];
  const fieldCenter = { x: size.width / 2, y: size.height / 2 };
  let centerIndex = 0;
  let centerDistance = Number.POSITIVE_INFINITY;

  if (initialSelectedSlots.length === 0) {
    for (let index = 0; index < remaining.length; index++) {
      const distance = distanceBetween(slotCenter(remaining[index], config), fieldCenter);
      if (distance < centerDistance) {
        centerIndex = index;
        centerDistance = distance;
      }
    }

    const [centerSlot] = remaining.splice(centerIndex, 1);
    if (centerSlot) {
      ordered.push(centerSlot);
      selectedForSpread.push(centerSlot);
    }
  }

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestSpreadDistance = -1;
    let bestTieBreaker = -1;

    for (let index = 0; index < remaining.length; index++) {
      const slot = remaining[index];
      const spreadDistance = getSlotSpreadDistance(slot, selectedForSpread, config);
      const tieBreaker = getStableSlotTieBreaker(slot);
      if (
        spreadDistance > bestSpreadDistance ||
        (Math.abs(spreadDistance - bestSpreadDistance) < 0.001 && tieBreaker > bestTieBreaker)
      ) {
        bestIndex = index;
        bestSpreadDistance = spreadDistance;
        bestTieBreaker = tieBreaker;
      }
    }

    const [slot] = remaining.splice(bestIndex, 1);
    ordered.push(slot);
    selectedForSpread.push(slot);
  }

  return ordered;
}

function getSlotSpreadDistance(
  slot: PeerLayoutSlotCandidate,
  selectedSlots: readonly PeerLayoutSlotCandidate[],
  config: PeerLayoutConfig
): number {
  if (selectedSlots.length === 0) return Number.POSITIVE_INFINITY;
  const center = slotCenter(slot, config);
  let spreadDistance = Number.POSITIVE_INFINITY;
  for (const selectedSlot of selectedSlots) {
    spreadDistance = Math.min(
      spreadDistance,
      distanceBetween(center, slotCenter(selectedSlot, config))
    );
  }
  return spreadDistance;
}

function getStableSlotTieBreaker(slot: PeerLayoutSlotCandidate): number {
  const angle = normalizeAngle(Math.atan2(slot.unitOffset.y, slot.unitOffset.x));
  const radius = Math.hypot(slot.unitOffset.x, slot.unitOffset.y);
  const deterministicJitter =
    Math.sin(slot.unitOffset.x * 12.9898 + slot.unitOffset.y * 78.233) * 43758.5453;
  return radius + angle / (Math.PI * 2) + (deterministicJitter - Math.floor(deterministicJitter));
}

function buildHoneycombBaseSlots(
  count: number,
  size: PeerLayoutSize,
  config: PeerLayoutConfig,
  spacingCount = count
): PeerLayoutSlot[] {
  return buildHoneycombSlotCandidates(count, size, config, spacingCount).map((candidate) => ({
    x: candidate.x,
    y: candidate.y,
    scale: candidate.scale,
  }));
}

function buildHoneycombSlotCandidates(
  count: number,
  size: PeerLayoutSize,
  config: PeerLayoutConfig,
  spacingCount = count
): PeerLayoutSlotCandidate[] {
  return buildHoneycombUnitOffsets(count).map((unitOffset) => ({
    ...buildHoneycombSlot(unitOffset, size, config, spacingCount),
    unitOffset,
  }));
}

function buildHoneycombSlot(
  unitOffset: PeerLayoutOffset,
  size: PeerLayoutSize,
  config: PeerLayoutConfig,
  spacingCount: number
): PeerLayoutSlot {
  const fieldCenter = { x: size.width / 2, y: size.height / 2 };
  const avatarSpacing = config.avatarSize + getPeerAvatarGap(spacingCount, config);
  const rawCenter = {
    x: fieldCenter.x + unitOffset.x * avatarSpacing,
    y: fieldCenter.y + unitOffset.y * avatarSpacing,
  };
  const scale = getPeerAvatarScale(rawCenter, size, config);

  return {
    x: rawCenter.x - config.nodeWidth / 2,
    y: rawCenter.y - config.nodeHeight / 2,
    scale,
  };
}

export function getPeerLayoutPanBounds(
  targets: readonly Pick<PeerLayoutTarget, 'x' | 'y'>[],
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): PeerLayoutPanBounds {
  if (targets.length === 0 || size.width <= 0 || size.height <= 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let minCenterX = Number.POSITIVE_INFINITY;
  let maxCenterX = Number.NEGATIVE_INFINITY;
  let minCenterY = Number.POSITIVE_INFINITY;
  let maxCenterY = Number.NEGATIVE_INFINITY;
  for (const target of targets) {
    const centerX = target.x + config.nodeWidth / 2;
    const centerY = target.y + config.nodeHeight / 2;
    minCenterX = Math.min(minCenterX, centerX);
    maxCenterX = Math.max(maxCenterX, centerX);
    minCenterY = Math.min(minCenterY, centerY);
    maxCenterY = Math.max(maxCenterY, centerY);
  }
  const avatarRadius = config.avatarSize / 2;
  const minVisibleCenterX = config.edgePadding + avatarRadius;
  const maxVisibleCenterX = size.width - config.edgePadding - avatarRadius;
  const minVisibleCenterY = config.edgePadding + avatarRadius;
  const maxVisibleCenterY = size.height - config.edgePadding - avatarRadius;

  return {
    minX: Math.min(0, minVisibleCenterX - maxCenterX),
    maxX: Math.max(0, maxVisibleCenterX - minCenterX),
    minY: Math.min(0, minVisibleCenterY - maxCenterY),
    maxY: Math.max(0, maxVisibleCenterY - minCenterY),
  };
}

export function getPeerLayoutOverviewTransform(
  targets: readonly (Pick<PeerLayoutTarget, 'x' | 'y'> & { phase?: PeerLayoutPhase })[],
  size: PeerLayoutSize,
  config: PeerLayoutConfig,
  pan: PeerLayoutPanOffset = { x: 0, y: 0 },
  insets: PeerLayoutOverviewInsets = { top: 0, right: 0, bottom: 0, left: 0 },
  maxScale = 1,
  scaleFactor = 1
): PeerLayoutOverviewTransform {
  if (size.width <= 0 || size.height <= 0) {
    return { translateX: 0, translateY: 0, scale: 1 };
  }

  const avatarRadius = config.avatarSize / 2;
  let visibleCount = 0;
  let minCenterX = Number.POSITIVE_INFINITY;
  let maxCenterX = Number.NEGATIVE_INFINITY;
  let minCenterY = Number.POSITIVE_INFINITY;
  let maxCenterY = Number.NEGATIVE_INFINITY;
  for (const target of targets) {
    if (target.phase === 'exiting') continue;
    visibleCount += 1;
    const centerX = target.x + config.nodeWidth / 2 + pan.x;
    const centerY = target.y + config.nodeHeight / 2 + pan.y;
    minCenterX = Math.min(minCenterX, centerX);
    maxCenterX = Math.max(maxCenterX, centerX);
    minCenterY = Math.min(minCenterY, centerY);
    maxCenterY = Math.max(maxCenterY, centerY);
  }

  if (visibleCount === 0) {
    return { translateX: 0, translateY: 0, scale: 1 };
  }

  const contentWidth = Math.max(maxCenterX - minCenterX + avatarRadius * 2, avatarRadius * 2);
  const contentHeight = Math.max(maxCenterY - minCenterY + avatarRadius * 2, avatarRadius * 2);
  const leftInset = clamp(insets.left, 0, size.width / 2);
  const rightInset = clamp(insets.right, 0, size.width / 2);
  const topInset = clamp(insets.top, 0, size.height / 2);
  const bottomInset = clamp(insets.bottom, 0, size.height / 2);
  const safeWidth = Math.max(size.width - leftInset - rightInset, avatarRadius * 2);
  const safeHeight = Math.max(size.height - topInset - bottomInset, avatarRadius * 2);
  const fitScale = Math.min(maxScale, safeWidth / contentWidth, safeHeight / contentHeight);
  const scale = clamp(fitScale * scaleFactor, 0, 1);
  const fieldCenterX = size.width / 2;
  const fieldCenterY = size.height / 2;
  const contentCenterX = (minCenterX + maxCenterX) / 2;
  const contentCenterY = (minCenterY + maxCenterY) / 2;
  const safeCenterX = leftInset + safeWidth / 2;
  const safeCenterY = topInset + safeHeight / 2;

  return {
    translateX: safeCenterX - (fieldCenterX + (contentCenterX - fieldCenterX) * scale),
    translateY: safeCenterY - (fieldCenterY + (contentCenterY - fieldCenterY) * scale),
    scale,
  };
}

export function getPeerViewportPresentation(
  target: Pick<PeerLayoutTarget, 'x' | 'y'>,
  size: PeerLayoutSize,
  config: PeerLayoutConfig,
  pan: PeerLayoutPanOffset = { x: 0, y: 0 }
): PeerViewportPresentation {
  const rawCenter = {
    x: target.x + config.nodeWidth / 2 + pan.x,
    y: target.y + config.nodeHeight / 2 + pan.y,
  };
  const hasValidField = size.width > 0 && size.height > 0 && config.avatarSize > 0;
  const rawScale = getRawPeerAvatarScale(rawCenter, size, config);
  const scale = hasValidField ? getPeerAvatarScaleFromRaw(rawScale, config) : 0;
  const presentedCenter = getPeerPresentedCenter(rawCenter, size, config, scale);
  const avatarOpacity = hasValidField ? getPeerAvatarOpacityFromRaw(rawScale, config) : 0;
  const labelOpacity = getPeerLabelOpacity(scale, config);

  return {
    x: presentedCenter.x - config.nodeWidth / 2,
    y: presentedCenter.y - config.nodeHeight / 2,
    centerX: presentedCenter.x,
    centerY: presentedCenter.y,
    scale,
    avatarOpacity,
    labelOpacity,
  };
}

function buildHoneycombUnitOffsets(count: number): PeerLayoutOffset[] {
  const slots: PeerLayoutOffset[] = [{ x: 0, y: 0 }];
  for (let ring = 1; slots.length < count; ring++) {
    const ringOffsets = orderRingOffsetsForStableInsertion(
      buildHexRingCoordinates(ring).map((coord) => hexCoordToOffset(coord, 1))
    );
    slots.push(...ringOffsets);
  }
  return slots.slice(0, count);
}

function buildHexRingCoordinates(ring: number): HexCoord[] {
  const cached = HEX_RING_COORD_CACHE.get(ring);
  if (cached) return cached;

  const coords: HexCoord[] = [];
  for (let q = -ring; q <= ring; q++) {
    for (let r = -ring; r <= ring; r++) {
      if (hexDistance({ q, r }) === ring) coords.push({ q, r });
    }
  }
  const sorted = coords.sort((a, b) => {
    const aAxis = isHexAxisCoordinate(a);
    const bAxis = isHexAxisCoordinate(b);
    if (ring > 1 && aAxis !== bAxis) return aAxis ? 1 : -1;
    return hexCoordAngle(a) - hexCoordAngle(b);
  });
  HEX_RING_COORD_CACHE.set(ring, sorted);
  return sorted;
}

function hexDistance(coord: HexCoord): number {
  return Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(coord.q + coord.r));
}

function isHexAxisCoordinate(coord: HexCoord): boolean {
  return coord.q === 0 || coord.r === 0 || coord.q + coord.r === 0;
}

function hexCoordAngle(coord: HexCoord): number {
  const offset = hexCoordToOffset(coord, 1);
  const angle = Math.atan2(offset.y, offset.x);
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

function hexCoordToOffset(coord: HexCoord, spacing: number): PeerLayoutOffset {
  const x = spacing * (coord.q + coord.r / 2);
  const y = spacing * HEX_VERTICAL_RATIO * coord.r;
  return {
    x: y,
    y: -x,
  };
}

function orderRingOffsetsForStableInsertion(
  ringOffsets: readonly PeerLayoutOffset[]
): PeerLayoutOffset[] {
  const remaining = ringOffsets.map((offset) => ({
    offset,
    angle: normalizeAngle(Math.atan2(offset.y, offset.x)),
  }));
  const selected: PeerLayoutOffset[] = [];
  const targetAngles = buildStableTargetAngles(ringOffsets.length);

  for (const targetAngle of targetAngles) {
    const bestIndex = getNearestAngleIndex(remaining, targetAngle);
    const [candidate] = remaining.splice(bestIndex, 1);
    selected.push(candidate.offset);
  }

  return selected;
}

function buildStableTargetAngles(count: number): number[] {
  const startAngle = normalizeAngle(-Math.PI / 2);
  return Array.from({ length: count }, (_, index) =>
    normalizeAngle(startAngle + vanDerCorput(index) * Math.PI * 2)
  );
}

function vanDerCorput(index: number): number {
  let value = 0;
  let denominator = 1;
  let current = index;

  while (current > 0) {
    denominator *= 2;
    value += (current % 2) / denominator;
    current = Math.floor(current / 2);
  }

  return value;
}

function getNearestAngleIndex(
  remaining: readonly { angle: number; offset: PeerLayoutOffset }[],
  targetAngle: number
): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let candidateIndex = 0; candidateIndex < remaining.length; candidateIndex++) {
    const distance = circularAngleDistance(targetAngle, remaining[candidateIndex].angle);
    if (
      distance < bestDistance ||
      (distance === bestDistance && remaining[candidateIndex].angle < remaining[bestIndex].angle)
    ) {
      bestDistance = distance;
      bestIndex = candidateIndex;
    }
  }
  return bestIndex;
}

function normalizeAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function circularAngleDistance(a: number, b: number): number {
  const difference = Math.abs(a - b);
  return Math.min(difference, Math.PI * 2 - difference);
}

function getPeerAvatarGap(count: number, config: PeerLayoutConfig): number {
  const denseGap = config.avatarGap;
  const spaciousGap = Math.max(denseGap, config.spaciousAvatarGap);
  const effectiveCount = Math.min(count, config.spacingCapPeerCount);
  if (effectiveCount <= config.spaciousPeerCount) return spaciousGap;
  if (effectiveCount >= config.densePeerCount) return denseGap;

  const countRange = Math.max(config.densePeerCount - config.spaciousPeerCount, 1);
  const densityProgress = smoothstep(
    clamp((effectiveCount - config.spaciousPeerCount) / countRange, 0, 1)
  );

  return spaciousGap + (denseGap - spaciousGap) * densityProgress;
}

function getPeerAvatarScale(
  center: PeerLayoutOffset,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): number {
  if (size.width <= 0 || size.height <= 0 || config.avatarSize <= 0) return 0;
  return getPeerAvatarScaleFromRaw(getRawPeerAvatarScale(center, size, config), config);
}

function getRawPeerAvatarScale(
  center: PeerLayoutOffset,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): number {
  const fitScale = getAvatarFitScale(center, size, config);
  const edgeLensScale = getAvatarEdgeLensScale(center, size, config);

  return Math.min(fitScale, edgeLensScale);
}

function getPeerAvatarScaleFromRaw(rawScale: number, config: PeerLayoutConfig): number {
  if (rawScale >= 1) return 1;
  if (rawScale <= 0) return config.minVisibleScale;
  return Math.max(rawScale, config.minVisibleScale);
}

function getPeerAvatarOpacityFromRaw(rawScale: number, config: PeerLayoutConfig): number {
  if (rawScale >= config.minVisibleScale) return 1;
  if (config.minVisibleScale <= 0) return rawScale > 0 ? 1 : 0;

  return smoothstep(clamp(rawScale / config.minVisibleScale, 0, 1));
}

function getAvatarFitScale(
  center: PeerLayoutOffset,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): number {
  if (size.width <= 0 || size.height <= 0 || config.avatarSize <= 0) return 0;
  const avatarRadius = config.avatarSize / 2;
  const edgeDistance = Math.min(
    center.x - config.edgePadding,
    size.width - config.edgePadding - center.x,
    center.y - config.edgePadding,
    size.height - config.edgePadding - center.y
  );

  return clamp((edgeDistance + avatarRadius) / (avatarRadius * 2), 0, 1);
}

function getAvatarEdgeLensScale(
  center: PeerLayoutOffset,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): number {
  if (size.width <= 0 || size.height <= 0 || config.avatarSize <= 0) return 0;
  const avatarRadius = config.avatarSize / 2;
  const edgeDistance = Math.min(
    center.x - config.edgePadding,
    size.width - config.edgePadding - center.x,
    center.y - config.edgePadding,
    size.height - config.edgePadding - center.y
  );
  const falloffProgress = getEdgeFalloffProgress(edgeDistance, avatarRadius, config);
  const smoothedProgress = smoothstep(falloffProgress);

  return clamp(config.edgeBoundaryScale + (1 - config.edgeBoundaryScale) * smoothedProgress, 0, 1);
}

function getPeerPresentedCenter(
  rawCenter: PeerLayoutOffset,
  size: PeerLayoutSize,
  config: PeerLayoutConfig,
  scale: number
): PeerLayoutOffset {
  if (scale <= 0 || scale >= 1 || size.width <= 0 || size.height <= 0) return rawCenter;

  const avatarRadius = config.avatarSize / 2;
  const leftInset = rawCenter.x - config.edgePadding;
  const rightInset = size.width - config.edgePadding - rawCenter.x;
  const topInset = rawCenter.y - config.edgePadding;
  const bottomInset = size.height - config.edgePadding - rawCenter.y;
  const scaledRadius = avatarRadius * scale;
  const lostRadius = avatarRadius - scaledRadius;
  const edgeTranslation = lostRadius * clamp(config.edgeTranslationStrength, 0, 1);
  const leftPressure = getEdgeFalloffPressure(leftInset, avatarRadius, config);
  const rightPressure = getEdgeFalloffPressure(rightInset, avatarRadius, config);
  const topPressure = getEdgeFalloffPressure(topInset, avatarRadius, config);
  const bottomPressure = getEdgeFalloffPressure(bottomInset, avatarRadius, config);
  const nudgeX = clamp(
    (leftPressure - rightPressure) * edgeTranslation,
    -avatarRadius,
    avatarRadius
  );
  const nudgeY = clamp(
    (topPressure - bottomPressure) * edgeTranslation,
    -avatarRadius,
    avatarRadius
  );

  return {
    x: clamp(
      rawCenter.x + nudgeX,
      config.edgePadding + scaledRadius,
      size.width - config.edgePadding - scaledRadius
    ),
    y: clamp(
      rawCenter.y + nudgeY,
      config.edgePadding + scaledRadius,
      size.height - config.edgePadding - scaledRadius
    ),
  };
}

function getEdgeFalloffPressure(
  inset: number,
  avatarRadius: number,
  config: PeerLayoutConfig
): number {
  return 1 - smoothstep(getEdgeFalloffProgress(inset, avatarRadius, config));
}

function getEdgeFalloffProgress(
  inset: number,
  avatarRadius: number,
  config: PeerLayoutConfig
): number {
  if (config.edgeScaleFalloff <= 0) return inset >= avatarRadius ? 1 : 0;
  return clamp((inset - avatarRadius) / config.edgeScaleFalloff, 0, 1);
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function getPeerLabelOpacity(scale: number, config: PeerLayoutConfig): number {
  return scale >= config.labelMinScale ? 1 : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function stationaryPeerPosition(
  x: number,
  y: number
): Pick<PeerLayoutTarget, 'entryX' | 'entryY' | 'exitX' | 'exitY'> {
  return {
    entryX: x,
    entryY: y,
    exitX: x,
    exitY: y,
  };
}

function normalizeSlotIndex(slotIndex: number, usedSlotIndexes: ReadonlySet<number>): number {
  if (Number.isInteger(slotIndex) && slotIndex >= 0 && !usedSlotIndexes.has(slotIndex)) {
    return slotIndex;
  }
  return getFirstAvailableSlotIndex(usedSlotIndexes);
}

function getFirstAvailableSlotIndex(usedSlotIndexes: ReadonlySet<number>): number {
  for (let slotIndex = 0; ; slotIndex++) {
    if (!usedSlotIndexes.has(slotIndex)) return slotIndex;
  }
}
