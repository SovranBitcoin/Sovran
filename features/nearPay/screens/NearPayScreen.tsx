import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { LayoutChangeEvent, Platform, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import type { BLEPeer } from 'bitchat-module';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedReaction,
  useDerivedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import opacity from 'hex-color-opacity';
import { usePaymentFlowMachine } from '@sovranbitcoin/colada/react';

import Icon from 'assets/icons';
import { useBLEPeers } from '@/features/bitchat/hooks/useBLEPeers';
import {
  BLE_PEER_FRESHNESS_TICK_MS,
  filterFreshBLEPeers,
} from '@/features/bitchat/lib/blePeerSnapshots';
import { LightningStrike } from '@/features/nearPay/components/LightningStrike';
import {
  CELEBRATION_LIGHTNING_PALETTE,
  NutDropCelebrationOverlay,
  type CelebrationPeerIdentity,
} from '@/features/nearPay/components/NutDropCelebrationOverlay';
import { useNutDropCelebration } from '@/features/nearPay/hooks/useNutDropCelebration';
import { useEagerPeerFavorite } from '@/features/nearPay/hooks/useEagerPeerFavorite';
import { useNutDropStrike } from '@/features/nearPay/hooks/useNutDropStrike';
import type { StrikeState } from '@/features/nearPay/lib/nutDropStrikeState';
import { peerAvatarState, peerNostrPubkey, toLayoutPeer } from '@/features/nearPay/lib/peerProfile';
import { planNearPaySend } from '@/features/nearPay/lib/nearPaySendDecision';
import { creqParseDiagnostics } from '@/shared/lib/nutCreq';
import {
  notifyNoSharedMint,
  notifyNutDropPeerNotReady,
} from '@/features/nearPay/lib/startNearPaySend';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import {
  useRecentPeopleProfiles,
  type RecentPeopleProfileRow,
} from '@/features/feed/hooks/useRecentPeopleProfiles';
import { normalizeRecentPersonPubkey } from '@/shared/stores/profile/recentPeopleStore';
import { useBluetoothState } from '@/features/bitchat/hooks/useBluetoothState';
import { BluetoothNotice } from '@/features/bitchat/components/BluetoothNotice';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { AmountFlowContent } from '@/features/send/screens/AmountFlowScreen';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { paymentLog, useLifecycleLogger, useRenderLogger } from '@/shared/lib/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useNearPaySessionStore, type NearPayDelivery } from '@/shared/stores/runtime/nearPayStore';
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
import {
  buildPeerLayoutConfigForSizing,
  getPeerFieldSizing,
  getPeerFieldSizingStep,
  type PeerFieldSizing,
  type PeerFieldSizingStep,
} from '@/features/nearPay/lib/peerFieldSizing';
import { buildDotFieldPathBuckets } from '@/features/nearPay/lib/dotField';
import {
  getCenteredAvatarRectInSlot,
  getSharedAvatarTransform,
  type AvatarRect,
} from '@/features/nearPay/lib/avatarTransition';

/** Header avatar slot size — the send-flow flight's landing size. */
const HEADER_AVATAR_SIZE = 48;
const AMOUNT_HEADER_AVATAR_SLOT_SIZE = 56;
const INLINE_AMOUNT_HEADER_TOP = spacing['4xl'];
const INLINE_AMOUNT_HEADER_HEIGHT = 126;
const NEAR_PAY_ACTION_ROW_HEIGHT = 76;
const NEAR_PAY_ACTION_ROW_BOTTOM = spacing['3xl'];
const DOT_SPACING = 18;
const DOT_RADIUS = 1;
/** Celebration band top — mirrors the honeycomb's header avoidance. */
const CELEBRATION_TOP_INSET = spacing['4xl'] + spacing['3xl'];
/** Stable element for the Android header-scrim opt-out (see stackOptions). */
const renderNullHeaderBackground = () => null;
const PEER_PAN_RUBBER_BAND_FACTOR = 0.36;
const PEER_PAN_MOMENTUM_SECONDS = 0.18;
const PEER_ENTRY_ANIMATION_MS = 460;
const PEER_REBALANCE_ANIMATION_MS = 320;
const PEER_OVERVIEW_SIDE_INSET = spacing.lg;
const PEER_OVERVIEW_TOP_INSET = spacing.lg;
const PEER_OVERVIEW_MAX_SCALE = 0.84;
const PEER_OVERVIEW_SCALE_FACTOR = 0.94;
const SHARED_AVATAR_ANIMATION_MS = 430;
const AMOUNT_CONTENT_PREWARM_MS = 120;
const AMOUNT_PANEL_SHIFT_MAX_X = 80;
const AMOUNT_PANEL_SHIFT_MAX_Y = 190;
const AMOUNT_CONTENT_ENTER_OFFSET = spacing.sm;
const AMOUNT_CONTENT_ENTER_TIMING = {
  duration: duration.standard,
  easing: Easing.out(Easing.cubic),
};
const NEAR_PAY_LAYOUT_CYCLE_INITIAL_LOG_COUNT = 8;
const NEAR_PAY_LAYOUT_CYCLE_PERIODIC_MS = 10_000;
const NEAR_PAY_LAYOUT_CYCLE_SLOW_LAYOUT_MS = 2;
const NEAR_PAY_LAYOUT_CYCLE_SLOW_TARGETS_MS = 4;
const NEAR_PAY_LAYOUT_CYCLE_SLOW_PAN_BOUNDS_MS = 1;
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
const PEER_NODE_THEME_KEYS = ['foreground', 'surface'] as const;
const HEADER_BADGE_THEME_KEYS = ['foreground', 'shade-400', 'accent', 'accent-foreground'] as const;

/**
 * Per-step node styles. Sizing values are module singletons (two steps), so
 * `useMemo` keyed on the sizing reference rebuilds these only on an actual
 * hero ↔ standard transition.
 */
function buildPeerNodeStyles(sizing: PeerFieldSizing) {
  const pressableBase = {
    width: sizing.nodeWidth,
    height: sizing.nodeHeight,
    alignItems: 'center' as const,
    justifyContent: 'flex-start' as const,
    paddingTop: sizing.avatarTop,
  };
  return {
    peerNode: {
      position: 'absolute' as const,
      width: sizing.nodeWidth,
      height: sizing.nodeHeight,
      zIndex: zIndex.sticky,
    },
    peerPressable: pressableBase,
    peerPressableHidden: { ...pressableBase, opacity: 0 },
    peerAvatarFrame: {
      position: 'relative' as const,
      width: sizing.avatarSize,
      height: sizing.avatarSize,
    },
    // Open-padlock chip marking peers still missing a valid creq capability.
    bearerBadge: {
      alignItems: 'center' as const,
      borderRadius: sizing.bearerBadgeSize / 2,
      bottom: -2,
      height: sizing.bearerBadgeSize,
      justifyContent: 'center' as const,
      position: 'absolute' as const,
      right: -2,
      width: sizing.bearerBadgeSize,
    },
    peerAvatarNameLabel: {
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      width: sizing.nodeWidth,
      height: spacing.lg,
      marginTop: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
  };
}

/**
 * Module-level cache keyed on the sizing singletons (two entries ever) —
 * every PeerNode shares the same style objects instead of allocating a set
 * per node per step flip. Same render-time-cache pattern as peerLayout's
 * slot cache.
 */
const PEER_NODE_STYLE_CACHE = new Map<PeerFieldSizing, ReturnType<typeof buildPeerNodeStyles>>();

function getPeerNodeStyles(sizing: PeerFieldSizing) {
  const cached = PEER_NODE_STYLE_CACHE.get(sizing);
  if (cached) return cached;
  const built = buildPeerNodeStyles(sizing);
  PEER_NODE_STYLE_CACHE.set(sizing, built);
  return built;
}

/** Screen rect + layout identity for a radar peer, or null if off-radar. */
type PeerStageResolver = (peerID: string) => { rect: AvatarRect; peer: NearPayLayoutPeer } | null;

interface AnimatedPeerViewportPresentation {
  centerX: number;
  centerY: number;
  scale: number;
  layoutScale: number;
  avatarOpacity: number;
  overviewScale: number;
  overviewActive: boolean;
}

type NearPayPerfSpan = {
  end: (params?: Record<string, unknown>) => void;
};

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function durationSinceMs(startedAtMs: number): number {
  return Math.round((nowMs() - startedAtMs) * 100) / 100;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
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
    <ScreenHeaderAction
      icon="mdi:account-group"
      size={iconSize.xl}
      color={count > 0 ? foreground : shade400}
      onPress={onPress}
      accessibilityLabel="Nearby peers"
      accessory={
        count > 0 ? (
          <View style={badgeStyle}>
            <Text size={10} style={badgeTextStyle}>
              {count}
            </Text>
          </View>
        ) : undefined
      }
    />
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
  const bucketResult = useMemo(() => {
    const startedAt = nowMs();
    const value = buildDotFieldPathBuckets({ width, height }, DOT_SPACING, DOT_RADIUS);
    return {
      value,
      bucketCount: value.length,
      pathChars: value.reduce((total, bucket) => total + bucket.d.length, 0),
      duration_ms: durationSinceMs(startedAt),
    };
  }, [height, width]);
  const buckets = bucketResult.value;

  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    paymentLog.debug('near_pay.perf.dot_field_built', {
      width: roundMetric(width),
      height: roundMetric(height),
      bucketCount: bucketResult.bucketCount,
      pathChars: bucketResult.pathChars,
      duration_ms: bucketResult.duration_ms,
    });
  }, [bucketResult, height, width]);

  if (width <= 0 || height <= 0 || buckets.length === 0) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
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
    a.peer.hasDirectLink === b.peer.hasDirectLink &&
    a.peer.lockable === b.peer.lockable &&
    a.peer.avatarUrl === b.peer.avatarUrl &&
    a.peer.profileLoading === b.peer.profileLoading
  );
}

const PeerNode = React.memo(function PeerNode({
  target,
  fieldSize,
  sizing,
  layoutConfig,
  panX,
  panY,
  overviewScale,
  overviewTranslateX,
  overviewTranslateY,
  onSelect,
  hideSharedElementSource,
  strike,
}: {
  target: PeerLayoutTarget;
  fieldSize: PeerLayoutSize;
  sizing: PeerFieldSizing;
  layoutConfig: PeerLayoutConfig;
  panX: SharedValue<number>;
  panY: SharedValue<number>;
  overviewScale: SharedValue<number>;
  overviewTranslateX: SharedValue<number>;
  overviewTranslateY: SharedValue<number>;
  onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
  hideSharedElementSource?: boolean;
  strike?: StrikeState | null;
}) {
  const [foreground, surface] = useThemeColor(PEER_NODE_THEME_KEYS);
  const hasAnimatedInRef = useRef(false);
  const baseX = useSharedValue(target.x);
  const baseY = useSharedValue(target.y);
  const nodeOpacity = useSharedValue(0);
  const visibilityScale = useSharedValue(0);
  const labelOpacityProgress = useSharedValue(target.scale >= layoutConfig.labelMinScale ? 1 : 0);
  const nodeStyles = getPeerNodeStyles(sizing);

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
  }, [baseX, baseY, nodeOpacity, target.phase, target.x, target.y, visibilityScale]);

  const viewportPresentation = useDerivedValue<AnimatedPeerViewportPresentation>(() => {
    const rawCenterX = baseX.get() + layoutConfig.nodeWidth / 2 + panX.get();
    const rawCenterY = baseY.get() + layoutConfig.nodeHeight / 2 + panY.get();
    const overviewScaleValue = overviewScale.get();
    const overviewTranslateXValue = overviewTranslateX.get();
    const overviewTranslateYValue = overviewTranslateY.get();
    const overviewActive =
      overviewScaleValue < 0.999 ||
      Math.abs(overviewTranslateXValue) > 0.5 ||
      Math.abs(overviewTranslateYValue) > 0.5;
    if (overviewActive) {
      return {
        centerX:
          fieldSize.width / 2 +
          (rawCenterX - fieldSize.width / 2) * overviewScaleValue +
          overviewTranslateXValue,
        centerY:
          fieldSize.height / 2 +
          (rawCenterY - fieldSize.height / 2) * overviewScaleValue +
          overviewTranslateYValue,
        scale: 1,
        layoutScale: 1,
        avatarOpacity: 1,
        overviewScale: overviewScaleValue,
        overviewActive: true,
      };
    }

    if (fieldSize.width <= 0 || fieldSize.height <= 0 || layoutConfig.avatarSize <= 0) {
      return {
        centerX: rawCenterX,
        centerY: rawCenterY,
        scale: 0,
        layoutScale: 0,
        avatarOpacity: 0,
        overviewScale: 1,
        overviewActive: false,
      };
    }

    const avatarRadius = layoutConfig.avatarSize / 2;
    const leftInset = rawCenterX - layoutConfig.edgePadding;
    const rightInset = fieldSize.width - layoutConfig.edgePadding - rawCenterX;
    const topInset = rawCenterY - layoutConfig.edgePadding;
    const bottomInset = fieldSize.height - layoutConfig.edgePadding - rawCenterY;
    const edgeDistance = Math.min(leftInset, rightInset, topInset, bottomInset);
    const fitScale = Math.min(Math.max((edgeDistance + avatarRadius) / (avatarRadius * 2), 0), 1);
    const edgeProgress = Math.min(
      Math.max((edgeDistance - avatarRadius) / layoutConfig.edgeScaleFalloff, 0),
      1
    );
    const edgeSmooth = edgeProgress * edgeProgress * (3 - 2 * edgeProgress);
    const edgeLensScale =
      layoutConfig.edgeBoundaryScale + (1 - layoutConfig.edgeBoundaryScale) * edgeSmooth;
    const rawViewportScale = Math.min(fitScale, edgeLensScale);
    const scale =
      rawViewportScale >= 1
        ? 1
        : rawViewportScale <= 0
          ? layoutConfig.minVisibleScale
          : Math.max(rawViewportScale, layoutConfig.minVisibleScale);
    const layoutScale = Math.min(scale, 1);
    const fadeProgress = Math.min(Math.max(rawViewportScale / layoutConfig.minVisibleScale, 0), 1);
    const avatarOpacity =
      rawViewportScale >= layoutConfig.minVisibleScale
        ? 1
        : fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
    const nudgesEdge = layoutScale > 0 && layoutScale < 1;

    if (!nudgesEdge) {
      return {
        centerX: rawCenterX,
        centerY: rawCenterY,
        scale,
        layoutScale,
        avatarOpacity,
        overviewScale: 1,
        overviewActive: false,
      };
    }

    const leftProgress = Math.min(
      Math.max((leftInset - avatarRadius) / layoutConfig.edgeScaleFalloff, 0),
      1
    );
    const rightProgress = Math.min(
      Math.max((rightInset - avatarRadius) / layoutConfig.edgeScaleFalloff, 0),
      1
    );
    const topProgress = Math.min(
      Math.max((topInset - avatarRadius) / layoutConfig.edgeScaleFalloff, 0),
      1
    );
    const bottomProgress = Math.min(
      Math.max((bottomInset - avatarRadius) / layoutConfig.edgeScaleFalloff, 0),
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
    const scaledRadius = avatarRadius * layoutScale;
    const lostRadius = avatarRadius - scaledRadius;
    const edgeTranslation =
      lostRadius * Math.min(Math.max(layoutConfig.edgeTranslationStrength, 0), 1);
    const nudgeX = Math.min(
      Math.max((leftPressure - rightPressure) * edgeTranslation, -avatarRadius),
      avatarRadius
    );
    const nudgeY = Math.min(
      Math.max((topPressure - bottomPressure) * edgeTranslation, -avatarRadius),
      avatarRadius
    );

    return {
      centerX: Math.min(
        Math.max(rawCenterX + nudgeX, layoutConfig.edgePadding + scaledRadius),
        fieldSize.width - layoutConfig.edgePadding - scaledRadius
      ),
      centerY: Math.min(
        Math.max(rawCenterY + nudgeY, layoutConfig.edgePadding + scaledRadius),
        fieldSize.height - layoutConfig.edgePadding - scaledRadius
      ),
      scale,
      layoutScale,
      avatarOpacity,
      overviewScale: 1,
      overviewActive: false,
    };
  });

  useAnimatedReaction(
    () => (viewportPresentation.get().scale >= layoutConfig.labelMinScale ? 1 : 0),
    (nextLabelOpacity, previousLabelOpacity) => {
      if (previousLabelOpacity === null) {
        labelOpacityProgress.set(nextLabelOpacity);
        return;
      }
      if (nextLabelOpacity !== previousLabelOpacity) {
        cancelAnimation(labelOpacityProgress);
        labelOpacityProgress.set(withTiming(nextLabelOpacity, PEER_LABEL_FADE_TIMING));
      }
    },
    [labelOpacityProgress, layoutConfig.labelMinScale, viewportPresentation]
  );

  const animatedStyle = useAnimatedStyle(() => {
    const presentation = viewportPresentation.get();
    const totalScale =
      (presentation.overviewActive ? presentation.overviewScale : presentation.scale) *
      visibilityScale.get();
    const scaledAvatarCenterY =
      layoutConfig.nodeHeight / 2 +
      totalScale * (sizing.avatarCenterY - layoutConfig.nodeHeight / 2);

    return {
      opacity: nodeOpacity.get() * presentation.avatarOpacity,
      zIndex: presentation.overviewActive
        ? zIndex.sticky
        : zIndex.sticky + Math.round(presentation.layoutScale * 100),
      transform: [
        { translateX: presentation.centerX - layoutConfig.nodeWidth / 2 },
        { translateY: presentation.centerY - scaledAvatarCenterY },
        { scale: totalScale },
      ],
    };
  });
  const labelAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity:
        labelOpacityProgress.get() *
        visibilityScale.get() *
        viewportPresentation.get().avatarOpacity,
    };
  });
  const nodeStyle = useMemo(
    () => [nodeStyles.peerNode, animatedStyle],
    [animatedStyle, nodeStyles]
  );
  const peerAvatarNameLabelStyle = useMemo(
    () => [nodeStyles.peerAvatarNameLabel, labelAnimatedStyle],
    [labelAnimatedStyle, nodeStyles]
  );
  const peerPressableStyle = hideSharedElementSource
    ? nodeStyles.peerPressableHidden
    : nodeStyles.peerPressable;
  const peerAvatarNameStyle = useMemo(
    () => [styles.peerAvatarName, { color: opacity(foreground, alpha.prominent) }],
    [foreground]
  );
  const bearerBadgeStyle = useMemo(
    () => [nodeStyles.bearerBadge, { backgroundColor: surface }],
    [nodeStyles, surface]
  );

  const handlePress = useCallback(() => {
    if (target.phase === 'exiting') return;
    const presentation = getPeerViewportPresentation(target, fieldSize, layoutConfig, {
      x: panX.get(),
      y: panY.get(),
    });
    if (presentation.scale <= 0 || presentation.avatarOpacity <= 0.05) return;
    onSelect(
      target.peer,
      getScaledAvatarRect(target, fieldSize, { x: panX.get(), y: panY.get() }, layoutConfig)
    );
  }, [fieldSize, layoutConfig, onSelect, panX, panY, target]);

  return (
    <Animated.View style={nodeStyle}>
      <Pressable
        onPress={handlePress}
        haptics
        accessibilityRole="button"
        accessibilityLabel={`Pay ${target.peer.name}`}
        style={peerPressableStyle}>
        <View pointerEvents="none" style={nodeStyles.peerAvatarFrame}>
          <Avatar
            state={peerAvatarState(target.peer)}
            picture={target.peer.avatarUrl ?? undefined}
            size={sizing.avatarSize}
            name={target.peer.name}
            seed={target.peer.identitySeed}
            alt={`${target.peer.name} avatar`}
            fallbackVariant="beam"
          />
          {strike ? (
            <LightningStrike
              status={strike.status}
              entrance={strike.entrance}
              seed={target.peer.peerID}
              frameSize={sizing.avatarSize}
              // The celebration owns fresh drops, so the node strike only
              // covers edge cases (gated/queued/ambient/reduced-motion) and
              // must match the ceremony's palette knob.
              palette={CELEBRATION_LIGHTNING_PALETTE}
            />
          ) : null}
          {!target.peer.lockable ? (
            <View style={bearerBadgeStyle}>
              <Icon
                name="mdi:lock-open-variant-outline"
                size={sizing.bearerBadgeIconSize}
                color={opacity(foreground, alpha.prominent)}
              />
            </View>
          ) : null}
        </View>
        <Animated.View pointerEvents="none" style={peerAvatarNameLabelStyle}>
          <Text
            size={sizing.labelFontSize}
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
  pan: { x: number; y: number },
  config: PeerLayoutConfig
): AvatarRect {
  const presentation = getPeerViewportPresentation(target, fieldSize, config, pan);
  const scaledAvatarSize = config.avatarSize * presentation.scale;

  return {
    x: presentation.centerX - scaledAvatarSize / 2,
    y: presentation.centerY - scaledAvatarSize / 2,
    size: scaledAvatarSize,
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
    sizing: PeerFieldSizing;
    layoutConfig: PeerLayoutConfig;
    panX: SharedValue<number>;
    panY: SharedValue<number>;
    overviewScale: SharedValue<number>;
    overviewTranslateX: SharedValue<number>;
    overviewTranslateY: SharedValue<number>;
    onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
    hideSharedElementSource?: boolean;
    strike?: StrikeState | null;
  },
  next: {
    target: PeerLayoutTarget;
    fieldSize: PeerLayoutSize;
    sizing: PeerFieldSizing;
    layoutConfig: PeerLayoutConfig;
    panX: SharedValue<number>;
    panY: SharedValue<number>;
    overviewScale: SharedValue<number>;
    overviewTranslateX: SharedValue<number>;
    overviewTranslateY: SharedValue<number>;
    onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
    hideSharedElementSource?: boolean;
    strike?: StrikeState | null;
  }
): boolean {
  return (
    prev.onSelect === next.onSelect &&
    prev.hideSharedElementSource === next.hideSharedElementSource &&
    prev.strike?.status === next.strike?.status &&
    prev.strike?.entrance === next.strike?.entrance &&
    prev.fieldSize.width === next.fieldSize.width &&
    prev.fieldSize.height === next.fieldSize.height &&
    prev.sizing === next.sizing &&
    prev.layoutConfig === next.layoutConfig &&
    prev.panX === next.panX &&
    prev.panY === next.panY &&
    prev.overviewScale === next.overviewScale &&
    prev.overviewTranslateX === next.overviewTranslateX &&
    prev.overviewTranslateY === next.overviewTranslateY &&
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
  const avatarSlotStyle = useMemo(
    () => [styles.amountHeaderAvatarSlot, hideAvatar ? styles.sharedElementHidden : null],
    [hideAvatar]
  );

  return (
    <VStack align="center" gap={spacing.xs} style={styles.inlineAmountHeader}>
      <View style={avatarSlotStyle}>
        <Avatar
          state={peerAvatarState(recipient)}
          picture={recipient.avatarUrl ?? undefined}
          size={HEADER_AVATAR_SIZE}
          name={recipient.name}
          seed={recipient.identitySeed}
          alt={`${recipient.name} avatar`}
          fallbackVariant="beam"
        />
      </View>
      <Text size={15} weight="bold" numberOfLines={1} style={titleStyle}>
        Pay {recipient.name}
      </Text>
    </VStack>
  );
});

const NearPayPeerField = React.memo(function NearPayPeerField({
  peers,
  sizing,
  strikeMap,
  celebrationPeerID,
  getPeerStageRef,
  onRegistryCountChange,
  emptyContent,
  onSelect,
  selectedPeerID,
}: {
  peers: BLEPeer[];
  sizing: PeerFieldSizing;
  strikeMap: ReadonlyMap<string, StrikeState>;
  /** Peer whose node (and strike) the celebration overlay is impersonating. */
  celebrationPeerID: string | null;
  /**
   * Populated by the field with a resolver from peerID to the node's current
   * screen rect + layout identity — the celebration overlay's source/return
   * anchor. Field and container share an origin (both absolute-fill chains),
   * so rects translate 1:1, exactly like the send flow's selectedPeerRect.
   */
  getPeerStageRef: React.MutableRefObject<PeerStageResolver | null>;
  /**
   * Reports the layout REGISTRY length (visible + exiting) upward — the
   * sizing hysteresis contract needs it so a peer's exit animation never
   * triggers a mid-flight resize.
   */
  onRegistryCountChange: (count: number) => void;
  emptyContent: React.ReactNode;
  onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
  selectedPeerID?: string | null;
}) {
  useRenderLogger('NearPayPeerField', 30, paymentLog);
  const [foreground] = useThemeColor(FOREGROUND_THEME_KEYS);
  // The action row (Random/Focus/Zoom) is absolutely positioned from the
  // field's bottom edge, which reaches the physical screen bottom inside the
  // edge-to-edge formSheet — without the bottom inset the row sits under
  // Android's 3-button/gesture nav (and the iOS home indicator). Peer
  // placement/zoom-fit avoidance must grow by the same amount.
  const insets = useSafeAreaInsets();
  const actionRowBottom = NEAR_PAY_ACTION_ROW_BOTTOM + insets.bottom;
  const actionRowStyle = useMemo(
    () => [styles.nearPayActionRow, { bottom: actionRowBottom }],
    [actionRowBottom]
  );
  const actionAvoidance =
    NEAR_PAY_ACTION_ROW_HEIGHT + NEAR_PAY_ACTION_ROW_BOTTOM + spacing.lg + insets.bottom;
  const peerLayoutConfig = useMemo(
    () => buildPeerLayoutConfigForSizing(sizing, actionAvoidance),
    [actionAvoidance, sizing]
  );
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
  const layoutCycleCountRef = useRef(0);
  const lastLayoutCycleLogAtRef = useRef(0);
  const dotFieldAnimatedStyle = useAnimatedStyle(() => {
    const scale = overviewScale.get();
    return {
      transform: [
        { translateX: overviewTranslateX.get() + panX.get() * scale },
        { translateY: overviewTranslateY.get() + panY.get() * scale },
        { scale },
      ],
    };
  }, [overviewScale, overviewTranslateX, overviewTranslateY, panX, panY]);
  const dotFieldLayerStyle = useMemo(
    () => [styles.dotFieldLayer, dotFieldAnimatedStyle],
    [dotFieldAnimatedStyle]
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFieldSize((current) =>
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height }
    );
  }, []);

  // Resolve real Nostr profiles for every Sovran peer (those announcing a
  // P2PK key) so the radar shows real faces/names BEFORE any tap. The x-only
  // Nostr pubkey is the announced key minus its "02" prefix. Stock peers have
  // no key → no lookup → identicon fallback.
  const peerProfilePubkeys = useMemo(
    () => peers.map((peer) => peerNostrPubkey(peer)).filter((key): key is string => !!key),
    [peers]
  );
  const peerProfiles = useRecentPeopleProfiles(peerProfilePubkeys);
  const peerProfileByPubkey = useMemo(() => {
    const map = new Map<string, RecentPeopleProfileRow>();
    for (const row of peerProfiles) map.set(row.pubkey, row);
    return map;
  }, [peerProfiles]);

  const peerStats = useMemo(() => {
    let connectedCount = 0;
    let directCount = 0;
    let reachableCount = 0;
    for (const peer of peers) {
      if (peer.isConnected) connectedCount += 1;
      if (peer.hasDirectLink) directCount += 1;
      if (peer.isConnected || peer.hasDirectLink) reachableCount += 1;
    }
    return {
      peerCount: peers.length,
      connectedCount,
      directCount,
      reachableCount,
    };
  }, [peers]);

  const layoutPeersResult = useMemo(() => {
    const startedAt = nowMs();
    // The v3 beacon announces each Sovran peer's P2PK key, so radar nodes
    // resolve the real Nostr profile (face/name) pre-tap. Stock peers have no
    // key → BLE nickname / peer-ID word-pair fallback.
    return {
      value: peers.map((peer) => {
        const nostrPubkey = peerNostrPubkey(peer);
        const normalized = nostrPubkey ? normalizeRecentPersonPubkey(nostrPubkey) : null;
        const profile = normalized ? peerProfileByPubkey.get(normalized) : undefined;
        return toLayoutPeer(peer, profile);
      }),
      peerCount: peerStats.peerCount,
      connectedCount: peerStats.connectedCount,
      directCount: peerStats.directCount,
      reachableCount: peerStats.reachableCount,
      duration_ms: durationSinceMs(startedAt),
    };
  }, [
    peerStats.connectedCount,
    peerStats.directCount,
    peerStats.peerCount,
    peerStats.reachableCount,
    peers,
    peerProfileByPubkey,
  ]);
  const layoutPeers = layoutPeersResult.value;
  const layoutPeersResultRef = useRef(layoutPeersResult);

  useEffect(() => {
    layoutPeersResultRef.current = layoutPeersResult;
  }, [layoutPeersResult]);

  useEffect(() => {
    setRegistry((current) => reconcilePeerLayoutRegistry(current, layoutPeers, Date.now()));
  }, [layoutPeers]);

  useEffect(() => {
    onRegistryCountChange(registry.length);
  }, [onRegistryCountChange, registry.length]);

  const hasExitingPeer = registry.some((entry) => entry.phase === 'exiting');
  useEffect(() => {
    if (!hasExitingPeer) return;
    const timeout = setTimeout(() => {
      setRegistry((current) => pruneExitedPeerLayoutRegistry(current, Date.now()));
    }, NEAR_PAY_EXIT_ANIMATION_MS + 40);
    return () => clearTimeout(timeout);
  }, [hasExitingPeer, registry]);

  useEffect(() => {
    if (fieldSize.width <= 0 || fieldSize.height <= 0) return;
    paymentLog.debug('near_pay.perf.field_layout', {
      width: roundMetric(fieldSize.width),
      height: roundMetric(fieldSize.height),
    });
  }, [fieldSize.height, fieldSize.width]);

  const targetsResult = useMemo(() => {
    const startedAt = nowMs();
    const value = buildPeerLayoutTargets(registry, fieldSize, peerLayoutConfig);
    let exitingCount = 0;
    for (const target of value) {
      if (target.phase === 'exiting') exitingCount += 1;
    }
    return {
      value,
      targetCount: value.length,
      registryCount: registry.length,
      exitingCount,
      fieldWidth: roundMetric(fieldSize.width),
      fieldHeight: roundMetric(fieldSize.height),
      duration_ms: durationSinceMs(startedAt),
    };
  }, [fieldSize, peerLayoutConfig, registry]);
  const targets = targetsResult.value;

  const panBoundsResult = useMemo(() => {
    const startedAt = nowMs();
    const value = getPeerLayoutPanBounds(targets, fieldSize, peerLayoutConfig);
    return {
      value,
      targetCount: targets.length,
      minX: roundMetric(value.minX),
      maxX: roundMetric(value.maxX),
      minY: roundMetric(value.minY),
      maxY: roundMetric(value.maxY),
      duration_ms: durationSinceMs(startedAt),
    };
  }, [fieldSize, peerLayoutConfig, targets]);
  const panBounds = panBoundsResult.value;

  // Expose the celebration's source/return anchor resolver. Reading the pan
  // shared values on the JS thread here matches the press/random handlers.
  useEffect(() => {
    getPeerStageRef.current = (peerID: string) => {
      const target = targets.find(
        (candidate) => candidate.peer.peerID === peerID && candidate.phase !== 'exiting'
      );
      if (!target) return null;
      return {
        rect: getScaledAvatarRect(
          target,
          fieldSize,
          { x: panX.get(), y: panY.get() },
          peerLayoutConfig
        ),
        peer: target.peer,
      };
    };
    return () => {
      getPeerStageRef.current = null;
    };
  }, [fieldSize, getPeerStageRef, panX, panY, peerLayoutConfig, targets]);

  useEffect(() => {
    if (fieldSize.width <= 0 || fieldSize.height <= 0) return;
    const currentLayoutPeersResult = layoutPeersResultRef.current;
    const cycleIndex = layoutCycleCountRef.current + 1;
    layoutCycleCountRef.current = cycleIndex;
    const loggedAt = nowMs();
    const isInitial = cycleIndex <= NEAR_PAY_LAYOUT_CYCLE_INITIAL_LOG_COUNT;
    const isSlow =
      currentLayoutPeersResult.duration_ms >= NEAR_PAY_LAYOUT_CYCLE_SLOW_LAYOUT_MS ||
      targetsResult.duration_ms >= NEAR_PAY_LAYOUT_CYCLE_SLOW_TARGETS_MS ||
      panBoundsResult.duration_ms >= NEAR_PAY_LAYOUT_CYCLE_SLOW_PAN_BOUNDS_MS;
    const isPeriodic =
      loggedAt - lastLayoutCycleLogAtRef.current >= NEAR_PAY_LAYOUT_CYCLE_PERIODIC_MS;
    if (!isInitial && !isSlow && !isPeriodic) return;

    lastLayoutCycleLogAtRef.current = loggedAt;
    paymentLog.debug('near_pay.perf.layout_cycle', {
      sample: isSlow ? 'slow' : isInitial ? 'initial' : 'periodic',
      cycleIndex,
      peerCount: currentLayoutPeersResult.peerCount,
      connectedCount: currentLayoutPeersResult.connectedCount,
      directCount: currentLayoutPeersResult.directCount,
      reachableCount: currentLayoutPeersResult.reachableCount,
      registryCount: targetsResult.registryCount,
      targetCount: targetsResult.targetCount,
      exitingCount: targetsResult.exitingCount,
      fieldWidth: targetsResult.fieldWidth,
      fieldHeight: targetsResult.fieldHeight,
      layoutPeersDuration_ms: currentLayoutPeersResult.duration_ms,
      targetsDuration_ms: targetsResult.duration_ms,
      panBoundsDuration_ms: panBoundsResult.duration_ms,
    });
  }, [fieldSize.height, fieldSize.width, panBoundsResult, targetsResult]);

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

  const targetCount = targets.length;

  const handleFocus = useCallback(() => {
    paymentLog.debug('near_pay.perf.focus_start', {
      targetCount,
      panX: roundMetric(panX.get()),
      panY: roundMetric(panY.get()),
      minX: roundMetric(panBounds.minX),
      maxX: roundMetric(panBounds.maxX),
      minY: roundMetric(panBounds.minY),
      maxY: roundMetric(panBounds.maxY),
    });
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
  }, [
    isPanSettling,
    isPanning,
    panBounds.maxX,
    panBounds.maxY,
    panBounds.minX,
    panBounds.minY,
    panSettleRemaining,
    panX,
    panY,
    targetCount,
  ]);

  const hasSelectablePeer = targets.some((target) => target.phase !== 'exiting');

  const handleOverviewPressIn = useCallback(() => {
    const startedAt = nowMs();
    const pan = { x: panX.get(), y: panY.get() };
    const overview = getPeerLayoutOverviewTransform(
      targets,
      fieldSize,
      peerLayoutConfig,
      pan,
      {
        top: PEER_OVERVIEW_TOP_INSET,
        right: PEER_OVERVIEW_SIDE_INSET,
        bottom: actionAvoidance,
        left: PEER_OVERVIEW_SIDE_INSET,
      },
      PEER_OVERVIEW_MAX_SCALE,
      PEER_OVERVIEW_SCALE_FACTOR
    );
    paymentLog.debug('near_pay.perf.overview_transform', {
      targetCount,
      panX: roundMetric(pan.x),
      panY: roundMetric(pan.y),
      scale: roundMetric(overview.scale),
      translateX: roundMetric(overview.translateX),
      translateY: roundMetric(overview.translateY),
      duration_ms: durationSinceMs(startedAt),
    });

    cancelAnimation(overviewScale);
    cancelAnimation(overviewTranslateX);
    cancelAnimation(overviewTranslateY);
    overviewScale.set(withTiming(overview.scale, PEER_OVERVIEW_TIMING));
    overviewTranslateX.set(withTiming(overview.translateX, PEER_OVERVIEW_TIMING));
    overviewTranslateY.set(withTiming(overview.translateY, PEER_OVERVIEW_TIMING));
  }, [
    actionAvoidance,
    fieldSize,
    overviewScale,
    overviewTranslateX,
    overviewTranslateY,
    panX,
    panY,
    peerLayoutConfig,
    targetCount,
    targets,
  ]);

  const handleOverviewPressOut = useCallback(() => {
    cancelAnimation(overviewScale);
    cancelAnimation(overviewTranslateX);
    cancelAnimation(overviewTranslateY);
    overviewScale.set(withTiming(1, PEER_OVERVIEW_TIMING));
    overviewTranslateX.set(withTiming(0, PEER_OVERVIEW_TIMING));
    overviewTranslateY.set(withTiming(0, PEER_OVERVIEW_TIMING));
  }, [overviewScale, overviewTranslateX, overviewTranslateY]);

  const handleRandomPeer = useCallback(() => {
    const startedAt = nowMs();
    const pan = { x: panX.get(), y: panY.get() };
    const selectableTargets = targets.filter((target) => {
      if (target.phase === 'exiting') return false;
      const presentation = getPeerViewportPresentation(target, fieldSize, peerLayoutConfig, pan);
      return presentation.scale > 0 && presentation.avatarOpacity > 0.05;
    });
    if (selectableTargets.length === 0) {
      paymentLog.debug('near_pay.perf.random_peer_pick', {
        targetCount,
        selectableCount: 0,
        selected: false,
        duration_ms: durationSinceMs(startedAt),
      });
      return;
    }

    const randomIndex = Math.floor(Math.random() * selectableTargets.length);
    const target = selectableTargets[randomIndex];
    if (!target) {
      paymentLog.debug('near_pay.perf.random_peer_pick', {
        targetCount,
        selectableCount: selectableTargets.length,
        selected: false,
        duration_ms: durationSinceMs(startedAt),
      });
      return;
    }

    paymentLog.debug('near_pay.perf.random_peer_pick', {
      targetCount,
      selectableCount: selectableTargets.length,
      selected: true,
      peerID: target.peer.peerID,
      duration_ms: durationSinceMs(startedAt),
    });

    onSelect(target.peer, getScaledAvatarRect(target, fieldSize, pan, peerLayoutConfig));
  }, [fieldSize, onSelect, panX, panY, peerLayoutConfig, targetCount, targets]);

  const logPanEnd = useCallback((payload: Record<string, number>) => {
    paymentLog.debug('near_pay.perf.pan_end', payload);
  }, []);

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
          scheduleOnRN(logPanEnd, {
            targetCount,
            translationX: event.translationX,
            translationY: event.translationY,
            velocityX: event.velocityX,
            velocityY: event.velocityY,
            finalX,
            finalY,
            minX,
            maxX,
            minY,
            maxY,
          });
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
      logPanEnd,
      maxPanX,
      maxPanY,
      minPanX,
      minPanY,
      panSettleRemaining,
      panStartX,
      panStartY,
      panX,
      panY,
      targetCount,
    ]
  );

  return (
    <View onLayout={handleLayout} style={styles.field}>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={styles.fieldCanvas}>
          <Animated.View pointerEvents="none" style={dotFieldLayerStyle}>
            <DotField size={fieldSize} foreground={foreground} />
          </Animated.View>
          {registry.length === 0 ? emptyContent : null}
          {targets.map((target) => (
            <PeerNode
              key={target.peer.peerID}
              target={target}
              fieldSize={fieldSize}
              sizing={sizing}
              layoutConfig={peerLayoutConfig}
              panX={panX}
              panY={panY}
              overviewScale={overviewScale}
              overviewTranslateX={overviewTranslateX}
              overviewTranslateY={overviewTranslateY}
              onSelect={onSelect}
              hideSharedElementSource={
                selectedPeerID === target.peer.peerID || celebrationPeerID === target.peer.peerID
              }
              strike={
                // The overlay impersonates this node (gold, center stage) —
                // suppress the node-level strike so lightning never doubles.
                celebrationPeerID === target.peer.peerID
                  ? null
                  : (strikeMap.get(target.peer.peerID) ?? null)
              }
            />
          ))}
        </Animated.View>
      </GestureDetector>
      <HStack justify="space-around" style={actionRowStyle}>
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
          disabled={targetCount === 0}
          onPressIn={handleOverviewPressIn}
          onPressOut={handleOverviewPressOut}
        />
      </HStack>
    </View>
  );
});

export function NearPayScreen() {
  useLifecycleLogger('NearPayScreen');
  useRenderLogger('NearPayScreen', 30, paymentLog);
  const insets = useSafeAreaInsets();
  const walletContext = useWalletContext();
  const { isOffline } = useOfflineStatus();
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });
  // Every bitchat peer is on the radar so the favorite exchange can run, but a
  // token DM is only enabled after the peer advertises a valid creq capability.
  // Ghost entries (a nearby device's previous profile identities, which
  // upstream's registry can retain forever) are dropped by the freshness
  // filter; the periodic tick re-evaluates it as lastSeen values age out.
  const { peers: blePeers } = useBLEPeers();
  const [peerFreshnessNow, setPeerFreshnessNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setPeerFreshnessNow(Date.now()), BLE_PEER_FRESHNESS_TICK_MS);
    return () => clearInterval(interval);
  }, []);
  const peers = useMemo(
    () => filterFreshBLEPeers(blePeers, peerFreshnessNow),
    [blePeers, peerFreshnessNow]
  );
  // Eagerly favorite each nearby peer so Sovran peers reciprocate and become
  // lockable-on-sight — bitchat's only native mesh channel for exchanging a
  // Nostr identity. Bounded to while the radar is mounted.
  useEagerPeerFavorite(peers);
  const [foreground] = useThemeColor(FOREGROUND_THEME_KEYS);
  const nearPaySession = useNearPaySessionStore((state) => state.active);
  const inlineAmountEntry = nearPaySession?.amountEntry ?? null;
  const inlinePhase = nearPaySession?.phase ?? 'picking';
  const hasInlineAmountEntry = !!inlineAmountEntry;
  const [containerSize, setContainerSize] = useState<PeerLayoutSize>({ width: 0, height: 0 });
  const [selectedPeer, setSelectedPeer] = useState<NearPayLayoutPeer | null>(null);
  const [selectedPeerRect, setSelectedPeerRect] = useState<AvatarRect | null>(null);
  const [sharedAvatarPeer, setSharedAvatarPeer] = useState<NearPayLayoutPeer | null>(null);
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
  const sharedAvatarTransitionTokenRef = useRef(0);
  const sharedAvatarTransitionSpanRef = useRef<NearPayPerfSpan | null>(null);
  const sharedAvatarStartFrameRef = useRef<number | null>(null);
  const sharedAvatarStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reachableCount = useMemo(
    () => peers.filter((peer) => peer.hasDirectLink || peer.isConnected).length,
    [peers]
  );
  const pickerPeersRef = useRef(peers);

  useEffect(() => {
    if (!inlineAmountEntry) pickerPeersRef.current = peers;
  }, [inlineAmountEntry, peers]);

  const pickerPeers = inlineAmountEntry ? pickerPeersRef.current : peers;
  const headerBadgeCount = hasInlineAmountEntry ? 0 : reachableCount;

  // Lightning effect per sender while a received Nut Drop redeems —
  // re-renders gate component mount/unmount only; the animation itself runs
  // on the UI thread inside LightningStrike. Lifted to the screen so the
  // celebration hook observes the same map the radar renders from.
  const strikeMap = useNutDropStrike();
  const { celebration, skip: skipCelebration } = useNutDropCelebration({
    strikeMap,
    // Any send-flow stage (transitioning/amount or a shared-avatar flight)
    // defers ceremonies — never hijack the amount panel.
    gated: inlinePhase !== 'picking' || !!sharedAvatarPeer,
  });

  // Adaptive radar sizing: hero avatars while few peers are around, the
  // compact step in a crowd, with hysteresis (see peerFieldSizing.ts). Owned
  // here (not in the field) because the shared-avatar flight element must
  // render at the radar's current avatar size. Fed by the field's layout
  // REGISTRY length (visible + exiting) so exit animations never resize the
  // grid mid-flight, and frozen whenever any overlay flight is active (send
  // shared-avatar, amount entry, or a celebration) so captured rects stay
  // valid.
  const [radarRegistryCount, setRadarRegistryCount] = useState(0);
  const [fieldSizingStep, setFieldSizingStep] = useState<PeerFieldSizingStep>('hero');
  const sizingFrozen =
    hasInlineAmountEntry || sharedAvatarPeer !== null || celebration.phase !== 'idle';
  useEffect(() => {
    if (sizingFrozen) return;
    setFieldSizingStep((prev) => getPeerFieldSizingStep(radarRegistryCount, prev));
  }, [radarRegistryCount, sizingFrozen]);
  const fieldSizing = getPeerFieldSizing(fieldSizingStep);
  const getPeerStageRef = useRef<PeerStageResolver | null>(null);
  const [celebrationStage, setCelebrationStage] = useState<{
    ceremonyId: number;
    peerID: string;
    sourceRect: AvatarRect | null;
    peer: CelebrationPeerIdentity;
  } | null>(null);

  // Stage the flying identity once per ceremony (keyed by ceremonyId — a
  // repeat ceremony from the same sender re-captures the rect): identity is
  // snapshotted at fire time so a sender vanishing mid-ceremony cannot blank
  // the overlay.
  useEffect(() => {
    const current = celebration.phase !== 'idle' ? celebration.current : null;
    if (!current) {
      setCelebrationStage(null);
      return;
    }
    setCelebrationStage((previous) => {
      if (previous?.ceremonyId === celebration.ceremonyId) return previous;
      const staged = getPeerStageRef.current?.(current.peerID) ?? null;
      return {
        ceremonyId: celebration.ceremonyId,
        peerID: current.peerID,
        sourceRect: staged?.rect ?? null,
        peer: staged
          ? {
              peerID: current.peerID,
              name: staged.peer.name,
              avatarUrl: staged.peer.avatarUrl ?? null,
              profileLoading: staged.peer.profileLoading,
            }
          : { peerID: current.peerID, name: '', avatarUrl: null, profileLoading: false },
      };
    });
  }, [celebration]);

  // Node suppression and overlay mount MUST flip in the same commit at both
  // ends (atomic swap) — gating either on reducer state alone or stage state
  // alone paints one frame with the avatar missing from both layers.
  const celebrationActive = !!(
    celebrationStage &&
    celebration.phase !== 'idle' &&
    celebration.current
  );

  const handleRegistryCountChange = useCallback((count: number) => {
    setRadarRegistryCount(count);
  }, []);

  useEffect(() => {
    paymentLog.debug('near_pay.perf.session_state', {
      phase: inlinePhase,
      hasAmountEntry: hasInlineAmountEntry,
      selectedPeerID: selectedPeer?.peerID ?? null,
      sharedAvatarPeerID: sharedAvatarPeer?.peerID ?? null,
    });
  }, [hasInlineAmountEntry, inlinePhase, selectedPeer?.peerID, sharedAvatarPeer?.peerID]);

  useEffect(() => {
    useNearPaySessionStore.getState().clear();
    // While the radar is up, the receive toast is titled "Received payment"
    // (PaymentStatusToast keys on this flag).
    useNearPaySessionStore.getState().setRadarVisible(true);
    return () => {
      useNearPaySessionStore.getState().clear();
      useNearPaySessionStore.getState().setRadarVisible(false);
    };
  }, []);

  // The recipient's identity is seeded up front from the peer's announced
  // P2PK key (recipientPubkey passed to startSendEcash); the stage-2 resolver
  // then fills ctx.recipientProfile from kind-0. Subscribing to the live ctx
  // lets the radar header upgrade to the resolved name/face the moment it
  // lands.
  const liveFlowCtx = useSyncExternalStore(
    machine.subscribe,
    machine.getContext,
    machine.getContext
  );
  const recipientProfile = liveFlowCtx.recipientProfile;

  const activeRecipientPeer = useMemo<NearPayLayoutPeer | null>(() => {
    const recipient = nearPaySession?.recipient;
    if (!recipient) return null;
    const base: NearPayLayoutPeer =
      selectedPeer?.peerID === recipient.peerID
        ? selectedPeer
        : {
            peerID: recipient.peerID,
            nickname: recipient.nickname,
            name: recipient.nickname,
            isConnected: true,
            hasDirectLink: recipient.hasDirectLink,
            lastSeen: recipient.lastSeen,
            avatarUrl: null,
            lockable: !!recipient.creq,
            creq: recipient.creq,
            identitySeed: recipient.peerID,
            profileLoading: false,
          };
    if (!recipientProfile) return base;
    return {
      ...base,
      name: recipientProfile.displayName || base.name,
      avatarUrl: recipientProfile.avatarUrl ?? base.avatarUrl,
    };
  }, [nearPaySession?.recipient, recipientProfile, selectedPeer]);

  const headerAvatarRect = useMemo<AvatarRect | null>(() => {
    return getCenteredAvatarRectInSlot({
      containerWidth: containerSize.width,
      slotTop: INLINE_AMOUNT_HEADER_TOP,
      slotSize: AMOUNT_HEADER_AVATAR_SLOT_SIZE,
      avatarSize: HEADER_AVATAR_SIZE,
    });
  }, [containerSize.width]);

  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainerSize((current) =>
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height }
    );
  }, []);

  const endSharedAvatarTransitionSpan = useCallback((params: Record<string, unknown>) => {
    sharedAvatarTransitionSpanRef.current?.end(params);
    sharedAvatarTransitionSpanRef.current = null;
  }, []);

  const playAmountContentEnter = useCallback(
    (delayMs = 0) => {
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

  const finishSharedAvatarTransition = useCallback(
    (transitionToken: number) => {
      if (sharedAvatarTransitionTokenRef.current !== transitionToken) return;
      sharedAvatarTransitionTokenRef.current = transitionToken + 1;
      endSharedAvatarTransitionSpan({
        completed: true,
        transitionToken,
      });
      useNearPaySessionStore.getState().showAmount();
      sharedAvatarOpacity.set(0);
      setSharedAvatarPeer(null);
    },
    [endSharedAvatarTransitionSpan, sharedAvatarOpacity]
  );

  const stopSharedElementAnimations = useCallback(() => {
    if (sharedAvatarStartTimerRef.current !== null) {
      clearTimeout(sharedAvatarStartTimerRef.current);
      sharedAvatarStartTimerRef.current = null;
    }
    if (sharedAvatarStartFrameRef.current !== null) {
      cancelAnimationFrame(sharedAvatarStartFrameRef.current);
      sharedAvatarStartFrameRef.current = null;
    }
    const interruptedToken = sharedAvatarTransitionTokenRef.current;
    sharedAvatarTransitionTokenRef.current = interruptedToken + 1;
    endSharedAvatarTransitionSpan({
      canceled: true,
      reason: 'interrupted',
      transitionToken: interruptedToken,
    });
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
    endSharedAvatarTransitionSpan,
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
      // Decide lock vs offline bearer from the peer's creq (accepted mints +
      // lock key), our trusted mints, and online status. Delivery is always a
      // private DM, but only after a valid creq proved the peer is patched.
      const plan = planNearPaySend({
        peer,
        ourMints: walletContext.trustedMintUrls,
        isOffline,
      });
      paymentLog.info('near_pay.peer.tap', {
        peerID: peer.peerID,
        mode: plan.mode,
        // Did we decode the receiver's creq, and which mints did we get?
        ...creqParseDiagnostics(peer),
        ourMints: walletContext.trustedMintUrls,
        allowedMints: plan.mode === 'block' ? null : plan.allowedMints,
        isOffline,
        hasDirectLink: peer.hasDirectLink,
        isConnected: peer.isConnected,
      });
      // No valid creq ⇒ not confirmed patched; no mint in common ⇒ the
      // recipient couldn't redeem. Block BEFORE any session/transition state
      // (leaves the radar exactly as it was; also covers the Random button).
      if (plan.mode === 'block') {
        paymentLog.info(
          plan.reason === 'no-shared-mint'
            ? 'near_pay.peer.no_shared_mint'
            : 'near_pay.peer.not_ready',
          { peerID: peer.peerID, reason: plan.reason }
        );
        if (plan.reason === 'no-shared-mint') {
          await notifyNoSharedMint(peer.name);
        } else {
          await notifyNutDropPeerNotReady(peer.name);
        }
        return;
      }
      const delivery: NearPayDelivery = { locked: plan.mode === 'lock' };
      paymentLog.info('near_pay.peer.select', {
        peerID: peer.peerID,
        hasDirectLink: peer.hasDirectLink,
        isConnected: peer.isConnected,
        locked: delivery.locked,
      });
      setSelectedPeer(peer);
      setSelectedPeerRect(avatarRect);
      stopSharedElementAnimations();
      amountContentOpacity.set(0);
      amountContentTranslateY.set(AMOUNT_CONTENT_ENTER_OFFSET);
      setSharedAvatarPeer(peer);
      amountPanelTranslateX.set(0);
      amountPanelTranslateY.set(0);
      const sharedAvatarStart = getSharedAvatarTransform(avatarRect, fieldSizing.avatarSize);
      sharedAvatarX.set(sharedAvatarStart.x);
      sharedAvatarY.set(sharedAvatarStart.y);
      sharedAvatarScale.set(sharedAvatarStart.scale);
      sharedAvatarOpacity.set(1);
      useNearPaySessionStore.getState().start({
        peerID: peer.peerID,
        nickname: peer.name,
        hasDirectLink: peer.hasDirectLink,
        lastSeen: peer.lastSeen,
        creq: peer.creq,
        delivery,
      });
      // Failure paths must only unwind THIS selection — the radar stays
      // tappable while a send is in flight, so the session-id guard ensures a
      // slow attempt's failure can't clear a newer session started meanwhile.
      const sessionId = useNearPaySessionStore.getState().active?.id ?? null;
      const startSendSpan = paymentLog
        .child({ flowId: `near-pay-start-send-${Date.now()}` })
        .startSpan(
          'near_pay.perf.start_send_ecash',
          {
            peerID: peer.peerID,
            hasAvatar: !!peer.avatarUrl,
            hasDirectLink: peer.hasDirectLink,
            isConnected: peer.isConnected,
          },
          {
            warnAtMs: 250,
            errorAtMs: 1000,
          }
        );
      try {
        // One path for every peer: enter the amount flow, then the
        // sendComplete handler delivers the finished token as a private Noise
        // DM to the recipient peer (no public mesh). A locked token is
        // P2PK-locked to the peer's key + minted from a mint they accept;
        // offline fallback is bearer from a shared mint. `allowedMints`
        // constrains the source mint. recipientPubkey seeds their real profile.
        paymentLog.info('near_pay.start_send', {
          peerID: peer.peerID,
          locked: delivery.locked,
        });
        await machine.startSendEcash({
          reset: true,
          ...(plan.mode === 'lock'
            ? { p2pkLockPubkey: plan.lockPubkey, recipientPubkey: plan.recipientPubkey }
            : {}),
          ...(plan.allowedMints ? { allowedMints: plan.allowedMints } : {}),
          recipientProfile: {
            displayName: peer.name,
            avatarUrl: peer.avatarUrl ?? null,
            nip05: null,
          },
        });
        startSendSpan.end({
          completed: true,
        });
      } catch (err) {
        startSendSpan.end({
          completed: false,
          error: err instanceof Error ? err.message : String(err),
        });
        setSelectedPeer(null);
        setSelectedPeerRect(null);
        setSharedAvatarPeer(null);
        amountPanelTranslateX.set(0);
        amountPanelTranslateY.set(0);
        amountContentOpacity.set(0);
        amountContentTranslateY.set(AMOUNT_CONTENT_ENTER_OFFSET);
        if (useNearPaySessionStore.getState().active?.id === sessionId) {
          useNearPaySessionStore.getState().clear();
        }
        paymentLog.error('near_pay.peer.start_send_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [
      machine,
      walletContext.trustedMintUrls,
      isOffline,
      amountContentOpacity,
      amountContentTranslateY,
      amountPanelTranslateX,
      amountPanelTranslateY,
      fieldSizing.avatarSize,
      sharedAvatarOpacity,
      sharedAvatarScale,
      sharedAvatarX,
      sharedAvatarY,
      stopSharedElementAnimations,
    ]
  );

  useEffect(() => {
    if (!inlineAmountEntry) {
      stopSharedElementAnimations();
      setSharedAvatarPeer(null);
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
    const transitionToken = sharedAvatarTransitionTokenRef.current + 1;
    sharedAvatarTransitionTokenRef.current = transitionToken;
    setSharedAvatarPeer(activeRecipientPeer);
    const sharedAvatarStart = getSharedAvatarTransform(selectedPeerRect, fieldSizing.avatarSize);
    const sharedAvatarEnd = getSharedAvatarTransform(headerAvatarRect, fieldSizing.avatarSize);
    const amountPanelStartShift = getAmountPanelStartShift(selectedPeerRect, headerAvatarRect);
    sharedAvatarTransitionSpanRef.current = paymentLog
      .child({ flowId: `near-pay-shared-avatar-${transitionToken}` })
      .startSpan(
        'near_pay.perf.shared_avatar_transition',
        {
          transitionToken,
          peerID: activeRecipientPeer.peerID,
          sourceX: roundMetric(selectedPeerRect.x),
          sourceY: roundMetric(selectedPeerRect.y),
          sourceSize: roundMetric(selectedPeerRect.size),
          targetX: roundMetric(headerAvatarRect.x),
          targetY: roundMetric(headerAvatarRect.y),
          targetSize: roundMetric(headerAvatarRect.size),
          shiftX: roundMetric(amountPanelStartShift.x),
          shiftY: roundMetric(amountPanelStartShift.y),
          animation_ms: SHARED_AVATAR_ANIMATION_MS,
        },
        {
          warnAtMs: 750,
          errorAtMs: 1500,
        }
      );
    sharedAvatarX.set(sharedAvatarStart.x);
    sharedAvatarY.set(sharedAvatarStart.y);
    sharedAvatarScale.set(sharedAvatarStart.scale);
    sharedAvatarOpacity.set(1);
    amountPanelTranslateX.set(amountPanelStartShift.x);
    amountPanelTranslateY.set(amountPanelStartShift.y);
    amountContentOpacity.set(0);
    amountContentTranslateY.set(AMOUNT_CONTENT_ENTER_OFFSET);

    const easing = Easing.out(Easing.cubic);
    const sharedTiming = { duration: SHARED_AVATAR_ANIMATION_MS, easing };
    const panelTiming = { duration: Math.round(SHARED_AVATAR_ANIMATION_MS * 0.75), easing };
    sharedAvatarStartTimerRef.current = setTimeout(() => {
      sharedAvatarStartTimerRef.current = null;
      if (sharedAvatarTransitionTokenRef.current !== transitionToken) return;
      sharedAvatarStartFrameRef.current = requestAnimationFrame(() => {
        sharedAvatarStartFrameRef.current = null;
        if (sharedAvatarTransitionTokenRef.current !== transitionToken) return;
        pickerOpacity.set(withTiming(0, panelTiming));
        amountOpacity.set(withTiming(1, panelTiming));
        amountPanelTranslateX.set(withTiming(0, sharedTiming));
        amountPanelTranslateY.set(withTiming(0, sharedTiming));
        playAmountContentEnter();
        sharedAvatarX.set(withTiming(sharedAvatarEnd.x, sharedTiming));
        sharedAvatarY.set(withTiming(sharedAvatarEnd.y, sharedTiming));
        sharedAvatarScale.set(withTiming(sharedAvatarEnd.scale, sharedTiming));
        sharedAvatarOpacity.set(
          withDelay(
            SHARED_AVATAR_ANIMATION_MS + 40,
            withTiming(0, { duration: 0, easing }, (finished) => {
              if (finished) scheduleOnRN(finishSharedAvatarTransition, transitionToken);
            })
          )
        );
      });
    }, AMOUNT_CONTENT_PREWARM_MS);
    return () => {
      if (sharedAvatarStartTimerRef.current !== null) {
        clearTimeout(sharedAvatarStartTimerRef.current);
        sharedAvatarStartTimerRef.current = null;
      }
      if (sharedAvatarStartFrameRef.current !== null) {
        cancelAnimationFrame(sharedAvatarStartFrameRef.current);
        sharedAvatarStartFrameRef.current = null;
      }
      if (sharedAvatarTransitionTokenRef.current === transitionToken) {
        stopSharedElementAnimations();
      }
    };
  }, [
    activeRecipientPeer,
    amountContentOpacity,
    amountContentTranslateY,
    amountOpacity,
    amountPanelTranslateX,
    amountPanelTranslateY,
    fieldSizing.avatarSize,
    headerAvatarRect,
    inlineAmountEntry,
    inlinePhase,
    finishSharedAvatarTransition,
    pickerOpacity,
    playAmountContentEnter,
    selectedPeerRect,
    sharedAvatarOpacity,
    sharedAvatarScale,
    sharedAvatarX,
    sharedAvatarY,
    stopSharedElementAnimations,
  ]);

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
  const sharedAvatarBaseStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      left: 0,
      top: 0,
      width: fieldSizing.avatarSize,
      height: fieldSizing.avatarSize,
      zIndex: zIndex.overlay,
    }),
    [fieldSizing.avatarSize]
  );
  const sharedAvatarFrameStyle = useMemo(
    () => ({
      position: 'relative' as const,
      width: fieldSizing.avatarSize,
      height: fieldSizing.avatarSize,
    }),
    [fieldSizing.avatarSize]
  );
  const sharedAvatarCombinedStyle = useMemo(
    () => [sharedAvatarBaseStyle, sharedAvatarStyle],
    [sharedAvatarBaseStyle, sharedAvatarStyle]
  );

  const bluetooth = useBluetoothState();
  // 'unknown' stays on the scanning path — iOS reports a real state only after
  // startBLE has spun up CoreBluetooth, and useBLEPeers starts it on mount.
  const bluetoothBlocked = bluetooth.status !== 'ready' && bluetooth.status !== 'unknown';
  const amountActive = hasInlineAmountEntry;
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
  const renderHeaderLeft = useCallback(
    () => <ScreenHeaderAction icon="material-symbols:arrow-back-rounded" onPress={resetToPicker} />,
    [resetToPicker]
  );
  const renderEmptyHeader = useCallback(() => null, []);
  const openPeerList = useCallback(() => {
    router.push('/(send-flow)/nearPayPeers');
  }, []);
  const renderHeaderRight = useCallback(
    () => <HeaderBadge count={headerBadgeCount} onPress={openPeerList} />,
    [headerBadgeCount, openPeerList]
  );
  const stackOptions = useMemo(
    () => ({
      title: amountActive ? '' : 'Nut Drop',
      headerShadowVisible: false,
      headerTransparent: true,
      headerTitle: amountActive ? renderEmptyHeader : undefined,
      headerBackVisible: false,
      headerLeft: amountActive ? renderHeaderLeft : renderEmptyHeader,
      headerRight: amountActive ? renderEmptyHeader : renderHeaderRight,
      // The send flow's shared-element avatar lands inside the header band,
      // and Android's sheet header (FlowSheetHeader) composites its scrim
      // gradient ABOVE screen content — the avatar ended up underneath it.
      // A null headerBackground is the sanctioned per-screen scrim opt-out;
      // the radar's faint dot field doesn't need the legibility fade.
      ...(Platform.OS === 'android' ? { headerBackground: renderNullHeaderBackground } : {}),
    }),
    [amountActive, renderEmptyHeader, renderHeaderLeft, renderHeaderRight]
  );

  return (
    <>
      <Stack.Screen options={stackOptions} />
      <Screen name="NearPayScreen" scroll="none" contentPadding={0} bottomPadding={0}>
        <View onLayout={handleContainerLayout} style={styles.container}>
          {bluetoothBlocked ? (
            <VStack align="center" justify="center" style={styles.emptyState}>
              <BluetoothNotice bluetooth={bluetooth} />
            </VStack>
          ) : (
            <>
              <Animated.View
                pointerEvents={amountActive ? 'none' : 'auto'}
                style={pickerPanelCombinedStyle}>
                <NearPayPeerField
                  peers={pickerPeers}
                  sizing={fieldSizing}
                  strikeMap={strikeMap}
                  celebrationPeerID={celebrationActive ? (celebrationStage?.peerID ?? null) : null}
                  getPeerStageRef={getPeerStageRef}
                  onRegistryCountChange={handleRegistryCountChange}
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
                    <AmountFlowContent amountEntry={inlineAmountEntry} headerMode="none" />
                  </Animated.View>
                </Animated.View>
              ) : null}
              {sharedAvatarPeer ? (
                <Animated.View pointerEvents="none" style={sharedAvatarCombinedStyle}>
                  <View pointerEvents="none" style={sharedAvatarFrameStyle}>
                    <Avatar
                      state={peerAvatarState(sharedAvatarPeer)}
                      picture={sharedAvatarPeer.avatarUrl ?? undefined}
                      size={fieldSizing.avatarSize}
                      name={sharedAvatarPeer.name}
                      seed={sharedAvatarPeer.identitySeed}
                      alt={`${sharedAvatarPeer.name} avatar`}
                      fallbackVariant="beam"
                    />
                  </View>
                </Animated.View>
              ) : null}
              {/* Same conjunction as celebrationActive — restated inline so
                  TS narrows celebration.phase for the overlay's prop. */}
              {celebrationStage && celebration.phase !== 'idle' && celebration.current ? (
                <NutDropCelebrationOverlay
                  // Fresh instance per ceremony: back-to-back queued
                  // ceremonies never pass through 'idle', so without the key
                  // the second flight would start from the first's landing.
                  key={celebrationStage.ceremonyId}
                  peer={celebrationStage.peer}
                  amount={celebration.current.amount}
                  unit={celebration.current.unit}
                  phase={celebration.phase}
                  sourceRect={celebrationStage.sourceRect}
                  containerSize={containerSize}
                  topInset={CELEBRATION_TOP_INSET}
                  bottomAvoidance={
                    NEAR_PAY_ACTION_ROW_HEIGHT +
                    NEAR_PAY_ACTION_ROW_BOTTOM +
                    spacing.lg +
                    insets.bottom
                  }
                  onSkip={skipCelebration}
                />
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
    ...StyleSheet.absoluteFill,
  },
  amountPanel: {
    zIndex: zIndex.raised,
  },
  field: {
    flex: 1,
    overflow: 'hidden',
  },
  fieldCanvas: {
    ...StyleSheet.absoluteFill,
  },
  dotFieldLayer: {
    ...StyleSheet.absoluteFill,
  },
  nearPayActionRow: {
    alignItems: 'flex-start',
    // `bottom` is applied dynamically: NEAR_PAY_ACTION_ROW_BOTTOM + safe-area
    // bottom inset (see actionRowStyle in NearPayPeerField).
    height: NEAR_PAY_ACTION_ROW_HEIGHT,
    left: 0,
    paddingHorizontal: 32,
    position: 'absolute',
    right: 0,
    zIndex: zIndex.overlay,
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
  inlineAmountHeader: {
    height: INLINE_AMOUNT_HEADER_HEIGHT,
    paddingTop: INLINE_AMOUNT_HEADER_TOP,
  },
  amountHeaderAvatarSlot: {
    width: AMOUNT_HEADER_AVATAR_SLOT_SIZE,
    height: AMOUNT_HEADER_AVATAR_SLOT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
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
  headerBadge: {
    position: 'absolute',
    right: 2,
    top: 2,
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
