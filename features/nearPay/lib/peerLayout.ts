export const NEAR_PAY_EXIT_ANIMATION_MS = 460;

export type PeerLayoutPhase = 'visible' | 'exiting';

export interface NearPayLayoutPeer {
  peerID: string;
  nickname: string;
  isConnected: boolean;
  hasDirectLink: boolean;
  lastSeen: number;
  name: string;
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
  edgePadding: number;
  minVisibleScale: number;
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

interface PeerViewportPresentation {
  x: number;
  y: number;
  centerX: number;
  centerY: number;
  scale: number;
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
  const slots = buildHoneycombBaseSlots(slotCount, size, config);

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

function buildHoneycombBaseSlots(
  count: number,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): PeerLayoutSlot[] {
  const unitOffsets = buildHoneycombUnitOffsets(count);
  const fieldCenter = { x: size.width / 2, y: size.height / 2 };
  const avatarSpacing = config.avatarSize + config.avatarGap;

  return unitOffsets.map((offset) => {
    const rawCenter = {
      x: fieldCenter.x + offset.x * avatarSpacing,
      y: fieldCenter.y + offset.y * avatarSpacing,
    };
    const scale = getPeerAvatarScale(rawCenter, size, config);

    return {
      x: rawCenter.x - config.nodeWidth / 2,
      y: rawCenter.y - config.nodeHeight / 2,
      scale,
    };
  });
}

export function getPeerLayoutPanBounds(
  targets: readonly Pick<PeerLayoutTarget, 'x' | 'y'>[],
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): PeerLayoutPanBounds {
  if (targets.length === 0 || size.width <= 0 || size.height <= 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  const centers = targets.map((target) => ({
    x: target.x + config.nodeWidth / 2,
    y: target.y + config.nodeHeight / 2,
  }));
  const minCenterX = Math.min(...centers.map((center) => center.x));
  const maxCenterX = Math.max(...centers.map((center) => center.x));
  const minCenterY = Math.min(...centers.map((center) => center.y));
  const maxCenterY = Math.max(...centers.map((center) => center.y));
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
  const scale = getPeerAvatarScale(rawCenter, size, config);
  const presentedCenter = getPeerPresentedCenter(rawCenter, size, config, scale);
  const labelOpacity = getPeerLabelOpacity(scale);

  return {
    x: presentedCenter.x - config.nodeWidth / 2,
    y: presentedCenter.y - config.nodeHeight / 2,
    centerX: presentedCenter.x,
    centerY: presentedCenter.y,
    scale,
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

function getPeerAvatarScale(
  center: PeerLayoutOffset,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): number {
  const fitScale = getAvatarFitScale(center, size, config);
  if (fitScale >= 1) return 1;
  if (fitScale < config.minVisibleScale) return 0;
  return fitScale;
}

function getAvatarFitScale(
  center: PeerLayoutOffset,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): number {
  if (size.width <= 0 || size.height <= 0 || config.avatarSize <= 0) return 0;
  const avatarRadius = config.avatarSize / 2;
  return clamp(
    Math.min(
      center.x - config.edgePadding,
      size.width - config.edgePadding - center.x,
      center.y - config.edgePadding,
      size.height - config.edgePadding - center.y
    ) / avatarRadius,
    0,
    1
  );
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
  const nudgeX = clamp(
    getAvatarRadiusOverflow(leftInset, avatarRadius) -
      getAvatarRadiusOverflow(rightInset, avatarRadius),
    -avatarRadius,
    avatarRadius
  );
  const nudgeY = clamp(
    getAvatarRadiusOverflow(topInset, avatarRadius) -
      getAvatarRadiusOverflow(bottomInset, avatarRadius),
    -avatarRadius,
    avatarRadius
  );

  return {
    x: rawCenter.x + nudgeX,
    y: rawCenter.y + nudgeY,
  };
}

function getAvatarRadiusOverflow(inset: number, avatarRadius: number): number {
  return Math.max(0, avatarRadius - inset);
}

function getPeerLabelOpacity(scale: number): number {
  return scale >= 1 ? 1 : 0;
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
