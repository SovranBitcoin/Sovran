import {
  buildPeerLayoutTargets,
  NEAR_PAY_EXIT_ANIMATION_MS,
  pruneExitedPeerLayoutRegistry,
  reconcilePeerLayoutRegistry,
  type NearPayLayoutPeer,
  type PeerLayoutConfig,
  type PeerLayoutRegistryEntry,
  type PeerLayoutSize,
} from '@/features/nearPay/lib/peerLayout';

const CONFIG: PeerLayoutConfig = {
  nodeWidth: 76,
  nodeHeight: 74,
  edgePadding: 16,
  minArcSpacing: 78,
};

const RESERVED_CENTER_CONFIG: PeerLayoutConfig = {
  ...CONFIG,
  reserveCenter: true,
};

const SIZE: PeerLayoutSize = {
  width: 360,
  height: 520,
};

function peer(
  peerID: string,
  overrides: Partial<Omit<NearPayLayoutPeer, 'peerID' | 'name' | 'nickname'>> = {}
): NearPayLayoutPeer {
  return {
    peerID,
    nickname: peerID,
    name: peerID,
    hasDirectLink: false,
    isConnected: true,
    lastSeen: 1,
    ...overrides,
  };
}

function ids(entries: readonly PeerLayoutRegistryEntry[]): string[] {
  return entries.map((entry) => entry.peer.peerID);
}

function targetAngleDegrees(target: { x: number; y: number }, size = SIZE): number {
  const degrees =
    (Math.atan2(
      target.y + CONFIG.nodeHeight / 2 - size.height / 2,
      target.x + CONFIG.nodeWidth / 2 - size.width / 2
    ) *
      180) /
    Math.PI;
  return Math.round(degrees < 0 ? degrees + 360 : degrees);
}

function sortedTargetAngles(targets: { x: number; y: number }[]): number[] {
  return targets.map((target) => targetAngleDegrees(target)).sort((a, b) => a - b);
}

describe('near pay peer layout registry', () => {
  it('keeps fixed peer IDs in the same slots when lastSeen changes', () => {
    const first = reconcilePeerLayoutRegistry(
      [],
      [peer('a', { lastSeen: 1 }), peer('b', { lastSeen: 3 }), peer('c', { lastSeen: 2 })],
      0
    );
    const second = reconcilePeerLayoutRegistry(
      first,
      [peer('a', { lastSeen: 10 }), peer('b', { lastSeen: 1 }), peer('c', { lastSeen: 5 })],
      100
    );

    expect(ids(first)).toEqual(['b', 'c', 'a']);
    expect(ids(second)).toEqual(ids(first));
    expect(second.every((entry) => entry.phase === 'visible')).toBe(true);
  });

  it('preserves existing order and appends new peers deterministically', () => {
    const first = reconcilePeerLayoutRegistry(
      [],
      [peer('a', { lastSeen: 2 }), peer('c', { lastSeen: 1 })],
      0
    );
    const second = reconcilePeerLayoutRegistry(
      first,
      [
        peer('b', { hasDirectLink: true, lastSeen: 99 }),
        peer('d', { isConnected: false, lastSeen: 100 }),
        peer('a', { lastSeen: 3 }),
        peer('c', { lastSeen: 4 }),
      ],
      100
    );

    expect(ids(first)).toEqual(['a', 'c']);
    expect(ids(second)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('marks missing peers as exiting before pruning them', () => {
    const first = reconcilePeerLayoutRegistry([], [peer('a'), peer('b'), peer('c')], 0);
    const exiting = reconcilePeerLayoutRegistry(first, [peer('a'), peer('c')], 100);
    const b = exiting.find((entry) => entry.peer.peerID === 'b');

    expect(b?.phase).toBe('exiting');
    expect(b?.exitStartedAt).toBe(100);

    const pruned = pruneExitedPeerLayoutRegistry(exiting, 100 + NEAR_PAY_EXIT_ANIMATION_MS + 1);
    expect(ids(pruned)).toEqual(['a', 'c']);
  });

  it('uses the center-to-target axis for entry and exit origins', () => {
    const entries = reconcilePeerLayoutRegistry([], [peer('a'), peer('b'), peer('c')], 0);
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);
    const centerX = SIZE.width / 2;
    const centerY = SIZE.height / 2;

    for (const target of targets) {
      const targetVectorX = target.x + CONFIG.nodeWidth / 2 - centerX;
      const targetVectorY = target.y + CONFIG.nodeHeight / 2 - centerY;
      const entryVectorX = target.entryX + CONFIG.nodeWidth / 2 - centerX;
      const entryVectorY = target.entryY + CONFIG.nodeHeight / 2 - centerY;
      const cross = targetVectorX * entryVectorY - targetVectorY * entryVectorX;
      const dot = targetVectorX * entryVectorX + targetVectorY * entryVectorY;

      expect(Math.abs(cross)).toBeLessThan(0.001);
      expect(dot).toBeGreaterThan(0);
      expect(target.exitX).toBe(target.entryX);
      expect(target.exitY).toBe(target.entryY);
    }
  });

  it('uses top-center entry and exit for a centered single peer', () => {
    const entries = reconcilePeerLayoutRegistry([], [peer('solo')], 0);
    const [target] = buildPeerLayoutTargets(entries, SIZE, CONFIG);
    const fieldCenterX = SIZE.width / 2;
    const fieldCenterY = SIZE.height / 2;
    const entryCenterX = target.entryX + CONFIG.nodeWidth / 2;
    const entryCenterY = target.entryY + CONFIG.nodeHeight / 2;

    expect(entryCenterX).toBeCloseTo(fieldCenterX, 4);
    expect(entryCenterY).toBeLessThan(fieldCenterY);
    expect(target.exitX).toBe(target.entryX);
    expect(target.exitY).toBe(target.entryY);
  });

  it('moves a single peer above center when the center is reserved', () => {
    const entries = reconcilePeerLayoutRegistry([], [peer('solo')], 0);
    const [target] = buildPeerLayoutTargets(entries, SIZE, RESERVED_CENTER_CONFIG);
    const fieldCenterX = SIZE.width / 2;
    const fieldCenterY = SIZE.height / 2;

    expect(target.x + CONFIG.nodeWidth / 2).toBeCloseTo(fieldCenterX, 4);
    expect(target.y + CONFIG.nodeHeight / 2).toBeLessThan(fieldCenterY);
  });

  it('uses a vertical line for two peers', () => {
    const entries = reconcilePeerLayoutRegistry([], [peer('a'), peer('b')], 0);
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);

    expect(sortedTargetAngles(targets)).toEqual([90, 270]);
    expect(targets[0].x).toBeCloseTo(targets[1].x, 4);
    expect(targets[0].y).toBeLessThan(targets[1].y);
  });

  it('uses triangle, square, and pentagon shapes for three through five peers', () => {
    const triangleTargets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry([], [peer('a'), peer('b'), peer('c')], 0),
      SIZE,
      CONFIG
    );
    const squareTargets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry([], [peer('a'), peer('b'), peer('c'), peer('d')], 0),
      SIZE,
      CONFIG
    );
    const pentagonTargets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry([], [peer('a'), peer('b'), peer('c'), peer('d'), peer('e')], 0),
      SIZE,
      CONFIG
    );

    expect(sortedTargetAngles(triangleTargets)).toEqual([30, 150, 270]);
    expect(sortedTargetAngles(squareTargets)).toEqual([45, 135, 225, 315]);
    expect(sortedTargetAngles(pentagonTargets)).toEqual([54, 126, 198, 270, 342]);
  });

  it('fills the horizontal safe width with a six-peer hex ring', () => {
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 6 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);

    expect(Math.min(...targets.map((target) => target.x))).toBeCloseTo(CONFIG.edgePadding, 4);
    expect(Math.max(...targets.map((target) => target.x + CONFIG.nodeWidth))).toBeCloseTo(
      SIZE.width - CONFIG.edgePadding,
      4
    );
  });

  it('keeps six peers on the inner hex ring and starts a second ring at seven', () => {
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 7 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);
    const fieldCenterX = SIZE.width / 2;
    const fieldCenterY = SIZE.height / 2;
    const radii = targets.map((target) =>
      Math.hypot(
        target.x + CONFIG.nodeWidth / 2 - fieldCenterX,
        target.y + CONFIG.nodeHeight / 2 - fieldCenterY
      )
    );
    const innerRadius = radii[0];

    for (const radius of radii.slice(0, 6)) {
      expect(radius).toBeCloseTo(innerRadius, 4);
    }
    expect(radii[6]).toBeGreaterThan(innerRadius);
  });

  it('places second-ring peers on hex-aligned axes', () => {
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 12 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);

    const angles = targets.slice(6, 12).map((target) => targetAngleDegrees(target));

    for (const angle of angles) {
      expect(angle % 30).toBe(0);
    }
    expect(new Set(angles)).toEqual(new Set([60, 90, 120, 240, 270, 300]));
  });

  it('keeps second-ring peer targets fully inside the field', () => {
    const compactSize: PeerLayoutSize = { width: 320, height: 360 };
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 18 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, compactSize, CONFIG);

    for (const target of targets) {
      expect(target.x).toBeGreaterThanOrEqual(0);
      expect(target.y).toBeGreaterThanOrEqual(0);
      expect(target.x + CONFIG.nodeWidth).toBeLessThanOrEqual(compactSize.width);
      expect(target.y + CONFIG.nodeHeight).toBeLessThanOrEqual(compactSize.height);
    }
  });
});
