import {
  buildPeerLayoutTargets,
  getPeerLayoutOverviewTransform,
  getPeerLayoutPanBounds,
  getPeerViewportPresentation,
  NEAR_PAY_EXIT_ANIMATION_MS,
  pruneExitedPeerLayoutRegistry,
  reconcilePeerLayoutRegistry,
  type NearPayLayoutPeer,
  type PeerLayoutConfig,
  type PeerLayoutRegistryEntry,
  type PeerLayoutSize,
  type PeerLayoutTarget,
} from '@/features/nearPay/lib/peerLayout';

const CONFIG: PeerLayoutConfig = {
  nodeWidth: 76,
  nodeHeight: 74,
  avatarSize: 48,
  avatarGap: 8,
  spaciousAvatarGap: 48,
  spaciousPeerCount: 7,
  densePeerCount: 31,
  spacingCapPeerCount: 20,
  preferredTopInset: 80,
  preferredBottomInset: 124,
  edgePadding: 0,
  edgeScaleFalloff: 96,
  edgeBoundaryScale: 0.9,
  edgeTranslationStrength: 1,
  minVisibleScale: 0.16,
  labelMinScale: 0.58,
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

function targetCenter(target: { x: number; y: number }, config = CONFIG): { x: number; y: number } {
  return {
    x: target.x + config.nodeWidth / 2,
    y: target.y + config.nodeHeight / 2,
  };
}

function targetRadius(target: { x: number; y: number }, size = SIZE, config = CONFIG): number {
  const center = targetCenter(target, config);
  return Math.hypot(center.x - size.width / 2, center.y - size.height / 2);
}

function centerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const aCenter = targetCenter(a);
  const bCenter = targetCenter(b);
  return Math.hypot(aCenter.x - bCenter.x, aCenter.y - bCenter.y);
}

function rawFullAvatarInset(target: { x: number; y: number }, size = SIZE): number {
  const center = targetCenter(target);
  const radius = CONFIG.avatarSize / 2;
  return Math.min(
    center.x - radius - CONFIG.edgePadding,
    size.width - CONFIG.edgePadding - center.x - radius,
    center.y - radius - CONFIG.edgePadding,
    size.height - CONFIG.edgePadding - center.y - radius
  );
}

function overlapsPreferredAvoidanceBand(target: { x: number; y: number }, size = SIZE): boolean {
  return (
    target.y < CONFIG.preferredTopInset ||
    target.y + CONFIG.nodeHeight > size.height - CONFIG.preferredBottomInset
  );
}

function overlapsPreferredActionBand(target: { x: number; y: number }, size = SIZE): boolean {
  return target.y + CONFIG.nodeHeight > size.height - CONFIG.preferredBottomInset;
}

function rawAvatarFitScale(target: { x: number; y: number }, size = SIZE): number {
  const center = targetCenter(target);
  const radius = CONFIG.avatarSize / 2;
  const edgeDistance = Math.min(
    center.x - CONFIG.edgePadding,
    size.width - CONFIG.edgePadding - center.x,
    center.y - CONFIG.edgePadding,
    size.height - CONFIG.edgePadding - center.y
  );
  return Math.max(0, Math.min(1, (edgeDistance + radius) / (radius * 2)));
}

function presentationAvatarInset(target: { x: number; y: number }, size = SIZE): number {
  const presentation = getPeerViewportPresentation(target, size, CONFIG);
  const radius = (CONFIG.avatarSize * presentation.scale) / 2;
  return Math.min(
    presentation.centerX - radius - CONFIG.edgePadding,
    size.width - CONFIG.edgePadding - presentation.centerX - radius,
    presentation.centerY - radius - CONFIG.edgePadding,
    size.height - CONFIG.edgePadding - presentation.centerY - radius
  );
}

function targetCentersByPeerId(
  targets: readonly PeerLayoutTarget[]
): Map<string, { x: number; y: number }> {
  return new Map(targets.map((target) => [target.peer.peerID, targetCenter(target)]));
}

function overviewCenter(
  target: { x: number; y: number },
  transform: { translateX: number; translateY: number; scale: number },
  pan: { x: number; y: number },
  size = SIZE,
  config = CONFIG
): { x: number; y: number } {
  const center = targetCenter(target, config);
  return {
    x:
      size.width / 2 + (center.x + pan.x - size.width / 2) * transform.scale + transform.translateX,
    y:
      size.height / 2 +
      (center.y + pan.y - size.height / 2) * transform.scale +
      transform.translateY,
  };
}

function expectPeerCenterToStayPut(
  peerID: string,
  before: ReadonlyMap<string, { x: number; y: number }>,
  after: ReadonlyMap<string, { x: number; y: number }>
): void {
  expect(after.get(peerID)?.x).toBeCloseTo(before.get(peerID)?.x ?? Number.NaN, 4);
  expect(after.get(peerID)?.y).toBeCloseTo(before.get(peerID)?.y ?? Number.NaN, 4);
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

  it('keeps entry and exit anchors on the target slot for scale animations', () => {
    const entries = reconcilePeerLayoutRegistry([], [peer('a'), peer('b'), peer('c')], 0);
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);

    for (const target of targets) {
      expect(target.entryX).toBe(target.x);
      expect(target.entryY).toBe(target.y);
      expect(target.exitX).toBe(target.x);
      expect(target.exitY).toBe(target.y);
    }
  });

  it('centers a single peer', () => {
    const entries = reconcilePeerLayoutRegistry([], [peer('solo')], 0);
    const [target] = buildPeerLayoutTargets(entries, SIZE, CONFIG);
    const center = targetCenter(target);

    expect(center.x).toBeCloseTo(SIZE.width / 2, 4);
    expect(center.y).toBeCloseTo(SIZE.height / 2, 4);
    expect(target.exitX).toBe(target.entryX);
    expect(target.exitY).toBe(target.entryY);
  });

  it('starts every honeycomb with a centered peer', () => {
    const entries = reconcilePeerLayoutRegistry([], [peer('a'), peer('b')], 0);
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);
    const firstCenter = targetCenter(targets[0]);

    expect(firstCenter.x).toBeCloseTo(SIZE.width / 2, 4);
    expect(firstCenter.y).toBeCloseTo(SIZE.height / 2, 4);
    expect(targets[0].scale).toBe(1);
    expect(targetRadius(targets[1])).toBeGreaterThan(0);
  });

  it('keeps existing peer targets stable when a peer is added', () => {
    const firstEntries = reconcilePeerLayoutRegistry([], [peer('a'), peer('b'), peer('c')], 0);
    const firstTargets = buildPeerLayoutTargets(firstEntries, SIZE, CONFIG);
    const firstCenters = targetCentersByPeerId(firstTargets);
    const nextEntries = reconcilePeerLayoutRegistry(
      firstEntries,
      [peer('a'), peer('b'), peer('c'), peer('d')],
      100
    );
    const nextTargets = buildPeerLayoutTargets(nextEntries, SIZE, CONFIG);
    const nextCenters = targetCentersByPeerId(nextTargets);

    expectPeerCenterToStayPut('a', firstCenters, nextCenters);
    expectPeerCenterToStayPut('b', firstCenters, nextCenters);
    expectPeerCenterToStayPut('c', firstCenters, nextCenters);
  });

  it('keeps surviving peer targets stable when an exiting peer is pruned', () => {
    const firstEntries = reconcilePeerLayoutRegistry(
      [],
      [peer('a'), peer('b'), peer('c'), peer('d')],
      0
    );
    const firstTargets = buildPeerLayoutTargets(firstEntries, SIZE, CONFIG);
    const firstCenters = targetCentersByPeerId(firstTargets);
    const exitingEntries = reconcilePeerLayoutRegistry(
      firstEntries,
      [peer('a'), peer('c'), peer('d')],
      100
    );
    const prunedEntries = pruneExitedPeerLayoutRegistry(
      exitingEntries,
      100 + NEAR_PAY_EXIT_ANIMATION_MS + 1
    );
    const prunedTargets = buildPeerLayoutTargets(prunedEntries, SIZE, CONFIG);
    const prunedCenters = targetCentersByPeerId(prunedTargets);

    expectPeerCenterToStayPut('a', firstCenters, prunedCenters);
    expectPeerCenterToStayPut('c', firstCenters, prunedCenters);
    expectPeerCenterToStayPut('d', firstCenters, prunedCenters);
  });

  it('keeps distributed peer directions stable when compact overflow peers arrive', () => {
    const firstEntries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 19 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const firstTargets = buildPeerLayoutTargets(firstEntries, SIZE, CONFIG);
    const firstById = new Map(firstTargets.map((target) => [target.peer.peerID, target]));
    const nextEntries = reconcilePeerLayoutRegistry(
      firstEntries,
      Array.from({ length: 35 }, (_, index) => peer(`peer-${index + 1}`)),
      100
    );
    const nextTargets = buildPeerLayoutTargets(nextEntries, SIZE, CONFIG);
    const nextById = new Map(nextTargets.map((target) => [target.peer.peerID, target]));

    for (let index = 1; index <= 19; index++) {
      const peerID = `peer-${index}`;
      const before = firstById.get(peerID);
      const after = nextById.get(peerID);

      expect(after?.slotIndex).toBe(before?.slotIndex);
      if (!before || !after || before.slotIndex === 0) continue;
      expect(Math.abs(targetAngleDegrees(after) - targetAngleDegrees(before))).toBeLessThanOrEqual(
        1
      );
    }
  });

  it('uses distant honeycomb positions for low counts and caps their spacing after twenty peers', () => {
    const roomyTargets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry(
        [],
        Array.from({ length: CONFIG.spaciousPeerCount }, (_, index) => peer(`roomy-${index + 1}`)),
        0
      ),
      SIZE,
      CONFIG
    );
    const cappedTargets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry(
        [],
        Array.from({ length: CONFIG.spacingCapPeerCount }, (_, index) => peer(`cap-${index + 1}`)),
        0
      ),
      SIZE,
      CONFIG
    );
    const denseTargets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry(
        [],
        Array.from({ length: 35 }, (_, index) => peer(`dense-${index + 1}`)),
        0
      ),
      SIZE,
      CONFIG
    );

    expect(targetRadius(roomyTargets[1])).toBeGreaterThanOrEqual(
      CONFIG.avatarSize + CONFIG.spaciousAvatarGap
    );
    expect(targetRadius(denseTargets[1])).toBeCloseTo(targetRadius(cappedTargets[1]), 4);
    expect(targetRadius(denseTargets[19])).toBeCloseTo(targetRadius(cappedTargets[19]), 4);
    expect(targetRadius(denseTargets[1])).toBeGreaterThan(CONFIG.avatarSize + CONFIG.avatarGap);
  });

  it('leaves enough roomy first-ring space for an under-avatar name line', () => {
    const targets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry(
        [],
        Array.from({ length: CONFIG.spaciousPeerCount }, (_, index) => peer(`roomy-${index + 1}`)),
        0
      ),
      SIZE,
      CONFIG
    );
    const underAvatarLabelWidth = CONFIG.nodeWidth;
    const underAvatarLabelHeight = 16;
    const underAvatarLabelGap = 4;
    const avatarRadius = CONFIG.avatarSize / 2;
    const avatarRects = targets.map((target) => {
      const center = targetCenter(target);
      return {
        bottom: center.y + avatarRadius,
        left: center.x - avatarRadius,
        right: center.x + avatarRadius,
        top: center.y - avatarRadius,
      };
    });
    const labelRects = targets.map((target) => {
      const center = targetCenter(target);
      return {
        bottom: center.y + avatarRadius + underAvatarLabelGap + underAvatarLabelHeight,
        left: center.x - underAvatarLabelWidth / 2,
        right: center.x + underAvatarLabelWidth / 2,
        top: center.y + avatarRadius + underAvatarLabelGap,
      };
    });

    for (const [labelIndex, labelRect] of labelRects.entries()) {
      for (const [avatarIndex, avatarRect] of avatarRects.entries()) {
        if (labelIndex === avatarIndex) continue;
        const overlaps =
          labelRect.left < avatarRect.right &&
          labelRect.right > avatarRect.left &&
          labelRect.top < avatarRect.bottom &&
          labelRect.bottom > avatarRect.top;

        expect(overlaps).toBe(false);
      }
    }

    expect(CONFIG.spaciousAvatarGap).toBeGreaterThanOrEqual(
      underAvatarLabelHeight + underAvatarLabelGap + CONFIG.avatarGap
    );
  });

  it('continues with compact honeycomb candidates after on-screen slots are exhausted', () => {
    const targets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry(
        [],
        Array.from({ length: 35 }, (_, index) => peer(`peer-${index + 1}`)),
        0
      ),
      SIZE,
      CONFIG
    );
    const overflowIndex = targets.findIndex((target) => rawFullAvatarInset(target) < 0);
    const overflowTarget = targets[overflowIndex];
    const onScreenDistances = targets
      .slice(0, overflowIndex)
      .map((target) => centerDistance(target, overflowTarget));

    expect(overflowIndex).toBeGreaterThan(0);
    expect(overflowTarget).toBeDefined();
    expect(Math.min(...onScreenDistances)).toBeGreaterThan(CONFIG.avatarSize);
    expect(targetRadius(overflowTarget)).toBeGreaterThan(targetRadius(targets[0]));
  });

  it('deprioritizes header and action-row honeycomb slots while enough middle slots exist', () => {
    const targets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry(
        [],
        Array.from({ length: 35 }, (_, index) => peer(`peer-${index + 1}`)),
        0
      ),
      SIZE,
      CONFIG
    );
    const firstAvoidedIndex = targets.findIndex((target) => overlapsPreferredAvoidanceBand(target));
    const firstActionIndex = targets.findIndex((target) => overlapsPreferredActionBand(target));

    expect(firstAvoidedIndex).toBeGreaterThanOrEqual(7);
    expect(firstActionIndex === -1 || firstActionIndex > firstAvoidedIndex).toBe(true);
    expect(firstActionIndex === -1 || firstActionIndex >= 12).toBe(true);
    for (const target of targets.slice(0, firstAvoidedIndex)) {
      expect(overlapsPreferredAvoidanceBand(target)).toBe(false);
    }
    expect(targets.some((target) => overlapsPreferredAvoidanceBand(target))).toBe(true);
  });

  it('uses a centered peer with distant honeycomb positions for five peers', () => {
    const targets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry([], [peer('a'), peer('b'), peer('c'), peer('d'), peer('e')], 0),
      SIZE,
      CONFIG
    );

    expect(targetRadius(targets[0])).toBeCloseTo(0, 4);
    expect(new Set(sortedTargetAngles(targets.slice(1))).size).toBe(4);
    for (const target of targets.slice(1)) {
      expect(targetRadius(target)).toBeGreaterThanOrEqual(
        CONFIG.avatarSize + CONFIG.spaciousAvatarGap
      );
      expect(rawFullAvatarInset(target)).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the first seven honeycomb peers distributed around the center', () => {
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 7 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);

    expect(targetRadius(targets[0])).toBeCloseTo(0, 4);
    expect(new Set(sortedTargetAngles(targets.slice(1, 7))).size).toBe(6);
    for (const target of targets.slice(1, 7)) {
      expect(targetRadius(target)).toBeGreaterThanOrEqual(
        CONFIG.avatarSize + CONFIG.spaciousAvatarGap
      );
    }
  });

  it('keeps distributed slots on screen before compact overflow', () => {
    const targets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry(
        [],
        Array.from({ length: 35 }, (_, index) => peer(`peer-${index + 1}`)),
        0
      ),
      SIZE,
      CONFIG
    );
    const overflowIndex = targets.findIndex((target) => rawFullAvatarInset(target) < 0);

    expect(overflowIndex).toBeGreaterThan(0);
    for (const target of targets.slice(0, overflowIndex)) {
      expect(rawFullAvatarInset(target)).toBeGreaterThanOrEqual(0);
      expect(getPeerViewportPresentation(target, SIZE, CONFIG).scale).toBeGreaterThan(0);
    }
  });

  it('keeps comfortably fitting avatars at full scale', () => {
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 35 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);
    const comfortableTargets = targets.filter(
      (target) => rawFullAvatarInset(target) >= CONFIG.edgeScaleFalloff
    );

    expect(comfortableTargets.length).toBeGreaterThan(0);
    for (const target of comfortableTargets) {
      expect(getPeerViewportPresentation(target, SIZE, CONFIG).scale).toBe(1);
    }
  });

  it('subtly scales cleanly fitting avatars inside the edge falloff band', () => {
    const rawCenter = {
      x: SIZE.width - CONFIG.edgePadding - CONFIG.avatarSize / 2 - CONFIG.edgeScaleFalloff * 0.5,
      y: SIZE.height / 2,
    };
    const target = {
      x: rawCenter.x - CONFIG.nodeWidth / 2,
      y: rawCenter.y - CONFIG.nodeHeight / 2,
    };
    const presentation = getPeerViewportPresentation(target, SIZE, CONFIG);

    expect(rawFullAvatarInset(target)).toBeGreaterThan(0);
    expect(rawFullAvatarInset(target)).toBeLessThan(CONFIG.edgeScaleFalloff);
    expect(presentation.scale).toBeGreaterThan(CONFIG.edgeBoundaryScale);
    expect(presentation.scale).toBeLessThan(1);
    expect(presentation.labelOpacity).toBe(1);
  });

  it('shrinks overflowing avatars only enough to fit inside the field', () => {
    const rawCenter = {
      x: SIZE.width - CONFIG.edgePadding - CONFIG.avatarSize * 0.35,
      y: SIZE.height / 2,
    };
    const target = {
      x: rawCenter.x - CONFIG.nodeWidth / 2,
      y: rawCenter.y - CONFIG.nodeHeight / 2,
    };
    const presentation = getPeerViewportPresentation(target, SIZE, CONFIG);

    expect(rawFullAvatarInset(target)).toBeLessThan(0);
    expect(presentation.scale).toBeCloseTo(0.85, 4);
    expect(presentation.scale).toBeGreaterThan(CONFIG.minVisibleScale);
    expect(presentation.scale).toBeLessThan(1);
    expect(presentationAvatarInset(target)).toBeGreaterThanOrEqual(-0.001);
  });

  it('keeps inner edge peers visually no closer to the edge than outer shrunken peers', () => {
    const innerRawCenter = {
      x: SIZE.width - CONFIG.edgePadding - CONFIG.avatarSize / 2 - CONFIG.edgeScaleFalloff * 0.05,
      y: SIZE.height / 2,
    };
    const outerRawCenter = {
      x: SIZE.width - CONFIG.edgePadding - CONFIG.avatarSize * 0.35,
      y: SIZE.height / 2,
    };
    const innerTarget = {
      x: innerRawCenter.x - CONFIG.nodeWidth / 2,
      y: innerRawCenter.y - CONFIG.nodeHeight / 2,
    };
    const outerTarget = {
      x: outerRawCenter.x - CONFIG.nodeWidth / 2,
      y: outerRawCenter.y - CONFIG.nodeHeight / 2,
    };
    const innerPresentation = getPeerViewportPresentation(innerTarget, SIZE, CONFIG);
    const outerPresentation = getPeerViewportPresentation(outerTarget, SIZE, CONFIG);

    expect(rawFullAvatarInset(innerTarget)).toBeGreaterThan(0);
    expect(rawFullAvatarInset(outerTarget)).toBeLessThan(0);
    expect(innerPresentation.scale).toBeGreaterThan(outerPresentation.scale);
    expect(innerPresentation.scale).toBeLessThan(1);
    expect(presentationAvatarInset(innerTarget)).toBeGreaterThanOrEqual(
      presentationAvatarInset(outerTarget)
    );
  });

  it('keeps inside-facing edges ordered through the overflow and falloff band', () => {
    const rawFullInsets = [-20, -12, -8, -4, -2, 0, 4, 8, 12, 24, 48, 59, 72, 84];
    const presentations = rawFullInsets.map((rawFullInset) => {
      const avatarRadius = CONFIG.avatarSize / 2;
      const rawCenter = {
        x: SIZE.width - CONFIG.edgePadding - avatarRadius - rawFullInset,
        y: SIZE.height / 2,
      };
      const target = {
        x: rawCenter.x - CONFIG.nodeWidth / 2,
        y: rawCenter.y - CONFIG.nodeHeight / 2,
      };
      const presentation = getPeerViewportPresentation(target, SIZE, CONFIG);
      const scaledRadius = avatarRadius * presentation.scale;

      return {
        rawFullInset,
        rawInsideEdge: rawCenter.x - avatarRadius,
        insideEdge: presentation.centerX - scaledRadius,
        scale: presentation.scale,
      };
    });

    for (let index = 1; index < presentations.length; index++) {
      const previous = presentations[index - 1];
      const current = presentations[index];

      expect(current.rawFullInset).toBeGreaterThan(previous.rawFullInset);
      expect(current.insideEdge).toBeLessThanOrEqual(previous.insideEdge + 0.001);
      expect(Math.abs(current.insideEdge - current.rawInsideEdge)).toBeLessThanOrEqual(1.25);
    }
    expect(
      presentations.some((presentation) => presentation.scale > 0 && presentation.scale < 1)
    ).toBe(true);
  });

  it('fades avatars whose fit scale is below the visible minimum', () => {
    const rawCenter = {
      x: CONFIG.edgePadding - CONFIG.avatarSize * 0.45,
      y: SIZE.height / 2,
    };
    const target = {
      x: rawCenter.x - CONFIG.nodeWidth / 2,
      y: rawCenter.y - CONFIG.nodeHeight / 2,
    };
    const presentation = getPeerViewportPresentation(target, SIZE, CONFIG);

    expect(rawAvatarFitScale(target)).toBeLessThan(CONFIG.minVisibleScale);
    expect(presentation.scale).toBe(CONFIG.minVisibleScale);
    expect(presentation.avatarOpacity).toBeGreaterThan(0);
    expect(presentation.avatarOpacity).toBeLessThan(1);
    expect(presentation.labelOpacity).toBe(0);
  });

  it('fully fades out avatars past the edge fade band', () => {
    const rawCenter = {
      x: CONFIG.edgePadding - CONFIG.avatarSize,
      y: SIZE.height / 2,
    };
    const target = {
      x: rawCenter.x - CONFIG.nodeWidth / 2,
      y: rawCenter.y - CONFIG.nodeHeight / 2,
    };
    const presentation = getPeerViewportPresentation(target, SIZE, CONFIG);

    expect(rawAvatarFitScale(target)).toBe(0);
    expect(presentation.scale).toBe(CONFIG.minVisibleScale);
    expect(presentation.avatarOpacity).toBe(0);
    expect(presentation.labelOpacity).toBe(0);
  });

  it('lets pan bring an edge peer back to full-size center focus', () => {
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 35 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);
    const edgeTarget = targets.reduce((nearest, target) =>
      rawFullAvatarInset(target) < rawFullAvatarInset(nearest) ? target : nearest
    );
    const panBounds = getPeerLayoutPanBounds(targets, SIZE, CONFIG);
    const panToCenter = {
      x: SIZE.width / 2 - targetCenter(edgeTarget).x,
      y: SIZE.height / 2 - targetCenter(edgeTarget).y,
    };
    const focused = getPeerViewportPresentation(edgeTarget, SIZE, CONFIG, panToCenter);

    expect(panToCenter.x).toBeGreaterThanOrEqual(panBounds.minX);
    expect(panToCenter.x).toBeLessThanOrEqual(panBounds.maxX);
    expect(panToCenter.y).toBeGreaterThanOrEqual(panBounds.minY);
    expect(panToCenter.y).toBeLessThanOrEqual(panBounds.maxY);
    expect(focused.scale).toBe(1);
    expect(focused.centerX).toBeCloseTo(SIZE.width / 2, 4);
    expect(focused.centerY).toBeCloseTo(SIZE.height / 2, 4);
  });

  it('lets the canvas travel until edge avatar bodies reach the field edges', () => {
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 35 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);
    const panBounds = getPeerLayoutPanBounds(targets, SIZE, CONFIG);
    const centers = targets.map((target) => targetCenter(target));
    const minCenterX = Math.min(...centers.map((center) => center.x));
    const maxCenterX = Math.max(...centers.map((center) => center.x));
    const minCenterY = Math.min(...centers.map((center) => center.y));
    const maxCenterY = Math.max(...centers.map((center) => center.y));
    const avatarRadius = CONFIG.avatarSize / 2;

    expect(panBounds.minX).toBeCloseTo(CONFIG.edgePadding + avatarRadius - maxCenterX, 4);
    expect(panBounds.maxX).toBeCloseTo(
      SIZE.width - CONFIG.edgePadding - avatarRadius - minCenterX,
      4
    );
    expect(panBounds.minY).toBeCloseTo(CONFIG.edgePadding + avatarRadius - maxCenterY, 4);
    expect(panBounds.maxY).toBeCloseTo(
      SIZE.height - CONFIG.edgePadding - avatarRadius - minCenterY,
      4
    );
    expect(panBounds.minX).toBeLessThan(SIZE.width / 2 - maxCenterX);
    expect(panBounds.maxX).toBeGreaterThan(SIZE.width / 2 - minCenterX);
  });

  it('builds a press-held overview transform that fits every visible avatar', () => {
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 35 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);
    const pan = { x: -180, y: 96 };
    const insets = { top: 24, right: 24, bottom: 132, left: 24 };
    const overview = getPeerLayoutOverviewTransform(targets, SIZE, CONFIG, pan, insets);
    const scaledRadius = (CONFIG.avatarSize * overview.scale) / 2;

    expect(overview.scale).toBeGreaterThan(0);
    expect(overview.scale).toBeLessThan(1);
    for (const target of targets) {
      const center = overviewCenter(target, overview, pan);

      expect(center.x - scaledRadius).toBeGreaterThanOrEqual(insets.left - 0.001);
      expect(center.x + scaledRadius).toBeLessThanOrEqual(SIZE.width - insets.right + 0.001);
      expect(center.y - scaledRadius).toBeGreaterThanOrEqual(insets.top - 0.001);
      expect(center.y + scaledRadius).toBeLessThanOrEqual(SIZE.height - insets.bottom + 0.001);
    }
  });

  it('keeps overview scale at one when a pan-only shift can fit every avatar', () => {
    const targets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry(
        [],
        Array.from({ length: 5 }, (_, index) => peer(`peer-${index + 1}`)),
        0
      ),
      SIZE,
      CONFIG
    );
    const pan = { x: SIZE.width / 3, y: 0 };
    const insets = { top: 24, right: 24, bottom: 24, left: 24 };
    const overview = getPeerLayoutOverviewTransform(targets, SIZE, CONFIG, pan, insets);
    const avatarRadius = CONFIG.avatarSize / 2;

    expect(overview.scale).toBe(1);
    expect(Math.abs(overview.translateX)).toBeGreaterThan(1);
    for (const target of targets) {
      const center = overviewCenter(target, overview, pan);

      expect(center.x - avatarRadius).toBeGreaterThanOrEqual(insets.left - 0.001);
      expect(center.x + avatarRadius).toBeLessThanOrEqual(SIZE.width - insets.right + 0.001);
    }
  });

  it('can apply a stronger minimum visible zoom-out even when every avatar already fits', () => {
    const targets = buildPeerLayoutTargets(
      reconcilePeerLayoutRegistry(
        [],
        Array.from({ length: 5 }, (_, index) => peer(`peer-${index + 1}`)),
        0
      ),
      SIZE,
      CONFIG
    );
    const pan = { x: 0, y: 0 };
    const insets = { top: 24, right: 24, bottom: 24, left: 24 };
    const overview = getPeerLayoutOverviewTransform(targets, SIZE, CONFIG, pan, insets, 0.84, 0.94);
    const scaledRadius = (CONFIG.avatarSize * overview.scale) / 2;

    expect(overview.scale).toBeCloseTo(0.7896, 4);
    for (const target of targets) {
      const center = overviewCenter(target, overview, pan);

      expect(center.x - scaledRadius).toBeGreaterThanOrEqual(insets.left - 0.001);
      expect(center.x + scaledRadius).toBeLessThanOrEqual(SIZE.width - insets.right + 0.001);
      expect(center.y - scaledRadius).toBeGreaterThanOrEqual(insets.top - 0.001);
      expect(center.y + scaledRadius).toBeLessThanOrEqual(SIZE.height - insets.bottom + 0.001);
    }
  });

  it('applies the overview scale factor to dense layouts that already need fitting', () => {
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 35 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);
    const pan = { x: -180, y: 96 };
    const insets = { top: 24, right: 24, bottom: 132, left: 24 };
    const regularOverview = getPeerLayoutOverviewTransform(targets, SIZE, CONFIG, pan, insets, 1);
    const strongerOverview = getPeerLayoutOverviewTransform(
      targets,
      SIZE,
      CONFIG,
      pan,
      insets,
      1,
      0.94
    );

    expect(strongerOverview.scale).toBeCloseTo(regularOverview.scale * 0.94, 4);
    expect(strongerOverview.scale).toBeLessThan(regularOverview.scale);
  });

  it('ignores exiting peers when fitting the press-held overview', () => {
    const visibleTarget = {
      x: SIZE.width / 2 - CONFIG.nodeWidth / 2,
      y: SIZE.height / 2 - CONFIG.nodeHeight / 2,
      phase: 'visible' as const,
    };
    const exitingTarget = {
      x: SIZE.width * 4,
      y: SIZE.height * 4,
      phase: 'exiting' as const,
    };
    const overview = getPeerLayoutOverviewTransform(
      [visibleTarget, exitingTarget],
      SIZE,
      CONFIG,
      { x: 0, y: 0 },
      { top: 24, right: 24, bottom: 24, left: 24 }
    );

    expect(overview.scale).toBe(1);
    expect(overview.translateX).toBeCloseTo(0, 4);
    expect(overview.translateY).toBeCloseTo(0, 4);
  });

  it('translates shrinking edge presentations inward to preserve the honeycomb-side gap', () => {
    const rawFullInset = 12;
    const avatarRadius = CONFIG.avatarSize / 2;
    const rawCenter = {
      x: SIZE.width - CONFIG.edgePadding - avatarRadius - rawFullInset,
      y: SIZE.height / 2,
    };
    const target = {
      x: rawCenter.x - CONFIG.nodeWidth / 2,
      y: rawCenter.y - CONFIG.nodeHeight / 2,
    };
    const presentation = getPeerViewportPresentation(target, SIZE, CONFIG);
    const scaledRadius = (CONFIG.avatarSize * presentation.scale) / 2;
    const rightInset = SIZE.width - CONFIG.edgePadding - presentation.centerX - scaledRadius;
    const rawInsideEdge = rawCenter.x - avatarRadius;
    const presentedInsideEdge = presentation.centerX - scaledRadius;

    expect(presentation.scale).toBeGreaterThan(0);
    expect(presentation.scale).toBeLessThan(1);
    expect(presentation.centerX).toBeLessThan(rawCenter.x);
    expect(presentation.centerY).toBeCloseTo(rawCenter.y, 4);
    expect(Math.abs(presentation.centerX - rawCenter.x)).toBeLessThanOrEqual(avatarRadius);
    expect(presentedInsideEdge).toBeCloseTo(rawInsideEdge, 0);
    expect(rightInset).toBeGreaterThan(rawFullInset);

    const cornerRawCenter = {
      x: CONFIG.edgePadding + avatarRadius,
      y: CONFIG.edgePadding + avatarRadius,
    };
    const cornerTarget = {
      x: cornerRawCenter.x - CONFIG.nodeWidth / 2,
      y: cornerRawCenter.y - CONFIG.nodeHeight / 2,
    };
    const cornerPresentation = getPeerViewportPresentation(cornerTarget, SIZE, CONFIG);

    expect(cornerPresentation.centerX).toBeGreaterThan(cornerRawCenter.x);
    expect(cornerPresentation.centerY).toBeGreaterThan(cornerRawCenter.y);
    expect(cornerPresentation.centerX - cornerRawCenter.x).toBeLessThanOrEqual(avatarRadius);
    expect(cornerPresentation.centerY - cornerRawCenter.y).toBeLessThanOrEqual(avatarRadius);
  });

  it('keeps labels visible until avatars become sufficiently compact near edges', () => {
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 35 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, SIZE, CONFIG);
    const moderateEdgeTarget = {
      x: SIZE.width - CONFIG.edgePadding - CONFIG.avatarSize * 0.35 - CONFIG.nodeWidth / 2,
      y: SIZE.height / 2 - CONFIG.nodeHeight / 2,
    };
    const tinyEdgeTarget = {
      x: CONFIG.edgePadding - CONFIG.avatarSize * 0.15 - CONFIG.nodeWidth / 2,
      y: SIZE.height / 2 - CONFIG.nodeHeight / 2,
    };

    expect(rawFullAvatarInset(moderateEdgeTarget)).toBeLessThan(0);
    expect(rawAvatarFitScale(moderateEdgeTarget)).toBeGreaterThan(CONFIG.labelMinScale);
    expect(rawAvatarFitScale(tinyEdgeTarget)).toBeLessThan(CONFIG.labelMinScale);
    expect(rawAvatarFitScale(tinyEdgeTarget)).toBeGreaterThan(CONFIG.minVisibleScale);
    for (const target of targets.slice(0, 7)) {
      const presentation = getPeerViewportPresentation(target, SIZE, CONFIG);
      expect(presentation.scale).toBeGreaterThanOrEqual(CONFIG.labelMinScale);
      expect(presentation.labelOpacity).toBe(1);
    }
    expect(getPeerViewportPresentation(moderateEdgeTarget, SIZE, CONFIG).labelOpacity).toBe(1);
    expect(getPeerViewportPresentation(tinyEdgeTarget, SIZE, CONFIG).labelOpacity).toBe(0);
  });

  it('keeps second-ring peer presentations fully inside the field', () => {
    const compactSize: PeerLayoutSize = { width: 320, height: 360 };
    const entries = reconcilePeerLayoutRegistry(
      [],
      Array.from({ length: 18 }, (_, index) => peer(`peer-${index + 1}`)),
      0
    );
    const targets = buildPeerLayoutTargets(entries, compactSize, CONFIG);

    for (const target of targets) {
      const presentation = getPeerViewportPresentation(target, compactSize, CONFIG);
      if (presentation.scale <= 0) continue;
      const radius = (CONFIG.avatarSize * presentation.scale) / 2;

      expect(presentation.centerX - radius).toBeGreaterThanOrEqual(CONFIG.edgePadding);
      expect(presentation.centerY - radius).toBeGreaterThanOrEqual(CONFIG.edgePadding);
      expect(presentation.centerX + radius).toBeLessThanOrEqual(
        compactSize.width - CONFIG.edgePadding
      );
      expect(presentation.centerY + radius).toBeLessThanOrEqual(
        compactSize.height - CONFIG.edgePadding
      );
    }
  });
});
