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
import {
  getMockBLEPeerProfile,
  MOCK_BLE_PEER_PROFILES,
  type MockBLEPeerProfile,
} from '@/features/bitchat/lib/mockBLEPeers';
import { AmountFlowContent } from '@/features/send/screens/AmountFlowScreen';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { resolveIdentityName } from '@/shared/lib/identity';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { prefetchImages } from '@/shared/lib/imageCache';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Screen } from '@/shared/ui/composed/Screen';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { alpha, duration, iconSize, spacing, zIndex } from '@/shared/styles/tokens';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import {
  buildPeerLayoutTargets,
  getPeerLayoutOverviewTransform,
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
const NEAR_PAY_ACTION_ROW_HEIGHT = 76;
const NEAR_PAY_ACTION_ROW_BOTTOM = spacing['3xl'];
const NODE_WIDTH = 76;
const NODE_HEIGHT = 74;
const PEER_AVATAR_TOP = spacing.xs;
const PEER_AVATAR_CENTER_Y = PEER_AVATAR_TOP + AVATAR_SIZE / 2;
const PEER_AVATAR_GAP = spacing.sm;
const PEER_AVATAR_SPACIOUS_GAP = spacing['4xl'];
const PEER_AVATAR_SPACIOUS_COUNT = 7;
const PEER_AVATAR_DENSE_COUNT = 31;
const PEER_AVATAR_SPACING_CAP_COUNT = 20;
const PEER_CANDIDATE_HEADER_AVOIDANCE = spacing['4xl'] + spacing['3xl'];
const PEER_CANDIDATE_ACTION_AVOIDANCE =
  NEAR_PAY_ACTION_ROW_HEIGHT + NEAR_PAY_ACTION_ROW_BOTTOM + spacing.lg;
const PEER_AVATAR_NAME_SIZE = 10;
const DOT_SPACING = 18;
const DOT_RADIUS = 1;
const FIELD_EDGE_PADDING = 0;
const EDGE_SCALE_FALLOFF = AVATAR_SIZE * 2;
const EDGE_BOUNDARY_SCALE = 0.9;
const EDGE_TRANSLATION_STRENGTH = 1;
const MIN_VISIBLE_PEER_SCALE = 0.16;
const PEER_LABEL_MIN_SCALE = 0.58;
const PEER_PAN_RUBBER_BAND_FACTOR = 0.36;
const PEER_PAN_MOMENTUM_SECONDS = 0.18;
const PEER_ENTRY_ANIMATION_MS = 460;
const PEER_REBALANCE_ANIMATION_MS = 320;
const PEER_OVERVIEW_SIDE_INSET = spacing.lg;
const PEER_OVERVIEW_TOP_INSET = spacing.lg;
const PEER_OVERVIEW_BOTTOM_INSET = PEER_CANDIDATE_ACTION_AVOIDANCE;
const PEER_OVERVIEW_MAX_SCALE = 0.84;
const PEER_OVERVIEW_SCALE_FACTOR = 0.94;
const SHARED_AVATAR_ANIMATION_MS = 430;
const AMOUNT_PANEL_SHIFT_MAX_X = 80;
const AMOUNT_PANEL_SHIFT_MAX_Y = 190;
const AMOUNT_CONTENT_ENTER_OFFSET = spacing.sm;
const AMOUNT_CONTENT_ENTER_DELAY_MS = duration.instant;
type MockBLEPeerProfileWithPicture = MockBLEPeerProfile & { picture: string };
const MOCK_BLE_PEER_AVATAR_PRELOAD_PROFILES = MOCK_BLE_PEER_PROFILES.filter(
  (profile): profile is MockBLEPeerProfileWithPicture => !!profile.picture
);
const MOCK_BLE_PEER_AVATAR_PRELOAD_URLS = MOCK_BLE_PEER_AVATAR_PRELOAD_PROFILES.map(
  (profile) => profile.picture
);
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
const PEER_LABEL_FADE_TIMING = {
  duration: duration.quick,
  easing: Easing.out(Easing.cubic),
};
const PEER_PAN_SETTLE_SPRING = {
  damping: 24,
  stiffness: 220,
  mass: 0.9,
};
const PEER_OVERVIEW_TIMING = {
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
  spaciousAvatarGap: PEER_AVATAR_SPACIOUS_GAP,
  spaciousPeerCount: PEER_AVATAR_SPACIOUS_COUNT,
  densePeerCount: PEER_AVATAR_DENSE_COUNT,
  spacingCapPeerCount: PEER_AVATAR_SPACING_CAP_COUNT,
  preferredTopInset: PEER_CANDIDATE_HEADER_AVOIDANCE,
  preferredBottomInset: PEER_CANDIDATE_ACTION_AVOIDANCE,
  edgePadding: FIELD_EDGE_PADDING,
  edgeScaleFalloff: EDGE_SCALE_FALLOFF,
  edgeBoundaryScale: EDGE_BOUNDARY_SCALE,
  edgeTranslationStrength: EDGE_TRANSLATION_STRENGTH,
  minVisibleScale: MIN_VISIBLE_PEER_SCALE,
  labelMinScale: PEER_LABEL_MIN_SCALE,
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
  const mockProfile = getMockBLEPeerProfile(peer.peerID);

  return {
    peerID: peer.peerID,
    nickname: peer.nickname,
    isConnected: peer.isConnected,
    hasDirectLink: peer.hasDirectLink,
    lastSeen: peer.lastSeen,
    name: peerDisplayName(peer),
    avatarUrl: mockProfile?.picture ?? null,
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

const MockPeerAvatarPreloader = React.memo(function MockPeerAvatarPreloader({
  profiles,
}: {
  profiles: readonly MockBLEPeerProfileWithPicture[];
}) {
  if (profiles.length === 0) return null;

  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      collapsable={false}
      style={styles.mockAvatarPreloader}>
      {profiles.map((profile) => (
        <Avatar
          key={profile.peerID}
          state="image"
          picture={profile.picture}
          size={AVATAR_SIZE}
          name={profile.nickname}
          seed={profile.peerID}
          alt=""
        />
      ))}
    </View>
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
  overviewScale,
  overviewTranslateX,
  overviewTranslateY,
  isPanning,
  onSelect,
  hideSharedElementSource,
}: {
  target: PeerLayoutTarget;
  fieldSize: PeerLayoutSize;
  panX: SharedValue<number>;
  panY: SharedValue<number>;
  overviewScale: SharedValue<number>;
  overviewTranslateX: SharedValue<number>;
  overviewTranslateY: SharedValue<number>;
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
  const viewportOpacityProgress = useSharedValue(target.scale > 0 ? 1 : 0);
  const labelOpacityProgress = useSharedValue(target.scale >= PEER_LABEL_MIN_SCALE ? 1 : 0);

  useEffect(() => {
    const firstPlacement = !hasAnimatedInRef.current;
    if (firstPlacement) {
      baseX.set(target.x);
      baseY.set(target.y);
      nodeOpacity.set(0);
      visibilityScale.set(0);
      viewportOpacityProgress.set(target.scale > 0 ? 1 : 0);
      hasAnimatedInRef.current = true;
    }
    cancelAnimation(baseX);
    cancelAnimation(baseY);
    cancelAnimation(nodeOpacity);
    cancelAnimation(visibilityScale);
    cancelAnimation(viewportOpacityProgress);
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
  }, [
    baseX,
    baseY,
    nodeOpacity,
    target.phase,
    target.scale,
    target.x,
    target.y,
    viewportOpacityProgress,
    visibilityScale,
  ]);

  useAnimatedReaction(
    () => {
      const overviewScaleValue = overviewScale.get();
      const overviewTranslateXValue = overviewTranslateX.get();
      const overviewTranslateYValue = overviewTranslateY.get();
      const overviewActive =
        overviewScaleValue < 0.999 ||
        Math.abs(overviewTranslateXValue) > 0.5 ||
        Math.abs(overviewTranslateYValue) > 0.5;
      if (overviewActive) {
        return {
          isTrackingPan: true,
          avatarOpacity: 1,
          scale: 1,
        };
      }

      const rawCenterX = baseX.get() + NODE_WIDTH / 2 + panX.get();
      const rawCenterY = baseY.get() + NODE_HEIGHT / 2 + panY.get();
      const avatarRadius = AVATAR_SIZE / 2;
      const edgeDistance = Math.min(
        rawCenterX - FIELD_EDGE_PADDING,
        fieldSize.width - FIELD_EDGE_PADDING - rawCenterX,
        rawCenterY - FIELD_EDGE_PADDING,
        fieldSize.height - FIELD_EDGE_PADDING - rawCenterY
      );
      if (fieldSize.width <= 0 || fieldSize.height <= 0 || AVATAR_SIZE <= 0) {
        return {
          isTrackingPan: isPanning.get(),
          avatarOpacity: 0,
          scale: 0,
        };
      }

      const fitScale = Math.min(Math.max((edgeDistance + avatarRadius) / (avatarRadius * 2), 0), 1);
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
          : rawViewportScale <= 0
            ? MIN_VISIBLE_PEER_SCALE
            : Math.max(rawViewportScale, MIN_VISIBLE_PEER_SCALE);
      const fadeProgress = Math.min(Math.max(rawViewportScale / MIN_VISIBLE_PEER_SCALE, 0), 1);
      const avatarOpacity =
        rawViewportScale >= MIN_VISIBLE_PEER_SCALE
          ? 1
          : fadeProgress * fadeProgress * (3 - 2 * fadeProgress);

      return {
        isTrackingPan: isPanning.get(),
        avatarOpacity,
        scale,
      };
    },
    (next, previous) => {
      const nextScale = next.scale;
      const previousScale = previous?.scale ?? null;
      const nextAvatarOpacity = next.avatarOpacity;
      const previousAvatarOpacity = previous?.avatarOpacity ?? null;
      const nextLabelOpacity = nextScale >= PEER_LABEL_MIN_SCALE ? 1 : 0;
      const previousLabelOpacity =
        previousScale === null ? null : previousScale >= PEER_LABEL_MIN_SCALE ? 1 : 0;

      if (previousScale === null || next.isTrackingPan || previous?.isTrackingPan) {
        cancelAnimation(viewportScaleProgress);
        viewportScaleProgress.set(nextScale);
        cancelAnimation(viewportOpacityProgress);
        viewportOpacityProgress.set(nextAvatarOpacity);
        if (previousLabelOpacity === null) {
          labelOpacityProgress.set(nextLabelOpacity);
        } else if (nextLabelOpacity !== previousLabelOpacity) {
          cancelAnimation(labelOpacityProgress);
          labelOpacityProgress.set(withTiming(nextLabelOpacity, PEER_LABEL_FADE_TIMING));
        }
        return;
      }
      if (
        previousAvatarOpacity === null ||
        Math.abs(nextAvatarOpacity - previousAvatarOpacity) >= 0.01
      ) {
        cancelAnimation(viewportOpacityProgress);
        viewportOpacityProgress.set(withTiming(nextAvatarOpacity, PEER_LABEL_FADE_TIMING));
      }
      if (nextLabelOpacity !== previousLabelOpacity) {
        cancelAnimation(labelOpacityProgress);
        labelOpacityProgress.set(withTiming(nextLabelOpacity, PEER_LABEL_FADE_TIMING));
      }
      if (Math.abs(nextScale - previousScale) < 0.002) return;

      cancelAnimation(viewportScaleProgress);
      viewportScaleProgress.set(
        nextScale > previousScale
          ? withSpring(nextScale, PEER_VIEWPORT_SCALE_GROW_SPRING)
          : withTiming(nextScale, PEER_VIEWPORT_SCALE_SHRINK_TIMING)
      );
    },
    [
      fieldSize.height,
      fieldSize.width,
      isPanning,
      labelOpacityProgress,
      overviewScale,
      overviewTranslateX,
      overviewTranslateY,
      viewportOpacityProgress,
    ]
  );

  const animatedStyle = useAnimatedStyle(() => {
    const rawCenterX = baseX.get() + NODE_WIDTH / 2 + panX.get();
    const rawCenterY = baseY.get() + NODE_HEIGHT / 2 + panY.get();
    const overviewScaleValue = overviewScale.get();
    const overviewTranslateXValue = overviewTranslateX.get();
    const overviewTranslateYValue = overviewTranslateY.get();
    const overviewActive =
      overviewScaleValue < 0.999 ||
      Math.abs(overviewTranslateXValue) > 0.5 ||
      Math.abs(overviewTranslateYValue) > 0.5;
    if (overviewActive) {
      const centerX =
        fieldSize.width / 2 +
        (rawCenterX - fieldSize.width / 2) * overviewScaleValue +
        overviewTranslateXValue;
      const centerY =
        fieldSize.height / 2 +
        (rawCenterY - fieldSize.height / 2) * overviewScaleValue +
        overviewTranslateYValue;
      const totalScale = overviewScaleValue * visibilityScale.get();
      const scaledAvatarCenterY =
        NODE_HEIGHT / 2 + totalScale * (PEER_AVATAR_CENTER_Y - NODE_HEIGHT / 2);

      return {
        opacity: nodeOpacity.get(),
        zIndex: zIndex.sticky,
        transform: [
          { translateX: centerX - NODE_WIDTH / 2 },
          { translateY: centerY - scaledAvatarCenterY },
          { scale: totalScale },
        ],
      };
    }

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
      opacity: nodeOpacity.get() * viewportOpacityProgress.get(),
      zIndex: zIndex.sticky + Math.round(layoutViewportScale * 100),
      transform: [
        { translateX: centerX - NODE_WIDTH / 2 },
        { translateY: centerY - scaledAvatarCenterY },
        { scale: totalScale },
      ],
    };
  });
  const labelAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: labelOpacityProgress.get() * visibilityScale.get() * viewportOpacityProgress.get(),
    };
  });
  const nodeStyle = useMemo(() => [styles.peerNode, animatedStyle], [animatedStyle]);
  const peerAvatarNameLabelStyle = useMemo(
    () => [styles.peerAvatarNameLabel, labelAnimatedStyle],
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
    if (presentation.scale <= 0 || presentation.avatarOpacity <= 0.05) return;
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
            state={target.peer.avatarUrl ? 'image' : 'fallback'}
            picture={target.peer.avatarUrl ?? undefined}
            size={AVATAR_SIZE}
            name={target.peer.name}
            seed={target.peer.peerID}
            alt={`${target.peer.name} avatar`}
          />
        </View>
        <Animated.View pointerEvents="none" style={peerAvatarNameLabelStyle}>
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

function getSharedAvatarTransform(rect: AvatarRect): { x: number; y: number; scale: number } {
  return {
    x: rect.x + rect.size / 2 - AVATAR_SIZE / 2,
    y: rect.y + rect.size / 2 - AVATAR_SIZE / 2,
    scale: rect.size / AVATAR_SIZE,
  };
}

function getAmountPanelStartShift(sourceRect: AvatarRect, headerRect: AvatarRect) {
  const sourceCenterX = sourceRect.x + sourceRect.size / 2;
  const sourceCenterY = sourceRect.y + sourceRect.size / 2;
  const headerCenterX = headerRect.x + headerRect.size / 2;
  const headerCenterY = headerRect.y + headerRect.size / 2;

  return {
    x: clampNumber(
      sourceCenterX - headerCenterX,
      -AMOUNT_PANEL_SHIFT_MAX_X,
      AMOUNT_PANEL_SHIFT_MAX_X
    ),
    y: clampNumber(
      sourceCenterY - headerCenterY,
      -AMOUNT_PANEL_SHIFT_MAX_Y,
      AMOUNT_PANEL_SHIFT_MAX_Y
    ),
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
    overviewScale: SharedValue<number>;
    overviewTranslateX: SharedValue<number>;
    overviewTranslateY: SharedValue<number>;
    isPanning: SharedValue<boolean>;
    onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
    hideSharedElementSource?: boolean;
  },
  next: {
    target: PeerLayoutTarget;
    fieldSize: PeerLayoutSize;
    panX: SharedValue<number>;
    panY: SharedValue<number>;
    overviewScale: SharedValue<number>;
    overviewTranslateX: SharedValue<number>;
    overviewTranslateY: SharedValue<number>;
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
    prev.overviewScale === next.overviewScale &&
    prev.overviewTranslateX === next.overviewTranslateX &&
    prev.overviewTranslateY === next.overviewTranslateY &&
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
          state={recipient.avatarUrl ? 'image' : 'fallback'}
          picture={recipient.avatarUrl ?? undefined}
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
  const overviewScale = useSharedValue(1);
  const overviewTranslateX = useSharedValue(0);
  const overviewTranslateY = useSharedValue(0);
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

  const handleFocus = useCallback(() => {
    isPanning.set(true);
    isPanSettling.set(true);
    panSettleRemaining.set(2);
    cancelAnimation(panX);
    cancelAnimation(panY);
    panX.set(
      withSpring(0, PEER_PAN_SETTLE_SPRING, (finished) => {
        if (!finished) return;
        const remaining = panSettleRemaining.get() - 1;
        panSettleRemaining.set(remaining);
        if (remaining > 0) return;
        isPanSettling.set(false);
        isPanning.set(false);
      })
    );
    panY.set(
      withSpring(0, PEER_PAN_SETTLE_SPRING, (finished) => {
        if (!finished) return;
        const remaining = panSettleRemaining.get() - 1;
        panSettleRemaining.set(remaining);
        if (remaining > 0) return;
        isPanSettling.set(false);
        isPanning.set(false);
      })
    );
  }, [isPanSettling, isPanning, panSettleRemaining, panX, panY]);

  const hasSelectablePeer = targets.some((target) => target.phase !== 'exiting');

  const handleOverviewPressIn = useCallback(() => {
    const pan = { x: panX.get(), y: panY.get() };
    const overview = getPeerLayoutOverviewTransform(
      targets,
      fieldSize,
      PEER_LAYOUT_CONFIG,
      pan,
      {
        top: PEER_OVERVIEW_TOP_INSET,
        right: PEER_OVERVIEW_SIDE_INSET,
        bottom: PEER_OVERVIEW_BOTTOM_INSET,
        left: PEER_OVERVIEW_SIDE_INSET,
      },
      PEER_OVERVIEW_MAX_SCALE,
      PEER_OVERVIEW_SCALE_FACTOR
    );

    cancelAnimation(overviewScale);
    cancelAnimation(overviewTranslateX);
    cancelAnimation(overviewTranslateY);
    overviewScale.set(withTiming(overview.scale, PEER_OVERVIEW_TIMING));
    overviewTranslateX.set(withTiming(overview.translateX, PEER_OVERVIEW_TIMING));
    overviewTranslateY.set(withTiming(overview.translateY, PEER_OVERVIEW_TIMING));
  }, [fieldSize, overviewScale, overviewTranslateX, overviewTranslateY, panX, panY, targets]);

  const handleOverviewPressOut = useCallback(() => {
    cancelAnimation(overviewScale);
    cancelAnimation(overviewTranslateX);
    cancelAnimation(overviewTranslateY);
    overviewScale.set(withTiming(1, PEER_OVERVIEW_TIMING));
    overviewTranslateX.set(withTiming(0, PEER_OVERVIEW_TIMING));
    overviewTranslateY.set(withTiming(0, PEER_OVERVIEW_TIMING));
  }, [overviewScale, overviewTranslateX, overviewTranslateY]);

  const handleRandomPeer = useCallback(() => {
    const pan = { x: panX.get(), y: panY.get() };
    const selectableTargets = targets.filter((target) => {
      if (target.phase === 'exiting') return false;
      const presentation = getPeerViewportPresentation(target, fieldSize, PEER_LAYOUT_CONFIG, pan);
      return presentation.scale > 0 && presentation.avatarOpacity > 0.05;
    });
    if (selectableTargets.length === 0) return;

    const randomIndex = Math.floor(Math.random() * selectableTargets.length);
    const target = selectableTargets[randomIndex];
    if (!target) return;

    onSelect(target.peer, getScaledAvatarRect(target, fieldSize, pan));
  }, [fieldSize, onSelect, panX, panY, targets]);

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
                ...PEER_PAN_SETTLE_SPRING,
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
                ...PEER_PAN_SETTLE_SPRING,
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
    <View onLayout={handleLayout} style={styles.field}>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={styles.fieldCanvas}>
          <DotField size={fieldSize} foreground={foreground} />
          {registry.length === 0 ? emptyContent : null}
          {targets.map((target) => (
            <PeerNode
              key={target.peer.peerID}
              target={target}
              fieldSize={fieldSize}
              panX={panX}
              panY={panY}
              overviewScale={overviewScale}
              overviewTranslateX={overviewTranslateX}
              overviewTranslateY={overviewTranslateY}
              isPanning={isPanning}
              onSelect={onSelect}
              hideSharedElementSource={selectedPeerID === target.peer.peerID}
            />
          ))}
        </Animated.View>
      </GestureDetector>
      <HStack justify="space-around" style={styles.nearPayActionRow}>
        <CircleActionButton
          icon="mdi:shuffle-variant"
          systemIcon="shuffle"
          label="Random"
          testID="near-pay-random"
          accessibilityHint="Pick a random nearby peer."
          disabled={!hasSelectablePeer}
          onPress={handleRandomPeer}
        />
        <CircleActionButton
          icon="mdi:crosshairs-gps"
          systemIcon="scope"
          label="Focus"
          testID="near-pay-focus"
          accessibilityHint="Return the peer field to the center."
          onPress={handleFocus}
        />
        <CircleActionButton
          icon="mdi:fullscreen"
          systemIcon="minus.magnifyingglass"
          label="Zoom"
          testID="near-pay-overview"
          accessibilityHint="Hold to zoom out and fit all peers."
          disabled={targets.length === 0}
          onPressIn={handleOverviewPressIn}
          onPressOut={handleOverviewPressOut}
        />
      </HStack>
    </View>
  );
}

export function NearPayScreen() {
  useLifecycleLogger('NearPayScreen');
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });
  const { peers, refresh } = useBLEPeers();
  const mockMode = useSettingsStore((state) => state.mockMode);
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
  const amountPanelTranslateX = useSharedValue(0);
  const amountPanelTranslateY = useSharedValue(0);
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

  useEffect(() => {
    if (!mockMode) return;
    void prefetchImages(MOCK_BLE_PEER_AVATAR_PRELOAD_URLS);
  }, [mockMode]);

  const activeRecipientPeer = useMemo<NearPayLayoutPeer | null>(() => {
    const recipient = nearPaySession?.recipient;
    if (!recipient) return null;
    if (selectedPeer?.peerID === recipient.peerID) return selectedPeer;
    const mockProfile = getMockBLEPeerProfile(recipient.peerID);
    return {
      peerID: recipient.peerID,
      nickname: recipient.nickname,
      name: recipient.nickname,
      isConnected: true,
      hasDirectLink: recipient.hasDirectLink,
      lastSeen: recipient.lastSeen,
      avatarUrl: mockProfile?.picture ?? null,
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
    cancelAnimation(amountPanelTranslateX);
    cancelAnimation(amountPanelTranslateY);
    cancelAnimation(amountContentOpacity);
    cancelAnimation(amountContentTranslateY);
    cancelAnimation(sharedAvatarX);
    cancelAnimation(sharedAvatarY);
    cancelAnimation(sharedAvatarScale);
    cancelAnimation(sharedAvatarOpacity);
  }, [
    amountOpacity,
    amountPanelTranslateX,
    amountPanelTranslateY,
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
    amountPanelTranslateX.set(0);
    amountPanelTranslateY.set(0);
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
    amountPanelTranslateX,
    amountPanelTranslateY,
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
      amountPanelTranslateX.set(0);
      amountPanelTranslateY.set(0);
      const sharedAvatarStart = getSharedAvatarTransform(avatarRect);
      sharedAvatarX.set(sharedAvatarStart.x);
      sharedAvatarY.set(sharedAvatarStart.y);
      sharedAvatarScale.set(sharedAvatarStart.scale);
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
          recipientProfile: {
            displayName: peer.name,
            avatarUrl: peer.avatarUrl ?? null,
            nip05: null,
          },
        });
      } catch (err) {
        setSelectedPeer(null);
        setSelectedPeerRect(null);
        setSharedAvatarPeer(null);
        setAmountContentMounted(false);
        amountPanelTranslateX.set(0);
        amountPanelTranslateY.set(0);
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
      amountPanelTranslateX,
      amountPanelTranslateY,
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
      amountPanelTranslateX.set(0);
      amountPanelTranslateY.set(0);
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
      amountPanelTranslateX.set(0);
      amountPanelTranslateY.set(0);
      pickerOpacity.set(withTiming(0, AMOUNT_CONTENT_ENTER_TIMING));
      amountOpacity.set(withTiming(1, AMOUNT_CONTENT_ENTER_TIMING));
      playAmountContentEnter();
      useNearPaySessionStore.getState().showAmount();
      return;
    }

    stopSharedElementAnimations();
    setSharedAvatarPeer(activeRecipientPeer);
    const sharedAvatarStart = getSharedAvatarTransform(selectedPeerRect);
    const sharedAvatarEnd = getSharedAvatarTransform(headerAvatarRect);
    const amountPanelStartShift = getAmountPanelStartShift(selectedPeerRect, headerAvatarRect);
    sharedAvatarX.set(sharedAvatarStart.x);
    sharedAvatarY.set(sharedAvatarStart.y);
    sharedAvatarScale.set(sharedAvatarStart.scale);
    sharedAvatarOpacity.set(1);
    amountPanelTranslateX.set(amountPanelStartShift.x);
    amountPanelTranslateY.set(amountPanelStartShift.y);

    const easing = Easing.out(Easing.cubic);
    const sharedTiming = { duration: SHARED_AVATAR_ANIMATION_MS, easing };
    const panelTiming = { duration: Math.round(SHARED_AVATAR_ANIMATION_MS * 0.75), easing };
    pickerOpacity.set(withTiming(0, panelTiming));
    amountOpacity.set(withTiming(1, panelTiming));
    amountPanelTranslateX.set(withTiming(0, sharedTiming));
    amountPanelTranslateY.set(withTiming(0, sharedTiming));
    playAmountContentEnter(AMOUNT_CONTENT_ENTER_DELAY_MS);
    sharedAvatarX.set(withTiming(sharedAvatarEnd.x, sharedTiming));
    sharedAvatarY.set(withTiming(sharedAvatarEnd.y, sharedTiming));
    sharedAvatarScale.set(withTiming(sharedAvatarEnd.scale, sharedTiming));

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
    amountPanelTranslateX,
    amountPanelTranslateY,
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
    transform: [
      { translateX: amountPanelTranslateX.get() },
      { translateY: amountPanelTranslateY.get() },
    ],
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
          Nut Drop is unavailable here
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
      title: amountActive ? '' : 'Nut Drop',
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
              {mockMode ? (
                <MockPeerAvatarPreloader profiles={MOCK_BLE_PEER_AVATAR_PRELOAD_PROFILES} />
              ) : null}
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
                      state={sharedAvatarPeer.avatarUrl ? 'image' : 'fallback'}
                      picture={sharedAvatarPeer.avatarUrl ?? undefined}
                      size={AVATAR_SIZE}
                      name={sharedAvatarPeer.name}
                      seed={sharedAvatarPeer.peerID}
                      alt={`${sharedAvatarPeer.name} avatar`}
                    />
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
  fieldCanvas: {
    ...StyleSheet.absoluteFillObject,
  },
  mockAvatarPreloader: {
    position: 'absolute',
    left: -AVATAR_SIZE * 3,
    top: -AVATAR_SIZE * 3,
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    opacity: 0,
    overflow: 'hidden',
  },
  nearPayActionRow: {
    alignItems: 'flex-start',
    bottom: NEAR_PAY_ACTION_ROW_BOTTOM,
    height: NEAR_PAY_ACTION_ROW_HEIGHT,
    left: 0,
    paddingHorizontal: 32,
    position: 'absolute',
    right: 0,
    zIndex: zIndex.overlay,
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
  peerAvatarNameLabel: {
    alignItems: 'center',
    justifyContent: 'center',
    width: NODE_WIDTH,
    height: spacing.lg,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  peerAvatarName: {
    width: '100%',
    textAlign: 'center',
    includeFontPadding: false,
    lineHeight: spacing.md,
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
