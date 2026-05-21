import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Platform, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import type { BLEPeer } from 'bitchat-module';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import opacity from 'hex-color-opacity';
import { usePaymentFlowMachine } from 'coco-payment-ux/react';

import Icon from 'assets/icons';
import { useBLEPeers } from '@/features/bitchat/hooks/useBLEPeers';
import { AmountFlowContent } from '@/features/send/screens/AmountFlowScreen';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { resolveIdentityName } from '@/shared/lib/identity';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Screen } from '@/shared/ui/composed/Screen';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { alpha, duration, iconSize, spacing, zIndex } from '@/shared/styles/tokens';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import {
  buildPeerLayoutTargets,
  getPeerLayoutPanBounds,
  getPeerViewportPresentation,
  NEAR_PAY_EXIT_ANIMATION_MS,
  pruneExitedPeerLayoutRegistry,
  reconcilePeerLayoutRegistry,
  type NearPayLayoutPeer,
  type PeerLayoutRegistryEntry,
  type PeerLayoutSize,
  type PeerLayoutTarget,
} from '@/features/nearPay/lib/peerLayout';
import { buildDotFieldPathBuckets } from '@/features/nearPay/lib/dotField';

const AVATAR_SIZE = 48;
const AMOUNT_HEADER_AVATAR_SIZE = 56;
const INLINE_AMOUNT_HEADER_TOP = spacing['4xl'];
const INLINE_AMOUNT_HEADER_HEIGHT = 126;
const NODE_WIDTH = 76;
const NODE_HEIGHT = 74;
const PEER_AVATAR_TOP = spacing.xs;
const PEER_AVATAR_CENTER_Y = PEER_AVATAR_TOP + AVATAR_SIZE / 2;
const PEER_AVATAR_GAP = spacing.sm;
const PEER_AVATAR_NAME_SIZE = 10;
const DOT_SPACING = 18;
const DOT_RADIUS = 1;
const FIELD_EDGE_PADDING = 0;
const EDGE_SCALE_FALLOFF = AVATAR_SIZE * 2;
const EDGE_BOUNDARY_SCALE = 0.9;
const EDGE_TRANSLATION_STRENGTH = 1;
const MIN_VISIBLE_PEER_SCALE = 0.16;
const PEER_PAN_RUBBER_BAND_FACTOR = 0.36;
const PEER_PAN_MOMENTUM_SECONDS = 0.18;
const PEER_ENTRY_ANIMATION_MS = 460;
const PEER_REBALANCE_ANIMATION_MS = 320;
const SHARED_AVATAR_ANIMATION_MS = 430;
const AMOUNT_CONTENT_ENTER_OFFSET = spacing.sm;
const AMOUNT_CONTENT_ENTER_DELAY_MS = duration.standard;
const AMOUNT_CONTENT_ENTER_TIMING = {
  duration: duration.standard,
  easing: Easing.out(Easing.cubic),
};
const PEER_ENTRY_SPRING = {
  damping: 18,
  stiffness: 160,
  mass: 0.85,
};
const PEER_REBALANCE_SPRING = {
  damping: 20,
  stiffness: 190,
  mass: 0.8,
};
const PEER_SCALE_SPRING = {
  damping: 15,
  stiffness: 220,
  mass: 0.7,
};
const PEER_VIEWPORT_SCALE_GROW_SPRING = {
  damping: 18,
  stiffness: 360,
  mass: 0.45,
};
const PEER_VIEWPORT_SCALE_MAX_OVERSHOOT = 1.025;
const PEER_VIEWPORT_SCALE_SHRINK_TIMING = {
  duration: duration.quick,
  easing: Easing.out(Easing.cubic),
};
const FOREGROUND_THEME_KEYS = ['foreground'] as const;
const HEADER_BADGE_THEME_KEYS = ['foreground', 'shade-400', 'accent', 'accent-foreground'] as const;
const PEER_LAYOUT_CONFIG = {
  nodeWidth: NODE_WIDTH,
  nodeHeight: NODE_HEIGHT,
  avatarSize: AVATAR_SIZE,
  avatarGap: PEER_AVATAR_GAP,
  edgePadding: FIELD_EDGE_PADDING,
  edgeScaleFalloff: EDGE_SCALE_FALLOFF,
  edgeBoundaryScale: EDGE_BOUNDARY_SCALE,
  edgeTranslationStrength: EDGE_TRANSLATION_STRENGTH,
  minVisibleScale: MIN_VISIBLE_PEER_SCALE,
};

interface AvatarRect {
  x: number;
  y: number;
  size: number;
}

function peerDisplayName(peer: BLEPeer): string {
  return resolveIdentityName({
    pubkey: peer.peerID,
    bleNickname: peer.nickname,
  });
}

function toLayoutPeer(peer: BLEPeer): NearPayLayoutPeer {
  return {
    peerID: peer.peerID,
    nickname: peer.nickname,
    isConnected: peer.isConnected,
    hasDirectLink: peer.hasDirectLink,
    lastSeen: peer.lastSeen,
    name: peerDisplayName(peer),
  };
}

const HeaderBadge = React.memo(function HeaderBadge({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const [foreground, shade400, accent, accentForeground] = useThemeColor(HEADER_BADGE_THEME_KEYS);
  const badgeStyle = useMemo(() => [styles.headerBadge, { backgroundColor: accent }], [accent]);
  const badgeTextStyle = useMemo(
    () => [styles.headerBadgeText, { color: accentForeground }],
    [accentForeground]
  );

  return (
    <Pressable onPress={onPress} hitSlop={8} haptics style={styles.headerBadgePressable}>
      <View>
        <Icon
          name="mdi:account-group"
          size={iconSize.xl}
          color={count > 0 ? foreground : shade400}
        />
        {count > 0 ? (
          <View style={badgeStyle}>
            <Text size={10} style={badgeTextStyle}>
              {count}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const DotField = React.memo(function DotField({
  size,
  foreground,
}: {
  size: PeerLayoutSize;
  foreground: string;
}) {
  const { width, height } = size;
  const buckets = useMemo(
    () => buildDotFieldPathBuckets({ width, height }, DOT_SPACING, DOT_RADIUS),
    [height, width]
  );

  if (width <= 0 || height <= 0 || buckets.length === 0) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFillObject}>
        {buckets.map((bucket) => (
          <Path key={bucket.key} d={bucket.d} fill={foreground} opacity={bucket.opacity} />
        ))}
      </Svg>
    </View>
  );
});

function peerTargetsEqual(a: PeerLayoutTarget, b: PeerLayoutTarget): boolean {
  return (
    a.phase === b.phase &&
    a.x === b.x &&
    a.y === b.y &&
    a.scale === b.scale &&
    a.entryX === b.entryX &&
    a.entryY === b.entryY &&
    a.exitX === b.exitX &&
    a.exitY === b.exitY &&
    a.exitStartedAt === b.exitStartedAt &&
    a.slotIndex === b.slotIndex &&
    a.peer.peerID === b.peer.peerID &&
    a.peer.name === b.peer.name &&
    a.peer.nickname === b.peer.nickname &&
    a.peer.isConnected === b.peer.isConnected &&
    a.peer.hasDirectLink === b.peer.hasDirectLink
  );
}

const PeerNode = React.memo(function PeerNode({
  target,
  fieldSize,
  panX,
  panY,
  isPanning,
  onSelect,
  hideSharedElementSource,
}: {
  target: PeerLayoutTarget;
  fieldSize: PeerLayoutSize;
  panX: SharedValue<number>;
  panY: SharedValue<number>;
  isPanning: SharedValue<boolean>;
  onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
  hideSharedElementSource?: boolean;
}) {
  const [foreground] = useThemeColor(FOREGROUND_THEME_KEYS);
  const hasAnimatedInRef = useRef(false);
  const baseX = useSharedValue(target.x);
  const baseY = useSharedValue(target.y);
  const nodeOpacity = useSharedValue(0);
  const visibilityScale = useSharedValue(0);
  const viewportScaleProgress = useSharedValue(target.scale);

  useEffect(() => {
    const firstPlacement = !hasAnimatedInRef.current;
    if (firstPlacement) {
      baseX.set(target.x);
      baseY.set(target.y);
      nodeOpacity.set(0);
      visibilityScale.set(0);
      hasAnimatedInRef.current = true;
    }
    cancelAnimation(baseX);
    cancelAnimation(baseY);
    cancelAnimation(nodeOpacity);
    cancelAnimation(visibilityScale);
    const exiting = target.phase === 'exiting';
    const animationDuration = exiting
      ? NEAR_PAY_EXIT_ANIMATION_MS
      : firstPlacement
        ? PEER_ENTRY_ANIMATION_MS
        : PEER_REBALANCE_ANIMATION_MS;
    const timing = { duration: animationDuration, easing: Easing.out(Easing.cubic) };
    const opacityTiming = { duration: duration.quick, easing: Easing.out(Easing.cubic) };
    const spring = firstPlacement ? PEER_ENTRY_SPRING : PEER_REBALANCE_SPRING;
    baseX.set(withSpring(target.x, spring));
    baseY.set(withSpring(target.y, spring));
    nodeOpacity.set(
      exiting
        ? withDelay(Math.round(animationDuration * 0.45), withTiming(0, opacityTiming))
        : withTiming(1, opacityTiming)
    );
    visibilityScale.set(exiting ? withTiming(0, timing) : withSpring(1, PEER_SCALE_SPRING));
  }, [baseX, baseY, nodeOpacity, visibilityScale, target.phase, target.x, target.y]);

  useAnimatedReaction(
    () => {
      const rawCenterX = baseX.get() + NODE_WIDTH / 2 + panX.get();
      const rawCenterY = baseY.get() + NODE_HEIGHT / 2 + panY.get();
      const avatarRadius = AVATAR_SIZE / 2;
      const edgeDistance = Math.min(
        rawCenterX - FIELD_EDGE_PADDING,
        fieldSize.width - FIELD_EDGE_PADDING - rawCenterX,
        rawCenterY - FIELD_EDGE_PADDING,
        fieldSize.height - FIELD_EDGE_PADDING - rawCenterY
      );
      const fitScale =
        fieldSize.width <= 0 || fieldSize.height <= 0
          ? 0
          : Math.min(Math.max((edgeDistance + avatarRadius) / (avatarRadius * 2), 0), 1);
      const edgeProgress = Math.min(
        Math.max((edgeDistance - avatarRadius) / EDGE_SCALE_FALLOFF, 0),
        1
      );
      const edgeSmooth = edgeProgress * edgeProgress * (3 - 2 * edgeProgress);
      const edgeLensScale = EDGE_BOUNDARY_SCALE + (1 - EDGE_BOUNDARY_SCALE) * edgeSmooth;
      const rawViewportScale = Math.min(fitScale, edgeLensScale);

      const scale =
        rawViewportScale >= 1
          ? 1
          : rawViewportScale < MIN_VISIBLE_PEER_SCALE
            ? 0
            : rawViewportScale;

      return {
        isTrackingPan: isPanning.get(),
        scale,
      };
    },
    (next, previous) => {
      const nextScale = next.scale;
      const previousScale = previous?.scale ?? null;

      if (previousScale === null || next.isTrackingPan || previous?.isTrackingPan) {
        cancelAnimation(viewportScaleProgress);
        viewportScaleProgress.set(nextScale);
        return;
      }
      if (Math.abs(nextScale - previousScale) < 0.002) return;

      cancelAnimation(viewportScaleProgress);
      viewportScaleProgress.set(
        nextScale > previousScale
          ? withSpring(nextScale, PEER_VIEWPORT_SCALE_GROW_SPRING)
          : withTiming(nextScale, PEER_VIEWPORT_SCALE_SHRINK_TIMING)
      );
    },
    [fieldSize.height, fieldSize.width, isPanning]
  );

  const animatedStyle = useAnimatedStyle(() => {
    const rawCenterX = baseX.get() + NODE_WIDTH / 2 + panX.get();
    const rawCenterY = baseY.get() + NODE_HEIGHT / 2 + panY.get();
    const avatarRadius = AVATAR_SIZE / 2;
    const leftInset = rawCenterX - FIELD_EDGE_PADDING;
    const rightInset = fieldSize.width - FIELD_EDGE_PADDING - rawCenterX;
    const topInset = rawCenterY - FIELD_EDGE_PADDING;
    const bottomInset = fieldSize.height - FIELD_EDGE_PADDING - rawCenterY;
    const animatedViewportScale = Math.min(
      Math.max(viewportScaleProgress.get(), 0),
      PEER_VIEWPORT_SCALE_MAX_OVERSHOOT
    );
    const layoutViewportScale = Math.min(animatedViewportScale, 1);
    const nudgesEdge = layoutViewportScale > 0 && layoutViewportScale < 1;
    const leftProgress = Math.min(Math.max((leftInset - avatarRadius) / EDGE_SCALE_FALLOFF, 0), 1);
    const rightProgress = Math.min(
      Math.max((rightInset - avatarRadius) / EDGE_SCALE_FALLOFF, 0),
      1
    );
    const topProgress = Math.min(Math.max((topInset - avatarRadius) / EDGE_SCALE_FALLOFF, 0), 1);
    const bottomProgress = Math.min(
      Math.max((bottomInset - avatarRadius) / EDGE_SCALE_FALLOFF, 0),
      1
    );
    const leftSmooth = leftProgress * leftProgress * (3 - 2 * leftProgress);
    const rightSmooth = rightProgress * rightProgress * (3 - 2 * rightProgress);
    const topSmooth = topProgress * topProgress * (3 - 2 * topProgress);
    const bottomSmooth = bottomProgress * bottomProgress * (3 - 2 * bottomProgress);
    const leftPressure = 1 - leftSmooth;
    const rightPressure = 1 - rightSmooth;
    const topPressure = 1 - topSmooth;
    const bottomPressure = 1 - bottomSmooth;
    const scaledRadius = avatarRadius * layoutViewportScale;
    const lostRadius = avatarRadius - scaledRadius;
    const edgeTranslation = lostRadius * Math.min(Math.max(EDGE_TRANSLATION_STRENGTH, 0), 1);
    const nudgeX = nudgesEdge
      ? Math.min(
          Math.max((leftPressure - rightPressure) * edgeTranslation, -avatarRadius),
          avatarRadius
        )
      : 0;
    const nudgeY = nudgesEdge
      ? Math.min(
          Math.max((topPressure - bottomPressure) * edgeTranslation, -avatarRadius),
          avatarRadius
        )
      : 0;
    const centerX = nudgesEdge
      ? Math.min(
          Math.max(rawCenterX + nudgeX, FIELD_EDGE_PADDING + scaledRadius),
          fieldSize.width - FIELD_EDGE_PADDING - scaledRadius
        )
      : rawCenterX;
    const centerY = nudgesEdge
      ? Math.min(
          Math.max(rawCenterY + nudgeY, FIELD_EDGE_PADDING + scaledRadius),
          fieldSize.height - FIELD_EDGE_PADDING - scaledRadius
        )
      : rawCenterY;
    const totalScale = animatedViewportScale * visibilityScale.get();
    const scaledAvatarCenterY =
      NODE_HEIGHT / 2 + totalScale * (PEER_AVATAR_CENTER_Y - NODE_HEIGHT / 2);

    return {
      opacity: nodeOpacity.get(),
      zIndex: zIndex.sticky + Math.round(layoutViewportScale * 100),
      transform: [
        { translateX: centerX - NODE_WIDTH / 2 },
        { translateY: centerY - scaledAvatarCenterY },
        { scale: totalScale },
      ],
    };
  });
  const labelAnimatedStyle = useAnimatedStyle(() => {
    const rawCenterX = baseX.get() + NODE_WIDTH / 2 + panX.get();
    const rawCenterY = baseY.get() + NODE_HEIGHT / 2 + panY.get();
    const avatarRadius = AVATAR_SIZE / 2;
    const edgeDistance = Math.min(
      rawCenterX - FIELD_EDGE_PADDING,
      fieldSize.width - FIELD_EDGE_PADDING - rawCenterX,
      rawCenterY - FIELD_EDGE_PADDING,
      fieldSize.height - FIELD_EDGE_PADDING - rawCenterY
    );
    const fitScale =
      fieldSize.width <= 0 || fieldSize.height <= 0
        ? 0
        : Math.min(Math.max((edgeDistance + avatarRadius) / (avatarRadius * 2), 0), 1);
    const edgeProgress = Math.min(
      Math.max((edgeDistance - avatarRadius) / EDGE_SCALE_FALLOFF, 0),
      1
    );
    const edgeSmooth = edgeProgress * edgeProgress * (3 - 2 * edgeProgress);
    const edgeLensScale = EDGE_BOUNDARY_SCALE + (1 - EDGE_BOUNDARY_SCALE) * edgeSmooth;
    const rawViewportScale = Math.min(fitScale, edgeLensScale);
    const viewportScale =
      rawViewportScale >= 1 ? 1 : rawViewportScale < MIN_VISIBLE_PEER_SCALE ? 0 : rawViewportScale;
    return {
      opacity: (viewportScale >= 1 ? 1 : 0) * visibilityScale.get(),
    };
  });
  const nodeStyle = useMemo(() => [styles.peerNode, animatedStyle], [animatedStyle]);
  const peerAvatarNameOverlayStyle = useMemo(
    () => [styles.peerAvatarNameOverlay, labelAnimatedStyle],
    [labelAnimatedStyle]
  );
  const peerPressableStyle = hideSharedElementSource
    ? styles.peerPressableHidden
    : styles.peerPressable;
  const peerAvatarNameStyle = useMemo(
    () => [styles.peerAvatarName, { color: opacity(foreground, alpha.prominent) }],
    [foreground]
  );

  const handlePress = useCallback(() => {
    if (target.phase === 'exiting') return;
    const presentation = getPeerViewportPresentation(target, fieldSize, PEER_LAYOUT_CONFIG, {
      x: panX.get(),
      y: panY.get(),
    });
    if (presentation.scale <= 0) return;
    onSelect(target.peer, getScaledAvatarRect(target, fieldSize, { x: panX.get(), y: panY.get() }));
  }, [fieldSize, onSelect, panX, panY, target]);

  return (
    <Animated.View style={nodeStyle}>
      <Pressable
        onPress={handlePress}
        haptics
        accessibilityRole="button"
        accessibilityLabel={`Pay ${target.peer.name}`}
        style={peerPressableStyle}>
        <View pointerEvents="none" style={styles.peerAvatarFrame}>
          <Avatar
            state="fallback"
            size={AVATAR_SIZE}
            name={target.peer.name}
            seed={target.peer.peerID}
            alt={`${target.peer.name} avatar`}
          />
          <Animated.View pointerEvents="none" style={peerAvatarNameOverlayStyle}>
            <Text
              size={PEER_AVATAR_NAME_SIZE}
              weight="bold"
              numberOfLines={1}
              ellipsizeMode="tail"
              allowFontScaling={false}
              style={peerAvatarNameStyle}>
              {target.peer.name}
            </Text>
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
}, arePeerNodePropsEqual);

function getScaledAvatarRect(
  target: PeerLayoutTarget,
  fieldSize: PeerLayoutSize,
  pan: { x: number; y: number }
): AvatarRect {
  const presentation = getPeerViewportPresentation(target, fieldSize, PEER_LAYOUT_CONFIG, pan);
  const scaledAvatarSize = AVATAR_SIZE * presentation.scale;

  return {
    x: presentation.centerX - scaledAvatarSize / 2,
    y: presentation.centerY - scaledAvatarSize / 2,
    size: scaledAvatarSize,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function arePeerNodePropsEqual(
  prev: {
    target: PeerLayoutTarget;
    fieldSize: PeerLayoutSize;
    panX: SharedValue<number>;
    panY: SharedValue<number>;
    isPanning: SharedValue<boolean>;
    onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
    hideSharedElementSource?: boolean;
  },
  next: {
    target: PeerLayoutTarget;
    fieldSize: PeerLayoutSize;
    panX: SharedValue<number>;
    panY: SharedValue<number>;
    isPanning: SharedValue<boolean>;
    onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
    hideSharedElementSource?: boolean;
  }
): boolean {
  return (
    prev.onSelect === next.onSelect &&
    prev.hideSharedElementSource === next.hideSharedElementSource &&
    prev.fieldSize.width === next.fieldSize.width &&
    prev.fieldSize.height === next.fieldSize.height &&
    prev.panX === next.panX &&
    prev.panY === next.panY &&
    prev.isPanning === next.isPanning &&
    peerTargetsEqual(prev.target, next.target)
  );
}

const NearPayAmountHeader = React.memo(function NearPayAmountHeader({
  recipient,
  hideAvatar,
}: {
  recipient: NearPayLayoutPeer;
  hideAvatar: boolean;
}) {
  const foreground = useThemeColor('foreground');
  const titleStyle = useMemo(() => ({ color: foreground }), [foreground]);

  return (
    <VStack align="center" gap={spacing.xs} style={styles.inlineAmountHeader}>
      <View style={hideAvatar ? styles.sharedElementHidden : null}>
        <Avatar
          state="fallback"
          size={AMOUNT_HEADER_AVATAR_SIZE}
          name={recipient.name}
          seed={recipient.peerID}
          alt={`${recipient.name} avatar`}
        />
      </View>
      <Text size={15} weight="bold" numberOfLines={1} style={titleStyle}>
        Pay {recipient.name}
      </Text>
    </VStack>
  );
});

function NearPayPeerField({
  peers,
  emptyContent,
  onSelect,
  selectedPeerID,
}: {
  peers: BLEPeer[];
  emptyContent: React.ReactNode;
  onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
  selectedPeerID?: string | null;
}) {
  const [foreground] = useThemeColor(FOREGROUND_THEME_KEYS);
  const [fieldSize, setFieldSize] = useState<PeerLayoutSize>({ width: 0, height: 0 });
  const [registry, setRegistry] = useState<PeerLayoutRegistryEntry[]>([]);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const minPanX = useSharedValue(0);
  const maxPanX = useSharedValue(0);
  const minPanY = useSharedValue(0);
  const maxPanY = useSharedValue(0);
  const isPanning = useSharedValue(false);
  const isPanSettling = useSharedValue(false);
  const panSettleRemaining = useSharedValue(0);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFieldSize((current) =>
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height }
    );
  }, []);

  const layoutPeers = useMemo(() => peers.map(toLayoutPeer), [peers]);

  useEffect(() => {
    setRegistry((current) => reconcilePeerLayoutRegistry(current, layoutPeers, Date.now()));
  }, [layoutPeers]);

  const hasExitingPeer = registry.some((entry) => entry.phase === 'exiting');
  useEffect(() => {
    if (!hasExitingPeer) return;
    const timeout = setTimeout(() => {
      setRegistry((current) => pruneExitedPeerLayoutRegistry(current, Date.now()));
    }, NEAR_PAY_EXIT_ANIMATION_MS + 40);
    return () => clearTimeout(timeout);
  }, [hasExitingPeer, registry]);

  const targets = useMemo(
    () => buildPeerLayoutTargets(registry, fieldSize, PEER_LAYOUT_CONFIG),
    [fieldSize, registry]
  );
  const panBounds = useMemo(
    () => getPeerLayoutPanBounds(targets, fieldSize, PEER_LAYOUT_CONFIG),
    [fieldSize, targets]
  );

  useEffect(() => {
    minPanX.set(panBounds.minX);
    maxPanX.set(panBounds.maxX);
    minPanY.set(panBounds.minY);
    maxPanY.set(panBounds.maxY);

    if (isPanning.get()) return;

    const currentX = panX.get();
    const currentY = panY.get();
    const nextX = clampNumber(currentX, panBounds.minX, panBounds.maxX);
    const nextY = clampNumber(currentY, panBounds.minY, panBounds.maxY);
    const settleTiming = { duration: duration.quick, easing: Easing.out(Easing.cubic) };
    if (nextX !== currentX) panX.set(withTiming(nextX, settleTiming));
    if (nextY !== currentY) panY.set(withTiming(nextY, settleTiming));
  }, [
    isPanning,
    maxPanX,
    maxPanY,
    minPanX,
    minPanY,
    panBounds.maxX,
    panBounds.maxY,
    panBounds.minX,
    panBounds.minY,
    panX,
    panY,
  ]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(6)
        .onBegin(() => {
          'worklet';
          isPanning.set(true);
          isPanSettling.set(false);
          panSettleRemaining.set(0);
          cancelAnimation(panX);
          cancelAnimation(panY);
          panStartX.set(panX.get());
          panStartY.set(panY.get());
        })
        .onUpdate((event) => {
          'worklet';
          const rawX = panStartX.get() + event.translationX;
          const rawY = panStartY.get() + event.translationY;
          const minX = minPanX.get();
          const maxX = maxPanX.get();
          const minY = minPanY.get();
          const maxY = maxPanY.get();
          const nextX =
            rawX < minX
              ? minX + (rawX - minX) * PEER_PAN_RUBBER_BAND_FACTOR
              : rawX > maxX
                ? maxX + (rawX - maxX) * PEER_PAN_RUBBER_BAND_FACTOR
                : rawX;
          const nextY =
            rawY < minY
              ? minY + (rawY - minY) * PEER_PAN_RUBBER_BAND_FACTOR
              : rawY > maxY
                ? maxY + (rawY - maxY) * PEER_PAN_RUBBER_BAND_FACTOR
                : rawY;
          panX.set(nextX);
          panY.set(nextY);
        })
        .onEnd((event) => {
          'worklet';
          isPanSettling.set(true);
          panSettleRemaining.set(2);
          const minX = minPanX.get();
          const maxX = maxPanX.get();
          const minY = minPanY.get();
          const maxY = maxPanY.get();
          const finalX = Math.min(
            Math.max(panX.get() + event.velocityX * PEER_PAN_MOMENTUM_SECONDS, minX),
            maxX
          );
          const finalY = Math.min(
            Math.max(panY.get() + event.velocityY * PEER_PAN_MOMENTUM_SECONDS, minY),
            maxY
          );
          panX.set(
            withSpring(
              finalX,
              {
                damping: 24,
                stiffness: 220,
                mass: 0.9,
                velocity: event.velocityX,
              },
              (finished) => {
                if (!finished) return;
                const remaining = panSettleRemaining.get() - 1;
                panSettleRemaining.set(remaining);
                if (remaining > 0) return;
                isPanSettling.set(false);
                isPanning.set(false);
              }
            )
          );
          panY.set(
            withSpring(
              finalY,
              {
                damping: 24,
                stiffness: 220,
                mass: 0.9,
                velocity: event.velocityY,
              },
              (finished) => {
                if (!finished) return;
                const remaining = panSettleRemaining.get() - 1;
                panSettleRemaining.set(remaining);
                if (remaining > 0) return;
                isPanSettling.set(false);
                isPanning.set(false);
              }
            )
          );
        })
        .onFinalize(() => {
          'worklet';
          if (isPanSettling.get()) return;
          isPanning.set(false);
        }),
    [
      isPanSettling,
      isPanning,
      maxPanX,
      maxPanY,
      minPanX,
      minPanY,
      panSettleRemaining,
      panStartX,
      panStartY,
      panX,
      panY,
    ]
  );

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View onLayout={handleLayout} style={styles.field}>
        <DotField size={fieldSize} foreground={foreground} />
        {registry.length === 0 ? emptyContent : null}
        {targets.map((target) => (
          <PeerNode
            key={target.peer.peerID}
            target={target}
            fieldSize={fieldSize}
            panX={panX}
            panY={panY}
            isPanning={isPanning}
            onSelect={onSelect}
            hideSharedElementSource={selectedPeerID === target.peer.peerID}
          />
        ))}
      </Animated.View>
    </GestureDetector>
  );
}

export function NearPayScreen() {
  useLifecycleLogger('NearPayScreen');
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });
  const { peers, refresh } = useBLEPeers();
  const [foreground] = useThemeColor(FOREGROUND_THEME_KEYS);
  const nearPaySession = useNearPaySessionStore((state) => state.active);
  const inlineAmountEntry = nearPaySession?.amountEntry ?? null;
  const inlinePhase = nearPaySession?.phase ?? 'picking';
  const [containerSize, setContainerSize] = useState<PeerLayoutSize>({ width: 0, height: 0 });
  const [selectedPeer, setSelectedPeer] = useState<NearPayLayoutPeer | null>(null);
  const [selectedPeerRect, setSelectedPeerRect] = useState<AvatarRect | null>(null);
  const [sharedAvatarPeer, setSharedAvatarPeer] = useState<NearPayLayoutPeer | null>(null);
  const [amountContentMounted, setAmountContentMounted] = useState(false);
  const pickerOpacity = useSharedValue(1);
  const amountOpacity = useSharedValue(0);
  const amountContentOpacity = useSharedValue(0);
  const amountContentTranslateY = useSharedValue<number>(AMOUNT_CONTENT_ENTER_OFFSET);
  const sharedAvatarX = useSharedValue(0);
  const sharedAvatarY = useSharedValue(0);
  const sharedAvatarScale = useSharedValue(1);
  const sharedAvatarOpacity = useSharedValue(0);
  const reachableCount = useMemo(
    () => peers.filter((peer) => peer.hasDirectLink || peer.isConnected).length,
    [peers]
  );

  useEffect(() => {
    useNearPaySessionStore.getState().clear();
    return () => {
      useNearPaySessionStore.getState().clear();
    };
  }, []);

  const activeRecipientPeer = useMemo<NearPayLayoutPeer | null>(() => {
    const recipient = nearPaySession?.recipient;
    if (!recipient) return null;
    if (selectedPeer?.peerID === recipient.peerID) return selectedPeer;
    return {
      peerID: recipient.peerID,
      nickname: recipient.nickname,
      name: recipient.nickname,
      isConnected: true,
      hasDirectLink: recipient.hasDirectLink,
      lastSeen: recipient.lastSeen,
    };
  }, [nearPaySession?.recipient, selectedPeer]);

  const headerAvatarRect = useMemo<AvatarRect | null>(() => {
    if (containerSize.width <= 0) return null;
    return {
      x: containerSize.width / 2 - AMOUNT_HEADER_AVATAR_SIZE / 2,
      y: INLINE_AMOUNT_HEADER_TOP,
      size: AMOUNT_HEADER_AVATAR_SIZE,
    };
  }, [containerSize.width]);

  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainerSize((current) =>
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height }
    );
  }, []);

  const stopSharedElementAnimations = useCallback(() => {
    cancelAnimation(pickerOpacity);
    cancelAnimation(amountOpacity);
    cancelAnimation(amountContentOpacity);
    cancelAnimation(amountContentTranslateY);
    cancelAnimation(sharedAvatarX);
    cancelAnimation(sharedAvatarY);
    cancelAnimation(sharedAvatarScale);
    cancelAnimation(sharedAvatarOpacity);
  }, [
    amountOpacity,
    amountContentOpacity,
    amountContentTranslateY,
    pickerOpacity,
    sharedAvatarOpacity,
    sharedAvatarScale,
    sharedAvatarX,
    sharedAvatarY,
  ]);

  const resetToPicker = useCallback(() => {
    stopSharedElementAnimations();
    setSelectedPeer(null);
    setSelectedPeerRect(null);
    setSharedAvatarPeer(null);
    setAmountContentMounted(false);
    amountContentOpacity.set(0);
    amountContentTranslateY.set(AMOUNT_CONTENT_ENTER_OFFSET);
    sharedAvatarOpacity.set(0);
    pickerOpacity.set(
      withTiming(1, { duration: duration.quick, easing: Easing.out(Easing.cubic) })
    );
    amountOpacity.set(
      withTiming(0, { duration: duration.quick, easing: Easing.out(Easing.cubic) })
    );
    useNearPaySessionStore.getState().resetToPicker();
  }, [
    amountContentOpacity,
    amountContentTranslateY,
    amountOpacity,
    pickerOpacity,
    sharedAvatarOpacity,
    stopSharedElementAnimations,
  ]);

  const handleSelectPeer = useCallback(
    async (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => {
      paymentLog.info('near_pay.peer.select', {
        peerID: peer.peerID,
        hasDirectLink: peer.hasDirectLink,
        isConnected: peer.isConnected,
      });
      setSelectedPeer(peer);
      setSelectedPeerRect(avatarRect);
      setAmountContentMounted(false);
      stopSharedElementAnimations();
      amountContentOpacity.set(0);
      amountContentTranslateY.set(AMOUNT_CONTENT_ENTER_OFFSET);
      setSharedAvatarPeer(peer);
      sharedAvatarX.set(avatarRect.x);
      sharedAvatarY.set(avatarRect.y);
      sharedAvatarScale.set(1);
      sharedAvatarOpacity.set(1);
      useNearPaySessionStore.getState().start({
        peerID: peer.peerID,
        nickname: peer.name,
        hasDirectLink: peer.hasDirectLink,
        lastSeen: peer.lastSeen,
      });
      try {
        await machine.startSendEcash({
          reset: true,
          recipientProfile: { displayName: peer.name, avatarUrl: null, nip05: null },
        });
      } catch (err) {
        setSelectedPeer(null);
        setSelectedPeerRect(null);
        setSharedAvatarPeer(null);
        setAmountContentMounted(false);
        amountContentOpacity.set(0);
        amountContentTranslateY.set(AMOUNT_CONTENT_ENTER_OFFSET);
        useNearPaySessionStore.getState().clear();
        paymentLog.error('near_pay.peer.start_send_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [
      machine,
      amountContentOpacity,
      amountContentTranslateY,
      sharedAvatarOpacity,
      sharedAvatarScale,
      sharedAvatarX,
      sharedAvatarY,
      stopSharedElementAnimations,
    ]
  );

  const playAmountContentEnter = useCallback(
    (delayMs = 0) => {
      setAmountContentMounted(true);
      amountContentOpacity.set(0);
      amountContentTranslateY.set(AMOUNT_CONTENT_ENTER_OFFSET);
      amountContentOpacity.set(
        delayMs > 0
          ? withDelay(delayMs, withTiming(1, AMOUNT_CONTENT_ENTER_TIMING))
          : withTiming(1, AMOUNT_CONTENT_ENTER_TIMING)
      );
      amountContentTranslateY.set(
        delayMs > 0
          ? withDelay(delayMs, withTiming(0, AMOUNT_CONTENT_ENTER_TIMING))
          : withTiming(0, AMOUNT_CONTENT_ENTER_TIMING)
      );
    },
    [amountContentOpacity, amountContentTranslateY]
  );

  useEffect(() => {
    if (!inlineAmountEntry) {
      stopSharedElementAnimations();
      setSharedAvatarPeer(null);
      setAmountContentMounted(false);
      amountContentOpacity.set(0);
      amountContentTranslateY.set(AMOUNT_CONTENT_ENTER_OFFSET);
      sharedAvatarOpacity.set(0);
      pickerOpacity.set(1);
      amountOpacity.set(0);
      return;
    }
    if (inlinePhase !== 'transitioning') return;
    if (!activeRecipientPeer || !headerAvatarRect) {
      useNearPaySessionStore.getState().showAmount();
      return;
    }
    if (!selectedPeerRect) {
      pickerOpacity.set(withTiming(0, AMOUNT_CONTENT_ENTER_TIMING));
      amountOpacity.set(withTiming(1, AMOUNT_CONTENT_ENTER_TIMING));
      playAmountContentEnter();
      useNearPaySessionStore.getState().showAmount();
      return;
    }

    stopSharedElementAnimations();
    setSharedAvatarPeer(activeRecipientPeer);
    sharedAvatarX.set(selectedPeerRect.x);
    sharedAvatarY.set(selectedPeerRect.y);
    sharedAvatarScale.set(1);
    sharedAvatarOpacity.set(1);

    const easing = Easing.out(Easing.cubic);
    const sharedTiming = { duration: SHARED_AVATAR_ANIMATION_MS, easing };
    const panelTiming = { duration: Math.round(SHARED_AVATAR_ANIMATION_MS * 0.75), easing };
    pickerOpacity.set(withTiming(0, panelTiming));
    amountOpacity.set(withDelay(90, withTiming(1, panelTiming)));
    playAmountContentEnter(AMOUNT_CONTENT_ENTER_DELAY_MS);
    sharedAvatarX.set(
      withTiming(headerAvatarRect.x + headerAvatarRect.size / 2 - AVATAR_SIZE / 2, sharedTiming)
    );
    sharedAvatarY.set(
      withTiming(headerAvatarRect.y + headerAvatarRect.size / 2 - AVATAR_SIZE / 2, sharedTiming)
    );
    sharedAvatarScale.set(withTiming(headerAvatarRect.size / selectedPeerRect.size, sharedTiming));

    const timeout = setTimeout(() => {
      useNearPaySessionStore.getState().showAmount();
      sharedAvatarOpacity.set(0);
      setSharedAvatarPeer(null);
    }, SHARED_AVATAR_ANIMATION_MS + 40);
    return () => clearTimeout(timeout);
  }, [
    activeRecipientPeer,
    amountContentOpacity,
    amountContentTranslateY,
    amountOpacity,
    headerAvatarRect,
    inlineAmountEntry,
    inlinePhase,
    pickerOpacity,
    playAmountContentEnter,
    selectedPeerRect,
    sharedAvatarOpacity,
    sharedAvatarScale,
    sharedAvatarX,
    sharedAvatarY,
    stopSharedElementAnimations,
  ]);

  useEffect(() => {
    if (!inlineAmountEntry || inlinePhase !== 'amount' || amountContentMounted) return;
    playAmountContentEnter();
  }, [amountContentMounted, inlineAmountEntry, inlinePhase, playAmountContentEnter]);

  const pickerPanelStyle = useAnimatedStyle(() => ({
    opacity: pickerOpacity.get(),
  }));

  const amountPanelStyle = useAnimatedStyle(() => ({
    opacity: amountOpacity.get(),
  }));

  const amountContentStyle = useAnimatedStyle(() => ({
    opacity: amountContentOpacity.get(),
    transform: [{ translateY: amountContentTranslateY.get() }],
  }));

  const sharedAvatarStyle = useAnimatedStyle(() => ({
    opacity: sharedAvatarOpacity.get(),
    transform: [
      { translateX: sharedAvatarX.get() },
      { translateY: sharedAvatarY.get() },
      { scale: sharedAvatarScale.get() },
    ],
  }));
  const pickerPanelCombinedStyle = useMemo(
    () => [styles.panel, pickerPanelStyle],
    [pickerPanelStyle]
  );
  const amountPanelCombinedStyle = useMemo(
    () => [styles.panel, styles.amountPanel, amountPanelStyle],
    [amountPanelStyle]
  );
  const amountContentCombinedStyle = useMemo(
    () => [styles.inlineAmountBody, amountContentStyle],
    [amountContentStyle]
  );
  const sharedAvatarCombinedStyle = useMemo(
    () => [styles.sharedAvatar, sharedAvatarStyle],
    [sharedAvatarStyle]
  );

  const unavailable = Platform.OS !== 'ios';
  const amountActive = !!inlineAmountEntry;
  const sharedAvatarVisible = !!sharedAvatarPeer || inlinePhase === 'transitioning';
  const foregroundSoft = useMemo(() => opacity(foreground, alpha.soft), [foreground]);
  const foregroundProminent = useMemo(() => opacity(foreground, alpha.prominent), [foreground]);
  const foregroundMuted = useMemo(() => opacity(foreground, alpha.muted), [foreground]);
  const emptyTitleStyle = useMemo(() => ({ color: foregroundProminent }), [foregroundProminent]);
  const sharedAvatarNameStyle = useMemo(
    () => [styles.peerAvatarName, { color: foregroundProminent }],
    [foregroundProminent]
  );
  const emptyTextStyle = useMemo(
    () => [styles.emptyText, { color: foregroundMuted }],
    [foregroundMuted]
  );
  const emptyContent = useMemo(
    () => (
      <VStack align="center" justify="center" gap={spacing.md} style={styles.emptyState}>
        <Icon name="mdi:bluetooth" size={iconSize['3xl']} color={foregroundSoft} />
        <Text size={17} weight="bold" style={emptyTitleStyle}>
          Scanning nearby
        </Text>
        <Text size={13} style={emptyTextStyle}>
          Keep Sovran open and nearby BitChat users will appear as fallback avatars.
        </Text>
      </VStack>
    ),
    [emptyTextStyle, emptyTitleStyle, foregroundSoft]
  );
  const unavailableContent = useMemo(
    () => (
      <VStack align="center" justify="center" gap={spacing.md} style={styles.emptyState}>
        <Icon name="mdi:bluetooth" size={iconSize['3xl']} color={foregroundSoft} />
        <Text size={17} weight="bold" style={emptyTitleStyle}>
          Near Pay is unavailable here
        </Text>
        <Text size={13} style={emptyTextStyle}>
          BitChat BLE is Apple-only, so this screen stays quiet on this platform.
        </Text>
      </VStack>
    ),
    [emptyTextStyle, emptyTitleStyle, foregroundSoft]
  );
  const renderHeaderLeft = useCallback(
    () => (
      <Pressable onPress={resetToPicker} hitSlop={8} style={styles.flowHeaderButton}>
        <Icon name="material-symbols:arrow-back-rounded" size={24} color={foreground} />
      </Pressable>
    ),
    [foreground, resetToPicker]
  );
  const renderEmptyHeader = useCallback(() => null, []);
  const renderHeaderRight = useCallback(
    () => <HeaderBadge count={reachableCount} onPress={refresh} />,
    [reachableCount, refresh]
  );
  const stackOptions = useMemo(
    () => ({
      title: amountActive ? '' : 'Near Pay',
      headerTitle: amountActive ? renderEmptyHeader : undefined,
      headerBackVisible: false,
      headerLeft: amountActive ? renderHeaderLeft : undefined,
      headerRight: amountActive ? renderEmptyHeader : renderHeaderRight,
    }),
    [amountActive, renderEmptyHeader, renderHeaderLeft, renderHeaderRight]
  );

  return (
    <>
      <Stack.Screen options={stackOptions} />
      <Screen name="NearPayScreen" scroll="none" contentPadding={0} bottomPadding={0}>
        <View onLayout={handleContainerLayout} style={styles.container}>
          {unavailable ? (
            unavailableContent
          ) : (
            <>
              <Animated.View
                pointerEvents={amountActive ? 'none' : 'auto'}
                style={pickerPanelCombinedStyle}>
                <NearPayPeerField
                  peers={peers}
                  emptyContent={emptyContent}
                  onSelect={handleSelectPeer}
                  selectedPeerID={sharedAvatarPeer?.peerID ?? null}
                />
              </Animated.View>
              {inlineAmountEntry && activeRecipientPeer ? (
                <Animated.View
                  pointerEvents={inlinePhase === 'amount' ? 'auto' : 'none'}
                  style={amountPanelCombinedStyle}>
                  <NearPayAmountHeader
                    recipient={activeRecipientPeer}
                    hideAvatar={sharedAvatarVisible}
                  />
                  <Animated.View style={amountContentCombinedStyle}>
                    {amountContentMounted ? (
                      <AmountFlowContent amountEntry={inlineAmountEntry} headerMode="none" />
                    ) : null}
                  </Animated.View>
                </Animated.View>
              ) : null}
              {sharedAvatarPeer ? (
                <Animated.View pointerEvents="none" style={sharedAvatarCombinedStyle}>
                  <View pointerEvents="none" style={styles.peerAvatarFrame}>
                    <Avatar
                      state="fallback"
                      size={AVATAR_SIZE}
                      name={sharedAvatarPeer.name}
                      seed={sharedAvatarPeer.peerID}
                      alt={`${sharedAvatarPeer.name} avatar`}
                    />
                    <View pointerEvents="none" style={styles.peerAvatarNameOverlay}>
                      <Text
                        size={PEER_AVATAR_NAME_SIZE}
                        weight="bold"
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        allowFontScaling={false}
                        style={sharedAvatarNameStyle}>
                        {sharedAvatarPeer.name}
                      </Text>
                    </View>
                  </View>
                </Animated.View>
              ) : null}
            </>
          )}
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  panel: {
    ...StyleSheet.absoluteFillObject,
  },
  amountPanel: {
    zIndex: zIndex.raised,
  },
  field: {
    flex: 1,
    overflow: 'hidden',
  },
  peerNode: {
    position: 'absolute',
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    zIndex: zIndex.sticky,
  },
  peerPressable: {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: PEER_AVATAR_TOP,
  },
  peerPressableHidden: {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: PEER_AVATAR_TOP,
    opacity: 0,
  },
  peerAvatarFrame: {
    position: 'relative',
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  peerAvatarNameOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  peerAvatarName: {
    width: '100%',
    textAlign: 'center',
    includeFontPadding: false,
  },
  sharedElementHidden: {
    opacity: 0,
  },
  sharedAvatar: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    zIndex: zIndex.overlay,
  },
  inlineAmountHeader: {
    height: INLINE_AMOUNT_HEADER_HEIGHT,
    paddingTop: INLINE_AMOUNT_HEADER_TOP,
  },
  inlineAmountBody: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
  },
  emptyText: {
    maxWidth: 280,
    textAlign: 'center',
    lineHeight: 18,
  },
  headerBadgePressable: {
    padding: spacing.sm,
  },
  headerBadge: {
    position: 'absolute',
    right: -6,
    top: -5,
    minWidth: 16,
    height: 16,
    paddingHorizontal: spacing.xs,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadgeText: {
    fontWeight: '700',
    lineHeight: 12,
  },
  flowHeaderButton: {
    padding: spacing.sm,
  },
});
