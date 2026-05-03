import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  interpolate,
  Extrapolation,
  runOnJS,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Text } from '@/shared/ui/primitives/Text';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Switch, Button, Card } from 'heroui-native';
import { cashuLog, useLifecycleLogger } from '@/shared/lib/logger';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { useMintManagement } from '@/features/mint';
import { useNavigation, router } from 'expo-router';
import { Mint } from '@cashu/coco-core';
import { useBalanceContext } from '@cashu/coco-react';
import { deleteMintOperation } from '@/shared/lib/cashu/managerInternals';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { PaymentStatusIcon } from '@/shared/lib/popup/PaymentStatusIcon';
import {
  recoverySuccessPopup,
  recoveryPartialPopup,
  recoveryFailedPopup,
} from '@/shared/lib/popup';
import { fetchJson } from '@/shared/lib/apiClient';
import { MintListResponse, parseWith } from '@sovranbitcoin/schemas';

// ─── Deep probe: discover mints from audit API ─────────────────────────────

const SOVRAN_MINTS_API = 'https://api.sovran.money/api/cashu/mints';

const parseMintList = parseWith(MintListResponse, 'cashu/mints');

async function fetchDiscoveredMintUrls(
  knownUrls: string[],
  signal?: AbortSignal
): Promise<string[]> {
  const known = new Set(knownUrls.map((u) => u.replace(/\/$/, '')));
  const result = await fetchJson(SOVRAN_MINTS_API, parseMintList, 'cashu/mints', undefined, {
    signal,
  });
  if (result.isErr()) return [];
  return result.value
    .filter((u) => u.startsWith('https://'))
    .map((u) => u.replace(/\/$/, ''))
    .filter((u) => !known.has(u));
}

type RecoveryState = 'idle' | 'recovering' | 'complete' | 'error';

interface RecoveryResult {
  mint: string;
  success: boolean;
  error?: string;
  durationMs?: number;
  /** Whether this was a discovered (probed) mint vs a known one */
  isDiscovered?: boolean;
  /** Whether funds were actually recovered on this mint */
  fundsFound?: boolean;
}

interface RecoveryConfig {
  batchSize: number;
  chunkSize: number;
  probeSize: number;
  parallelKeysets: boolean;
  skipProbe: boolean;
}

// ─── Animated shield with spinner → checkmark/cross transition ───────────────

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CIRCLE_PATH =
  'M3 12c0-4.97 4.03-9 9-9c4.97 0 9 4.03 9 9c0 4.97-4.03 9-9 9c-4.97 0-9-4.03-9-9Z';
const CHECKMARK_PATH = 'M8 12l3 3l5-5';
const CROSS_PATH = 'M12 12l4 4M12 12l-4-4M12 12l-4 4M12 12l4-4';
const CIRCLE_LENGTH = 60;
const CHECKMARK_LENGTH = 14;
const CROSS_LENGTH = 23;
const PENDING_OFFSET = 45;

type ShieldStatus = 'loading' | 'success' | 'error';

const ShieldStatusIcon: React.FC<{
  size: number;
  color: string;
  successColor: string;
  errorColor: string;
  status: ShieldStatus;
}> = ({ size, color, successColor, errorColor, status }) => {
  const rotation = useSharedValue(0);
  const circleOffset = useSharedValue(PENDING_OFFSET);
  const checkmarkOffset = useSharedValue(CHECKMARK_LENGTH);
  const crossOffset = useSharedValue(CROSS_LENGTH);
  const colorProgress = useSharedValue(0);
  const prevStatusRef = React.useRef<ShieldStatus>(status);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    // Don't re-animate if already in a terminal state (success/error)
    if (prevStatus === status && status !== 'loading') return;
    if ((prevStatus === 'success' || prevStatus === 'error') && prevStatus === status) return;

    if (status === 'loading') {
      circleOffset.value = PENDING_OFFSET;
      checkmarkOffset.value = CHECKMARK_LENGTH;
      crossOffset.value = CROSS_LENGTH;
      colorProgress.value = 0;
      rotation.value = withRepeat(withTiming(360, { duration: 1500, easing: Easing.linear }), -1);
    } else {
      rotation.value = withTiming(0, { duration: 300 });
      colorProgress.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) });
      circleOffset.value = withTiming(0, { duration: 1000, easing: Easing.linear });
      const symbolTiming = withTiming(0, { duration: 200, easing: Easing.out(Easing.ease) });
      if (status === 'success') {
        checkmarkOffset.value = symbolTiming;
        crossOffset.value = CROSS_LENGTH;
      } else {
        crossOffset.value = symbolTiming;
        checkmarkOffset.value = CHECKMARK_LENGTH;
      }
    }
  }, [status, rotation, circleOffset, checkmarkOffset, crossOffset, colorProgress]);

  const targetColor = status === 'error' ? errorColor : successColor;

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const circleProps = useAnimatedProps(() => ({
    strokeDashoffset: circleOffset.value,
    stroke:
      status === 'loading'
        ? color
        : interpolateColor(colorProgress.value, [0, 1], [color, targetColor]),
  }));

  const checkmarkProps = useAnimatedProps(() => ({
    strokeDashoffset: checkmarkOffset.value,
    stroke: interpolateColor(colorProgress.value, [0, 1], [color, targetColor]),
  }));

  const crossProps = useAnimatedProps(() => ({
    strokeDashoffset: crossOffset.value,
    stroke: interpolateColor(colorProgress.value, [0, 1], [color, targetColor]),
  }));

  const shieldProps = useAnimatedProps(() => ({
    fill: interpolateColor(colorProgress.value, [0, 1], [color, targetColor]),
  }));

  const spinnerSize = size * 0.5;
  const spinnerLeft = size * 0.55;
  const spinnerTop = size * 0.55;

  return (
    <View style={{ width: size, height: size }}>
      {/* Shield body — transitions color with the spinner */}
      <Svg width={size} height={size} viewBox="0 0 24 24" style={{ position: 'absolute' }}>
        <AnimatedPath
          d="M12 1L3 5v6c0 5.5 3.8 10.7 9 12c.4-.1.7-.2 1-.3c-1-1.2-1.5-2.7-1.5-4.2c0-3.6 2.9-6.5 6.5-6.5c1 0 2 .2 2.9.7c.1-.6.1-1.1.1-1.7V5z"
          animatedProps={shieldProps}
        />
      </Svg>
      {/* Spinner → checkmark/cross overlay */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: spinnerLeft,
            top: spinnerTop,
            width: spinnerSize,
            height: spinnerSize,
          },
          spinnerStyle,
        ]}>
        <Svg width={spinnerSize} height={spinnerSize} viewBox="0 0 24 24">
          <AnimatedPath
            d={CIRCLE_PATH}
            fill="none"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={CIRCLE_LENGTH}
            animatedProps={circleProps}
          />
          <AnimatedPath
            d={CHECKMARK_PATH}
            fill="none"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={CHECKMARK_LENGTH}
            animatedProps={checkmarkProps}
          />
          <AnimatedPath
            d={CROSS_PATH}
            fill="none"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={CROSS_LENGTH}
            animatedProps={crossProps}
          />
        </Svg>
      </Animated.View>
    </View>
  );
};

const DEFAULT_CONFIG: RecoveryConfig = {
  batchSize: 25,
  chunkSize: 8,
  probeSize: 5,
  parallelKeysets: true,
  skipProbe: false,
};

// ─── Globals for tuning (read by cashu-ts + coco-core patches) ──────────────

declare global {
  var __CASHU_PERF:
    | {
        enabled: boolean;
        log: Record<string, unknown>[];
        enable(): void;
        disable(): void;
        dump(): Record<string, unknown>[];
        summary(): Record<string, { count: number; totalMs: number; min: number; max: number }>;
        report(): string;
      }
    | undefined;

  var __CASHU_RECOVERY_CONFIG: RecoveryConfig | undefined;
}

// ─── Slide to recover ──────────────────────────────────────────────────────

const THUMB_SIZE = 40;
const TRACK_PADDING = 4;

const SlideToRecover: React.FC<{
  onComplete: () => void;
  trackColor: string;
  thumbColor: string;
  textColor: string;
  iconColor: string;
  label?: string;
}> = ({ onComplete, trackColor, thumbColor, textColor, iconColor, label }) => {
  const { width: windowWidth } = useWindowDimensions();
  const sliderWidth = windowWidth - 48;
  const maxTranslate = sliderWidth - THUMB_SIZE - TRACK_PADDING * 2;
  const translateX = useSharedValue(0);
  const isComplete = useSharedValue(false);

  const handleComplete = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (isComplete.value) return;
      translateX.value = Math.max(0, Math.min(event.translationX, maxTranslate));
    })
    .onEnd(() => {
      if (isComplete.value) return;
      if (translateX.value > maxTranslate * 0.9) {
        translateX.value = withSpring(maxTranslate, { damping: 20, stiffness: 200 });
        isComplete.value = true;
        runOnJS(handleComplete)();
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const thumbAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const textAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, maxTranslate * 0.5], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureHandlerRootView>
      <View style={[styles.track, { backgroundColor: trackColor, width: sliderWidth }]}>
        <Animated.View style={[styles.textContainer, textAnimatedStyle]}>
          <Text size={16} medium style={{ color: textColor }}>
            {label || 'Swipe to recover'}
          </Text>
        </Animated.View>
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[styles.thumb, thumbAnimatedStyle, { backgroundColor: thumbColor }]}>
            <Icon name="mdi:shield-refresh" size={24} color={iconColor} />
          </Animated.View>
        </GestureDetector>
      </View>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  track: {
    height: THUMB_SIZE + TRACK_PADDING * 2,
    borderRadius: (THUMB_SIZE + TRACK_PADDING * 2) / 2,
    justifyContent: 'center',
    padding: TRACK_PADDING,
  },
  textContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ─── Main screen ────────────────────────────────────────────────────────────

export interface SettingsRecoveryScreenProps {
  /**
   * When true, renders without the Cancel button and without manipulating
   * navigation options — the screen is a forced gate (rendered inline by
   * AppGate when `seedCreatedAt` is null), not a route the user can dismiss.
   */
  gateMode?: boolean;
  /**
   * Fires when recovery transitions to `complete`. In `gateMode`, AppGate
   * uses this to mark `restoreStatus = 'complete'` so the gate falls through
   * and the rest of the app mounts. In normal usage this is undefined and
   * the screen falls back to `router.back()` via its own Close button.
   */
  onComplete?: () => void;
}

export const SettingsRecoveryScreen: React.FC<SettingsRecoveryScreenProps> = ({
  gateMode = false,
  onComplete,
}) => {
  useLifecycleLogger('SettingsRecoveryScreen');
  const [foreground, green400, red400, surfaceSecondary] = useThemeColor([
    'foreground',
    'green-400',
    'red-400',
    'surface-secondary',
  ] as const);
  const navigation = useNavigation();
  const { mints, restoreMint, loadMints } = useMintManagement();

  const [recoveryState, setRecoveryState] = useState<RecoveryState>('idle');
  const [currentMintIndex, setCurrentMintIndex] = useState(0);
  const [results, setResults] = useState<RecoveryResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Deep probe: also check mints from the audit API
  const [deepProbe, setDeepProbe] = useState(false);
  const [discoveredMintUrls, setDiscoveredMintUrls] = useState<string[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);

  useEffect(() => {
    if (!deepProbe) {
      setDiscoveredMintUrls([]);
      return;
    }
    const controller = new AbortController();
    setDiscoveryLoading(true);
    fetchDiscoveredMintUrls(
      mints.map((m) => m.mintUrl),
      controller.signal
    ).then((urls) => {
      if (controller.signal.aborted) return;
      setDiscoveredMintUrls(urls);
      setDiscoveryLoading(false);
    });
    return () => controller.abort();
  }, [deepProbe, mints]);

  // Lock navigation when recovery is in progress.
  // Skipped in gateMode — the screen isn't mounted as a route at all, so
  // touching navigation options would target the wrong screen and the
  // beforeRemove listener has no event to prevent.
  useEffect(() => {
    if (gateMode) return;
    const isLocked = recoveryState === 'recovering';
    navigation.setOptions({
      gestureEnabled: !isLocked,
      headerBackVisible: !isLocked,
      headerLeft: isLocked ? () => null : undefined,
    });
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (isLocked) e.preventDefault();
    });
    return unsubscribe;
  }, [recoveryState, navigation, gateMode]);

  // In gateMode, surface the `complete` state to AppGate so it can mark
  // restoreStatus + seedCreatedAt and let the rest of the app mount.
  useEffect(() => {
    if (gateMode && recoveryState === 'complete' && onComplete) {
      onComplete();
    }
  }, [gateMode, recoveryState, onComplete]);

  const handleStartRecovery = useCallback(async () => {
    // Build the full list of mint URLs to restore
    const knownMintUrls = mints.map((m) => m.mintUrl);
    const probeMintUrls = deepProbe ? discoveredMintUrls : [];
    const allMintUrls = [...knownMintUrls, ...probeMintUrls];

    if (allMintUrls.length === 0) {
      recoveryFailedPopup({ text: 'No mints found to recover from. Add a mint first.' });
      return;
    }

    const config = DEFAULT_CONFIG;
    globalThis.__CASHU_RECOVERY_CONFIG = config;
    globalThis.__CASHU_PERF?.enable();
    const t0 = performance.now();

    setRecoveryState('recovering');
    setResults([]);
    setCurrentMintIndex(0);
    setErrorMessage(null);

    cashuLog.info('recovery.start', {
      mintCount: allMintUrls.length,
      knownMints: knownMintUrls.length,
      discoveredMints: probeMintUrls.length,
      deepProbe,
      config,
    });

    const recoveryResults: RecoveryResult[] = allMintUrls.map((url, i) => ({
      mint: url,
      success: false,
      isDiscovered: i >= knownMintUrls.length,
    }));
    setResults([...recoveryResults]);

    try {
      const manager = CocoManager.getInstance();

      const restoreOneUrl = async (mintUrl: string, i: number) => {
        const isDiscovered = i >= knownMintUrls.length;
        const mintT0 = performance.now();
        cashuLog.info('recovery.mint.start', {
          mintUrl,
          mintIndex: i,
          totalMints: allMintUrls.length,
          isDiscovered,
        });
        try {
          await manager.wallet.restore(mintUrl);
        } catch (error) {
          cashuLog.warn('recovery.mint.restore_threw', {
            mintUrl,
            error: (error as Error)?.message,
          });
        }
        // Check if funds were actually recovered regardless of whether restore threw
        const balances = await manager.wallet.balances
          .byMint()
          .catch(() => ({}) as Awaited<ReturnType<typeof manager.wallet.balances.byMint>>);
        const mintBalance = balances[mintUrl]?.total ?? 0;
        const fundsFound = mintBalance > 0;
        const mintMs = Math.round((performance.now() - mintT0) * 100) / 100;

        recoveryResults[i] = {
          mint: mintUrl,
          success: true,
          durationMs: mintMs,
          isDiscovered,
          fundsFound,
        };

        setResults([...recoveryResults]);
      };

      setCurrentMintIndex(-1);
      await Promise.allSettled(allMintUrls.map((url, i) => restoreOneUrl(url, i)));

      // Clean up stuck pending mint operations from before the restore.
      // These were queued (typically by NPC sync) when the wallet's
      // deterministic counter was out of sync with the mint, so their
      // outputData was generated against a counter the mint had already
      // signed. They will fail forever with `outputs already signed` and
      // re-loop via the operation watcher. The proofs themselves were
      // recovered by batchRestore above, so dropping these stale operations
      // is non-destructive.
      try {
        const pendingOps = await manager.ops.mint.listPending();
        if (pendingOps.length > 0) {
          // Coco doesn't expose a public abandon API for pending operations,
          // so go through the typed seam in shared/lib/cashu/managerInternals.
          for (const op of pendingOps) {
            await deleteMintOperation(manager, op.id).catch((e) =>
              cashuLog.warn('recovery.cleanup.delete_failed', {
                operationId: op.id,
                mintUrl: op.mintUrl,
                error: (e as Error)?.message,
              })
            );
          }
          cashuLog.info('recovery.cleanup.dropped_stuck_pending_ops', {
            count: pendingOps.length,
            operationIds: pendingOps.map((o) => o.id),
          });
        }
      } catch (cleanupErr) {
        cashuLog.warn('recovery.cleanup.failed', {
          error: (cleanupErr as Error)?.message,
        });
      }

      await loadMints();
      const totalMs = Math.round((performance.now() - t0) * 100) / 100;
      const successCount = recoveryResults.filter((r) => r.success).length;
      // Only count failures on known mints — discovered mint failures are expected
      const knownFailureCount = recoveryResults
        .slice(0, knownMintUrls.length)
        .filter((r) => !r.success).length;

      cashuLog.info('recovery.complete', {
        totalMs,
        successCount,
        knownFailureCount,
        totalResults: recoveryResults.length,
        perfLogEntries: globalThis.__CASHU_PERF?.dump()?.length ?? 0,
        config,
      });
      const summary = globalThis.__CASHU_PERF?.summary();
      if (summary) cashuLog.info('recovery.perf_summary', summary);

      globalThis.__CASHU_PERF?.disable();
      globalThis.__CASHU_RECOVERY_CONFIG = undefined;

      if (knownFailureCount === 0) {
        recoverySuccessPopup({ mintCount: successCount, durationSec: (totalMs / 1000).toFixed(1) });
        setRecoveryState('complete');
      } else {
        if (successCount > 0) {
          recoveryPartialPopup({ successCount, failureCount: knownFailureCount });
        } else {
          recoveryFailedPopup();
        }
        setRecoveryState('error');
      }
    } catch (error) {
      globalThis.__CASHU_PERF?.disable();
      globalThis.__CASHU_RECOVERY_CONFIG = undefined;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(errorMsg);
      recoveryFailedPopup({ text: errorMsg });
      setRecoveryState('error');
    }
  }, [mints, deepProbe, discoveredMintUrls, loadMints]);

  const handleClose = useCallback(() => router.back(), []);

  // ─── Mint preview list (shared by idle + complete) ───────────────────────

  const renderMintList = () => (
    <Card variant="secondary" className="w-full">
      <Card.Body>
        <VStack spacing={12}>
          {mints.map((mint) => {
            const displayName = mint.mintInfo?.name || tryHostname(mint.mintUrl);
            return (
              <HStack key={mint.mintUrl} spacing={12} className="items-center">
                <Avatar
                  state={mint.mintInfo?.icon_url ? 'image' : 'fallback'}
                  picture={mint.mintInfo?.icon_url}
                  name={displayName}
                  size={36}
                />
                <Text size={14} bold numberOfLines={1} style={{ color: foreground, flex: 1 }}>
                  {displayName}
                </Text>
              </HStack>
            );
          })}
        </VStack>
      </Card.Body>
    </Card>
  );

  // ─── Idle state ─────────────────────────────────────────────────────────

  const totalMintCount = mints.length + (deepProbe ? discoveredMintUrls.length : 0);

  const renderIdleState = () => (
    <VStack spacing={24} className="flex-1 px-6 pt-12">
      <VStack spacing={24} className="flex-1 items-center justify-center">
        <View
          className="h-24 w-24 items-center justify-center self-center rounded-full"
          style={{ backgroundColor: surfaceSecondary }}>
          <Icon name="mdi:shield" size={48} color={foreground} />
        </View>

        <VStack spacing={8} className="items-center">
          <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
            Recover Wallet
          </Text>
          <Text
            size={16}
            style={{ color: opacity(foreground, 0.5), textAlign: 'center', lineHeight: 24 }}>
            Recover ecash from your mints using your seed phrase.
          </Text>
        </VStack>

        {mints.length > 0 && renderMintList()}
      </VStack>

      <VStack spacing={12} className="w-full items-center pb-6">
        <HStack
          className="w-full items-center justify-between rounded-2xl px-4 py-3"
          style={{ backgroundColor: surfaceSecondary }}>
          <VStack spacing={2} style={{ flex: 1 }}>
            <Text size={14} bold style={{ color: foreground }}>
              Search all mints
            </Text>
            <Text size={12} style={{ color: opacity(foreground, 0.4) }}>
              Probe mints you may have used before
            </Text>
          </VStack>
          <Switch isSelected={deepProbe} onSelectedChange={setDeepProbe} />
        </HStack>
        <SlideToRecover
          onComplete={handleStartRecovery}
          trackColor={surfaceSecondary}
          thumbColor={foreground}
          textColor={foreground}
          iconColor={surfaceSecondary}
        />
        {!gateMode && (
          <Button variant="secondary" className="w-full" onPress={handleClose}>
            <Button.Label>Cancel</Button.Label>
          </Button>
        )}
      </VStack>
    </VStack>
  );

  // ─── Probe progress row (shared) ─────────────────────────────────────────

  const renderProbeRow = () => {
    if (!deepProbe) return null;
    const discoveredResults = results.filter((r) => r.isDiscovered);
    const probed = discoveredResults.filter((r) => r.durationMs != null).length;
    const total = discoveredResults.length;
    if (total === 0) return null;
    const done = probed >= total;
    const found = discoveredResults.filter((r) => r.fundsFound).length;
    return (
      <HStack spacing={12} className="items-center">
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: foreground,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon name="mingcute:search-3-fill" size={20} color={surfaceSecondary} />
        </View>
        <VStack spacing={2} style={{ flex: 1, minWidth: 0 }}>
          <Text size={14} bold numberOfLines={1} style={{ color: foreground }}>
            {done ? 'Search complete' : 'Searching mints'}
          </Text>
          <Text size={12} style={{ color: opacity(foreground, 0.4) }}>
            {done
              ? `Probed ${total} mints${found > 0 ? `, found ${found}` : ''}`
              : `Probed ${probed} of ${total}`}
          </Text>
        </VStack>
        <View style={{ width: 24, flexShrink: 0, alignItems: 'center' }}>
          <PaymentStatusIcon size={24} status={done ? 'confirmed' : 'pending'} />
        </View>
      </HStack>
    );
  };

  // Build lookup and filter: only show known mints + discovered mints that recovered funds
  const mintsByUrl = Object.fromEntries(mints.map((m) => [m.mintUrl, m]));
  const knownMintUrlSet = new Set(mints.map((m) => m.mintUrl));
  const visibleResults = results.filter((r) => !r.isDiscovered || r.fundsFound);

  // ─── Recovering + complete states (single tree) ──────────────────────────
  //
  // Rendered with one JSX structure so React reconciles instead of
  // unmount/remount on the `recovering → complete` flip. That keeps:
  //   - the in-flight per-row PaymentStatusIcon animations playing through
  //     to their natural end instead of being killed mid-draw, and
  //   - the top ShieldStatusIcon mounted across the transition so its
  //     useEffect runs the proper `loading → success` animation (a fresh
  //     mount with status='success' would early-return without animating
  //     and leave the shield stuck in pending visuals).
  //
  // Differences between the two states are now expressed as prop/text
  // toggles inside the same tree.

  const renderActiveOrCompleteState = () => {
    const isComplete = recoveryState === 'complete';
    const successMintCount = visibleResults.filter((r) => r.success).length;
    return (
      <VStack spacing={24} className="flex-1 px-6 pt-12">
        <VStack spacing={24} className="flex-1 items-center justify-center">
          <View
            className="h-24 w-24 items-center justify-center self-center rounded-full"
            style={{ backgroundColor: surfaceSecondary }}>
            <ShieldStatusIcon
              size={48}
              color={foreground}
              successColor={green400}
              errorColor={red400}
              status={isComplete ? 'success' : 'loading'}
            />
          </View>

          <VStack spacing={8} className="items-center">
            <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
              {isComplete ? 'Recovery Complete' : 'Recovering Wallet'}
            </Text>
            <Text
              size={isComplete ? 16 : 14}
              style={{
                color: opacity(foreground, 0.5),
                textAlign: 'center',
                lineHeight: isComplete ? 24 : undefined,
              }}>
              {isComplete
                ? `Successfully recovered from ${successMintCount} mint${
                    successMintCount !== 1 ? 's' : ''
                  }.`
                : 'Restoring ecash from your mints...'}
            </Text>
          </VStack>

          <Card variant="secondary" className="w-full">
            <Card.Body>
              <VStack spacing={12}>
                {visibleResults.map((r) => (
                  <MintRecoveryRow
                    key={r.mint}
                    mintUrl={r.mint}
                    mint={mintsByUrl[r.mint]}
                    index={results.indexOf(r)}
                    // While recovering, currentMintIndex is -1 (allActive
                    // mode in MintRecoveryRow). On `complete`, push it past
                    // the last index so every row reports as done — but the
                    // per-row PaymentStatusIcon already drives off the
                    // result.success state, so this is just for the row's
                    // text dimming.
                    currentIndex={isComplete ? results.length : currentMintIndex}
                    result={r}
                  />
                ))}
                {renderProbeRow()}
              </VStack>
            </Card.Body>
          </Card>
        </VStack>

        {isComplete && (
          <VStack spacing={12} className="w-full pb-6">
            <Button
              variant="primary"
              className="w-full"
              onPress={gateMode ? onComplete : handleClose}>
              <Button.Label>{gateMode ? 'Continue' : 'Close'}</Button.Label>
            </Button>
          </VStack>
        )}
      </VStack>
    );
  };

  // ─── Error state (retry available) ──────────────────────────────────────

  const renderErrorState = () => {
    const visibleSuccessCount = visibleResults.filter((r) => r.success).length;
    const visibleFailureCount = visibleResults.filter((r) => !r.success).length;

    return (
      <VStack spacing={24} className="flex-1 px-6 pt-12">
        <VStack spacing={24} className="flex-1 items-center justify-center">
          <View
            className="h-24 w-24 items-center justify-center self-center rounded-full"
            style={{ backgroundColor: surfaceSecondary }}>
            <ShieldStatusIcon
              size={48}
              color={foreground}
              successColor={green400}
              errorColor={red400}
              status="error"
            />
          </View>

          <VStack spacing={8} className="items-center">
            <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
              {visibleSuccessCount > 0 ? 'Recovery Partial' : 'Recovery Failed'}
            </Text>
            <Text
              size={16}
              style={{ color: opacity(foreground, 0.5), textAlign: 'center', lineHeight: 24 }}>
              {visibleSuccessCount > 0
                ? `Recovered from ${visibleSuccessCount} mint${visibleSuccessCount !== 1 ? 's' : ''}, but ${visibleFailureCount} failed.`
                : errorMessage || 'An unexpected error occurred during recovery.'}
            </Text>
          </VStack>

          {visibleResults.length > 0 && (
            <Card variant="secondary" className="w-full">
              <Card.Body>
                <VStack spacing={12}>
                  {visibleResults.map((result, index) => {
                    const mint = mintsByUrl[result.mint];
                    const displayName = mint?.mintInfo?.name || tryHostname(result.mint);
                    return (
                      <HStack key={index} spacing={12} className="items-center">
                        <Avatar
                          state={mint?.mintInfo?.icon_url ? 'image' : 'fallback'}
                          picture={mint?.mintInfo?.icon_url}
                          name={displayName}
                          size={36}
                        />
                        <VStack spacing={2} style={{ flex: 1, minWidth: 0 }}>
                          <Text size={14} bold numberOfLines={1} style={{ color: foreground }}>
                            {displayName}
                          </Text>
                          {result.error && (
                            <Text size={12} numberOfLines={1} style={{ color: red400 }}>
                              {result.error}
                            </Text>
                          )}
                        </VStack>
                        <View style={{ width: 24, flexShrink: 0, alignItems: 'center' }}>
                          <PaymentStatusIcon
                            size={24}
                            status={result.success ? 'confirmed' : 'failed'}
                          />
                        </View>
                      </HStack>
                    );
                  })}
                </VStack>
              </Card.Body>
            </Card>
          )}
        </VStack>

        <VStack spacing={12} className="w-full items-center pb-6">
          <SlideToRecover
            label="Reswipe to try again"
            onComplete={handleStartRecovery}
            trackColor={surfaceSecondary}
            thumbColor={foreground}
            textColor={foreground}
            iconColor={surfaceSecondary}
          />
          {!gateMode && (
            <Button variant="secondary" className="w-full" onPress={handleClose}>
              <Button.Label>Close</Button.Label>
            </Button>
          )}
        </VStack>
      </VStack>
    );
  };

  return (
    <ScreenWrapper name="SettingsRecoveryScreen" scroll="custom" safeArea>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        scrollEnabled={recoveryState !== 'recovering'}>
        {recoveryState === 'idle' && renderIdleState()}
        {(recoveryState === 'recovering' || recoveryState === 'complete') &&
          renderActiveOrCompleteState()}
        {recoveryState === 'error' && renderErrorState()}
      </ScrollView>
    </ScreenWrapper>
  );
};

function tryHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const MintRecoveryRow: React.FC<{
  mintUrl: string;
  mint?: Mint;
  index: number;
  currentIndex: number;
  result?: RecoveryResult;
}> = ({ mintUrl, mint, index, currentIndex, result }) => {
  const [foreground, green400, red400] = useThemeColor([
    'foreground',
    'green-400',
    'red-400',
  ] as const);
  const { balances: liveBalances } = useBalanceContext();
  const mintBalance = liveBalances.byMint[mintUrl]?.total || 0;

  const allActive = currentIndex === -1;
  const hasResult = result?.durationMs != null;
  const isActive = allActive ? !hasResult : index === currentIndex;
  const isComplete = allActive ? hasResult : index < currentIndex;
  const isPending = allActive ? false : index > currentIndex;

  const displayName = mint?.mintInfo?.name || tryHostname(mintUrl);

  return (
    <HStack spacing={12} className="items-center">
      <Avatar
        state={mint?.mintInfo?.icon_url ? 'image' : 'fallback'}
        picture={mint?.mintInfo?.icon_url}
        name={displayName}
        size={36}
      />
      <VStack spacing={2} style={{ flex: 1, minWidth: 0 }}>
        <Text
          size={14}
          bold
          numberOfLines={1}
          style={{ color: isPending ? opacity(foreground, 0.33) : foreground }}>
          {displayName}
        </Text>
        <Text size={12} style={{ color: opacity(foreground, 0.4) }}>
          {mintBalance.toLocaleString()} sats
        </Text>
      </VStack>
      <View style={{ width: 24, flexShrink: 0, alignItems: 'center' }}>
        <PaymentStatusIcon
          size={24}
          status={isActive ? 'pending' : result?.success ? 'confirmed' : 'failed'}
        />
      </View>
    </HStack>
  );
};
