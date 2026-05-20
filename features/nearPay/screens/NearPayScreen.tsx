import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Platform, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import type { BLEPeer } from 'bitchat-module';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
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
const PEER_AVATAR_LEFT = (NODE_WIDTH - AVATAR_SIZE) / 2;
const PEER_AVATAR_TOP = spacing.xs;
const DOT_SPACING = 18;
const DOT_RADIUS = 1;
const MIN_ARC_SPACING = 78;
const FIELD_EDGE_PADDING = spacing.lg;
const PEER_ENTRY_ANIMATION_MS = 460;
const PEER_REBALANCE_ANIMATION_MS = 320;
const PEER_EXIT_SCALE = 0.94;
const PEER_ENTRY_SCALE = 0.88;
const SHARED_AVATAR_ANIMATION_MS = 430;
const FOREGROUND_THEME_KEYS = ['foreground'] as const;
const HEADER_BADGE_THEME_KEYS = ['foreground', 'shade-400', 'accent', 'accent-foreground'] as const;
const PEER_LAYOUT_CONFIG = {
  nodeWidth: NODE_WIDTH,
  nodeHeight: NODE_HEIGHT,
  edgePadding: FIELD_EDGE_PADDING,
  minArcSpacing: MIN_ARC_SPACING,
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
    <Svg pointerEvents="none" width={width} height={height} style={StyleSheet.absoluteFillObject}>
      {buckets.map((bucket) => (
        <Path key={bucket.key} d={bucket.d} fill={foreground} opacity={bucket.opacity} />
      ))}
    </Svg>
  );
});

function peerTargetsEqual(a: PeerLayoutTarget, b: PeerLayoutTarget): boolean {
  return (
    a.phase === b.phase &&
    a.x === b.x &&
    a.y === b.y &&
    a.entryX === b.entryX &&
    a.entryY === b.entryY &&
    a.exitX === b.exitX &&
    a.exitY === b.exitY &&
    a.exitStartedAt === b.exitStartedAt &&
    a.peer.peerID === b.peer.peerID &&
    a.peer.name === b.peer.name &&
    a.peer.nickname === b.peer.nickname &&
    a.peer.isConnected === b.peer.isConnected &&
    a.peer.hasDirectLink === b.peer.hasDirectLink
  );
}

const PeerNode = React.memo(function PeerNode({
  target,
  onSelect,
  hideSharedElementSource,
}: {
  target: PeerLayoutTarget;
  onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
  hideSharedElementSource?: boolean;
}) {
  const [foreground] = useThemeColor(FOREGROUND_THEME_KEYS);
  const hasAnimatedInRef = useRef(false);
  const translateX = useSharedValue(target.entryX);
  const translateY = useSharedValue(target.entryY);
  const nodeOpacity = useSharedValue(0);
  const scale = useSharedValue(PEER_ENTRY_SCALE);

  useEffect(() => {
    const firstPlacement = !hasAnimatedInRef.current;
    if (firstPlacement) {
      translateX.set(target.entryX);
      translateY.set(target.entryY);
      nodeOpacity.set(0);
      scale.set(PEER_ENTRY_SCALE);
      hasAnimatedInRef.current = true;
    }
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    cancelAnimation(nodeOpacity);
    cancelAnimation(scale);
    const exiting = target.phase === 'exiting';
    const animationDuration = exiting
      ? NEAR_PAY_EXIT_ANIMATION_MS
      : firstPlacement
        ? PEER_ENTRY_ANIMATION_MS
        : PEER_REBALANCE_ANIMATION_MS;
    const timing = { duration: animationDuration, easing: Easing.out(Easing.cubic) };
    const opacityTiming = { duration: duration.quick, easing: Easing.out(Easing.cubic) };
    translateX.set(withTiming(exiting ? target.exitX : target.x, timing));
    translateY.set(withTiming(exiting ? target.exitY : target.y, timing));
    nodeOpacity.set(
      exiting
        ? withDelay(Math.round(animationDuration * 0.62), withTiming(0, opacityTiming))
        : withTiming(1, opacityTiming)
    );
    scale.set(withTiming(exiting ? PEER_EXIT_SCALE : 1, timing));
  }, [
    nodeOpacity,
    scale,
    target.entryX,
    target.entryY,
    target.exitX,
    target.exitY,
    target.phase,
    target.x,
    target.y,
    translateX,
    translateY,
  ]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: nodeOpacity.get(),
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() },
      { scale: scale.get() },
    ],
  }));
  const nodeStyle = useMemo(() => [styles.peerNode, animatedStyle], [animatedStyle]);
  const peerPressableStyle = hideSharedElementSource
    ? styles.peerPressableHidden
    : styles.peerPressable;
  const peerNameStyle = useMemo(
    () => [styles.peerName, { color: opacity(foreground, alpha.prominent) }],
    [foreground]
  );

  const handlePress = useCallback(() => {
    if (target.phase === 'exiting') return;
    onSelect(target.peer, {
      x: target.x + PEER_AVATAR_LEFT,
      y: target.y + PEER_AVATAR_TOP,
      size: AVATAR_SIZE,
    });
  }, [onSelect, target.peer, target.phase, target.x, target.y]);

  return (
    <Animated.View style={nodeStyle}>
      <Pressable
        onPress={handlePress}
        haptics
        accessibilityRole="button"
        accessibilityLabel={`Pay ${target.peer.name}`}
        style={peerPressableStyle}>
        <Avatar
          state="fallback"
          size={AVATAR_SIZE}
          name={target.peer.name}
          seed={target.peer.peerID}
          alt={`${target.peer.name} avatar`}
        />
        <Text size={11} weight="bold" numberOfLines={1} style={peerNameStyle}>
          {target.peer.name}
        </Text>
      </Pressable>
    </Animated.View>
  );
}, arePeerNodePropsEqual);

function arePeerNodePropsEqual(
  prev: {
    target: PeerLayoutTarget;
    onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
    hideSharedElementSource?: boolean;
  },
  next: {
    target: PeerLayoutTarget;
    onSelect: (peer: NearPayLayoutPeer, avatarRect: AvatarRect) => void;
    hideSharedElementSource?: boolean;
  }
): boolean {
  return (
    prev.onSelect === next.onSelect &&
    prev.hideSharedElementSource === next.hideSharedElementSource &&
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

  return (
    <View onLayout={handleLayout} style={styles.field}>
      <DotField size={fieldSize} foreground={foreground} />
      {registry.length === 0 ? emptyContent : null}
      {targets.map((target) => (
        <PeerNode
          key={target.peer.peerID}
          target={target}
          onSelect={onSelect}
          hideSharedElementSource={selectedPeerID === target.peer.peerID}
        />
      ))}
    </View>
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
    cancelAnimation(sharedAvatarX);
    cancelAnimation(sharedAvatarY);
    cancelAnimation(sharedAvatarScale);
    cancelAnimation(sharedAvatarOpacity);
  }, [
    amountOpacity,
    amountContentOpacity,
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
        useNearPaySessionStore.getState().clear();
        paymentLog.error('near_pay.peer.start_send_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [
      machine,
      amountContentOpacity,
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
      setAmountContentMounted(false);
      amountContentOpacity.set(0);
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
      pickerOpacity.set(0);
      amountOpacity.set(1);
      setAmountContentMounted(true);
      amountContentOpacity.set(1);
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
      setAmountContentMounted(true);
      amountContentOpacity.set(0);
      amountContentOpacity.set(
        withTiming(1, { duration: duration.quick, easing: Easing.out(Easing.cubic) })
      );
    }, SHARED_AVATAR_ANIMATION_MS + 40);
    return () => clearTimeout(timeout);
  }, [
    activeRecipientPeer,
    amountContentOpacity,
    amountOpacity,
    headerAvatarRect,
    inlineAmountEntry,
    inlinePhase,
    pickerOpacity,
    selectedPeerRect,
    sharedAvatarOpacity,
    sharedAvatarScale,
    sharedAvatarX,
    sharedAvatarY,
    stopSharedElementAnimations,
  ]);

  useEffect(() => {
    if (!inlineAmountEntry || inlinePhase !== 'amount' || amountContentMounted) return;
    setAmountContentMounted(true);
    amountContentOpacity.set(0);
    amountContentOpacity.set(
      withTiming(1, { duration: duration.quick, easing: Easing.out(Easing.cubic) })
    );
  }, [amountContentMounted, amountContentOpacity, inlineAmountEntry, inlinePhase]);

  const pickerPanelStyle = useAnimatedStyle(() => ({
    opacity: pickerOpacity.get(),
  }));

  const amountPanelStyle = useAnimatedStyle(() => ({
    opacity: amountOpacity.get(),
  }));

  const amountContentStyle = useAnimatedStyle(() => ({
    opacity: amountContentOpacity.get(),
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
                  <Avatar
                    state="fallback"
                    size={AVATAR_SIZE}
                    name={sharedAvatarPeer.name}
                    seed={sharedAvatarPeer.peerID}
                    alt={`${sharedAvatarPeer.name} avatar`}
                  />
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
    justifyContent: 'center',
  },
  peerPressableHidden: {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
  },
  peerName: {
    marginTop: spacing.xs,
    textAlign: 'center',
    width: NODE_WIDTH,
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
    paddingHorizontal: spacing['2xl'],
  },
  inlineAmountBody: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    paddingHorizontal: spacing['4xl'],
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
