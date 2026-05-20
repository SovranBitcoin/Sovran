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
  exitStartedAt?: number;
}

export interface PeerLayoutSize {
  width: number;
  height: number;
}

export interface PeerLayoutConfig {
  nodeWidth: number;
  nodeHeight: number;
  edgePadding: number;
  minArcSpacing: number;
  reserveCenter?: boolean;
}

export interface PeerLayoutTarget extends PeerLayoutRegistryEntry {
  x: number;
  y: number;
  entryX: number;
  entryY: number;
  exitX: number;
  exitY: number;
}

const HEX_INNER_RING_CAPACITY = 6;
const HEX_VERTICAL_RATIO = Math.sqrt(3) / 2;
const MAX_HEX_RING_SEARCH = 8;
const HEX_SPACING_SEARCH_STEPS = 48;
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

  for (const entry of previous) {
    const incoming = incomingById.get(entry.peer.peerID);
    if (incoming) {
      next.push({ peer: incoming, phase: 'visible' });
      continue;
    }
    if (entry.phase === 'exiting') {
      if (now - (entry.exitStartedAt ?? now) < NEAR_PAY_EXIT_ANIMATION_MS) next.push(entry);
      continue;
    }
    next.push({ ...entry, phase: 'exiting', exitStartedAt: now });
  }

  const newPeers = sortNearPayPeers(incomingPeers).filter((peer) => !previousIds.has(peer.peerID));
  for (const peer of newPeers) {
    next.push({ peer, phase: 'visible' });
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
  const horizontalSafeRadius = Math.max(
    0,
    size.width / 2 - config.nodeWidth / 2 - config.edgePadding
  );
  const verticalSafeRadius = Math.max(
    0,
    size.height / 2 - config.nodeHeight / 2 - config.edgePadding
  );

  if (
    (entries.length === 1 && !config.reserveCenter) ||
    horizontalSafeRadius <= 0 ||
    verticalSafeRadius <= 0
  ) {
    const entry = entries[0];
    return entry
      ? [
          {
            ...entry,
            x: centerX,
            y: centerY,
            ...axisOffscreenPosition(centerX, centerY, size, config),
          },
        ]
      : [];
  }

  const offsets = buildHexSlotOffsets(
    entries.length,
    horizontalSafeRadius,
    verticalSafeRadius,
    config
  );

  return entries.map((entry, index) => {
    const offset = offsets[index] ?? { x: 0, y: 0 };
    const x = centerX + offset.x;
    const y = centerY + offset.y;
    return {
      ...entry,
      x,
      y,
      ...axisOffscreenPosition(x, y, size, config),
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

function buildHexSlotOffsets(
  count: number,
  horizontalSafeRadius: number,
  verticalSafeRadius: number,
  config: PeerLayoutConfig
): PeerLayoutOffset[] {
  const maxSpacing = Math.min(horizontalSafeRadius / HEX_VERTICAL_RATIO, verticalSafeRadius);

  if (count < HEX_INNER_RING_CAPACITY) {
    return buildSmallShapeOffsets(count, horizontalSafeRadius, verticalSafeRadius);
  }

  if (count === HEX_INNER_RING_CAPACITY) {
    return buildHexSlotCandidates(count, maxSpacing, horizontalSafeRadius, verticalSafeRadius);
  }

  const minSpacing = Math.max(config.nodeWidth * 0.72, config.minArcSpacing * 0.6);
  for (let step = 0; step <= HEX_SPACING_SEARCH_STEPS; step++) {
    const progress = step / HEX_SPACING_SEARCH_STEPS;
    const spacing = maxSpacing - (maxSpacing - minSpacing) * progress;
    const slots = buildHexSlotCandidates(count, spacing, horizontalSafeRadius, verticalSafeRadius);
    if (slots.length >= count) return slots.slice(0, count);
  }

  return buildHexSlotCandidates(count, minSpacing, horizontalSafeRadius, verticalSafeRadius).slice(
    0,
    count
  );
}

function buildHexSlotCandidates(
  count: number,
  spacing: number,
  horizontalSafeRadius: number,
  verticalSafeRadius: number
): PeerLayoutOffset[] {
  const slots: PeerLayoutOffset[] = [];
  for (let ring = 1; slots.length < count && ring <= MAX_HEX_RING_SEARCH; ring++) {
    for (const coord of buildHexRingCoordinates(ring)) {
      const offset = hexCoordToOffset(coord, spacing);
      if (isOffsetWithinSafeRadius(offset, horizontalSafeRadius, verticalSafeRadius)) {
        slots.push(offset);
      }
      if (slots.length >= count) break;
    }
  }
  return slots;
}

function buildSmallShapeOffsets(
  count: number,
  horizontalSafeRadius: number,
  verticalSafeRadius: number
): PeerLayoutOffset[] {
  const angles = getSmallShapeAngles(count);
  const shapeRadius = getAllowedRadiusForAngles(angles, horizontalSafeRadius, verticalSafeRadius);
  const radius = count === 2 ? Math.min(shapeRadius, horizontalSafeRadius) : shapeRadius;

  return angles.map((angle) => ({
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }));
}

function getSmallShapeAngles(count: number): number[] {
  if (count === 1) return [-Math.PI / 2];
  if (count === 2) return [-Math.PI / 2, Math.PI / 2];
  if (count === 3) return [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6];
  if (count === 4) return [(-Math.PI * 3) / 4, -Math.PI / 4, Math.PI / 4, (Math.PI * 3) / 4];
  if (count === 5) {
    return Array.from(
      { length: count },
      (_, index) => -Math.PI / 2 + (Math.PI * 2 * index) / count
    );
  }
  return [];
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

function isOffsetWithinSafeRadius(
  offset: PeerLayoutOffset,
  horizontalSafeRadius: number,
  verticalSafeRadius: number
): boolean {
  return Math.abs(offset.x) <= horizontalSafeRadius && Math.abs(offset.y) <= verticalSafeRadius;
}

function getAllowedRadiusForAngles(
  angles: readonly number[],
  horizontalSafeRadius: number,
  verticalSafeRadius: number
): number {
  return angles.reduce((allowedRadius, angle) => {
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const horizontalLimit = cos < 0.001 ? Number.POSITIVE_INFINITY : horizontalSafeRadius / cos;
    const verticalLimit = sin < 0.001 ? Number.POSITIVE_INFINITY : verticalSafeRadius / sin;
    return Math.min(allowedRadius, horizontalLimit, verticalLimit);
  }, Number.POSITIVE_INFINITY);
}

function axisOffscreenPosition(
  x: number,
  y: number,
  size: PeerLayoutSize,
  config: PeerLayoutConfig
): Pick<PeerLayoutTarget, 'entryX' | 'entryY' | 'exitX' | 'exitY'> {
  const fieldCenterX = size.width / 2;
  const fieldCenterY = size.height / 2;
  const targetCenterX = x + config.nodeWidth / 2;
  const targetCenterY = y + config.nodeHeight / 2;
  let dx = targetCenterX - fieldCenterX;
  let dy = targetCenterY - fieldCenterY;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) {
    dx = 0;
    dy = -1;
  } else {
    dx /= length;
    dy /= length;
  }
  const distance = Math.max(size.width, size.height) + 240;
  const offscreenCenterX = fieldCenterX + dx * distance;
  const offscreenCenterY = fieldCenterY + dy * distance;
  const offscreenX = offscreenCenterX - config.nodeWidth / 2;
  const offscreenY = offscreenCenterY - config.nodeHeight / 2;
  return {
    entryX: offscreenX,
    entryY: offscreenY,
    exitX: offscreenX,
    exitY: offscreenY,
  };
}
