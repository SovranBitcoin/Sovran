import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import React, { useState, useEffect, useRef } from 'react';

import { Text } from '@/shared/ui/primitives/Text';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { clearGlassHeaderLeftItems } from '@/navigation/headerItems';
import { SlideToConfirm } from '@/shared/ui/composed/SlideToConfirm';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Button } from '@/shared/ui/primitives/Button';
import Icon from 'assets/icons';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Surface } from '@/shared/ui/composed/Surface';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Switch } from '@/shared/ui/primitives/Switch';
import { cashuLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useMintManagement } from '@/features/mint';
import { useNavigation } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { Mint } from '@cashu/coco-core';
import { useBalanceContext } from '@cashu/coco-react';
import { ElapsedSeconds } from '@/shared/ui/composed/ElapsedSeconds';
import {
  computeRecoveryCounts,
  countKnownFailures,
  currentMint,
  currentMintPosition,
  describeMintProgress,
  isFailure,
  isSuccess,
  mintRecoveryError,
  mintStatusToCheckpoint,
  type MintRecoveryState,
} from '@/features/settings/lib/recoveryProgress';
import {
  isRecoveryActive,
  startRecoveryRun,
  type RecoveryRun,
  type RecoveryRunOwner,
} from '@/features/settings/lib/recoveryRun';
import { withAlpha } from '@/shared/lib/color';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { LoadingIndicator, mapCheckpointStatusToIndicator } from '@/shared/blocks/status';
import {
  DOT_SIZE,
  STROKE_PX,
  rowDelays,
} from '@/features/transactions/components/detail/timeline/timelineTheme';
import { staticPopup, paramPopup } from '@/shared/lib/popup';
import { discoverMints } from '@/shared/lib/apiClient';
import { fetchDiscoveredMintUrls } from '@/features/settings/lib/recoveryDiscovery';

// ─── Main screen ────────────────────────────────────────────────────────────

interface SettingsRecoveryScreenProps {
  /**
   * When true, renders without the Cancel button and without manipulating
   * navigation options — the screen is a forced gate (rendered inline by
   * AppGate when `seedCreatedAt` is null), not a route the user can dismiss.
   */
  gateMode?: boolean;
  /**
   * Fires when the user confirms the completed recovery. In `gateMode`, AppGate
   * uses this to mark `restoreStatus = 'complete'` so the gate falls through
   * and the rest of the app mounts. In normal usage this is undefined and the
   * screen falls back to `router.back()` via its own Close button.
   */
  onComplete?: () => void;
  /**
   * Design-system preview: lists these mints in place of the wallet's and
   * starts nothing, so no mint is asked and no wallet state changes.
   */
  preview?: { mints: Mint[] };
}

export const SettingsRecoveryScreen: React.FC<SettingsRecoveryScreenProps> = ({
  gateMode = false,
  onComplete,
  preview,
}) => {
  useLifecycleLogger('SettingsRecoveryScreen');
  const { pad } = useStylePaint().style.space;
  const [foreground, mutedColor, successColor, dangerColor, warningColor, surfaceSecondary] =
    useThemeColor([
      'foreground',
      'muted',
      'success',
      'danger',
      'warning',
      'surface-secondary',
    ] as const);
  const navigation = useNavigation();
  const { mints: walletMints, loadMints } = useMintManagement();
  const mints = preview?.mints ?? walletMints;

  const [run, setRun] = useState<RecoveryRun>({ phase: 'idle' });
  const ownerRef = useRef<RecoveryRunOwner | null>(null);
  const locked = isRecoveryActive(run);

  // Deep probe: also check mints from the audit API
  const [deepProbe, setDeepProbe] = useState(false);
  const [discoveredMintUrls, setDiscoveredMintUrls] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);

  useEffect(() => {
    if (!deepProbe || preview) {
      setDiscoveredMintUrls([]);
      return;
    }
    const controller = new AbortController();
    // Surfaced so the swipe can be held back: without this the user could
    // enable "Search all mints", swipe immediately, and get an empty probe
    // list with no indication anything was still loading.
    setIsDiscovering(true);
    void fetchDiscoveredMintUrls(
      mints.map((m) => m.mintUrl),
      discoverMints,
      controller.signal
    ).then((urls) => {
      if (controller.signal.aborted) return;
      setDiscoveredMintUrls(urls);
      setIsDiscovering(false);
    });
    return () => {
      controller.abort();
      setIsDiscovering(false);
    };
  }, [deepProbe, mints, preview]);

  // Lock navigation when recovery is in progress.
  // Skipped in gateMode — the screen isn't mounted as a route at all, so
  // touching navigation options would target the wrong screen and the
  // beforeRemove listener has no event to prevent.
  useEffect(() => {
    if (gateMode) return;
    navigation.setOptions({
      gestureEnabled: !locked,
      headerBackVisible: !locked,
      headerLeft: locked ? () => null : undefined,
      // Clear the flow's wrapped left item so recovery uses the NATIVE back
      // button (its beforeRemove guard depends on it) instead of rendering the
      // custom item alongside the native back (two backs).
      ...clearGlassHeaderLeftItems(),
    });
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (locked) e.preventDefault();
    });
    return unsubscribe;
  }, [locked, navigation, gateMode]);

  const handleStartRecovery = async () => {
    if (preview || locked || isDiscovering) return;
    // Deliberately does NOT touch `restoreStatus`. Writing 'in-progress' here
    // locked users out of the app: AppGate blocks on that value, and a
    // Settings-initiated run has nothing that clears it afterwards, so every
    // subsequent launch booted straight into the recovery gate. It also bought
    // nothing — a kill mid-recovery leaves 'pending', and the gate re-showing
    // is the correct response to an interrupted recovery either way. Only the
    // gate owns this flag, via `onComplete`.
    const started = startRecoveryRun(
      {
        knownMintUrls: mints.map((m) => m.mintUrl),
        probeCandidates: deepProbe ? discoveredMintUrls : [],
        loadMints,
      },
      run,
      setRun
    );
    if (started.status === 'busy') return;
    if (started.status === 'noMints') {
      staticPopup('recovery-failed', { text: 'No mints found to recover from. Add a mint first.' });
      return;
    }
    ownerRef.current = started.owner;
    const ended = await started.done;
    if (ownerRef.current === started.owner) ownerRef.current = null;
    // Gate-mode owns its own UI through to AppGate's transition (SOV-00 §8).
    // The runtime popupStore survives a gate→app remount, so a toast pushed
    // here would render over the freshly-mounted wallet. The inline
    // complete and error views already provide feedback in gate mode.
    if (gateMode) return;
    const successCount = computeRecoveryCounts(ended.rows).succeeded;
    switch (ended.end.kind) {
      case 'complete':
        paramPopup('recovery-success', {
          mintCount: successCount,
          durationSec: (ended.totalMs / 1000).toFixed(1),
        });
        return;
      case 'incomplete':
        if (successCount > 0) {
          paramPopup('recovery-partial', {
            successCount,
            failureCount: countKnownFailures(ended.rows),
          });
        } else {
          staticPopup('recovery-failed');
        }
        return;
      case 'error':
        staticPopup('recovery-failed', { text: ended.end.message });
        return;
      case 'stopped':
        return;
      default: {
        const exhaustive: never = ended.end;
        return exhaustive;
      }
    }
  };

  /**
   * Stops after the mint in flight finishes. Nothing is torn down mid-mint:
   * abandoning a keyset between `batchRestore` and `saveProofs` would leave the
   * derivation counter ahead of what was persisted, and the next run would
   * re-derive secrets the mint has already signed.
   */
  const handleCancelRecovery = () => {
    ownerRef.current?.cancel();
    cashuLog.info('recovery.cancel.requested', {});
  };

  const handleClose = () => router.back();

  // ─── Mint preview list (shared by idle + complete) ───────────────────────

  const renderMintList = () => (
    <View className="w-full">
      <Surface contentStyle={{ padding: pad }}>
        <VStack gap={12}>
          {mints.map((mint) => {
            const displayName = getMintDisplayName(mint, mint.mintUrl);
            return (
              <HStack key={mint.mintUrl} gap={12} className="items-center">
                <MintIcon iconUrl={mint.mintInfo?.icon_url} name={displayName} size={36} />
                <Text size={14} bold numberOfLines={1} className="text-foreground flex-1">
                  {displayName}
                </Text>
              </HStack>
            );
          })}
        </VStack>
      </Surface>
    </View>
  );

  // ─── Idle state ─────────────────────────────────────────────────────────

  const renderIdleState = () => (
    <VStack gap={24} className="flex-1 px-6 pt-12">
      <VStack gap={24} className="flex-1 items-center justify-center">
        <View className="bg-surface-secondary h-24 w-24 items-center justify-center self-center rounded-full">
          <Icon name="mdi:shield" size={48} color={foreground} />
        </View>

        <VStack gap={8} className="items-center">
          <Text size={24} bold className="text-foreground text-center">
            {gateMode ? 'Welcome back' : 'Recover ecash'}
          </Text>
          <Text size={16} className="text-muted text-center leading-6">
            {gateMode
              ? 'Your recovery phrase is already on this device. Recover your ecash to continue.'
              : 'Each mint is asked for ecash that belongs to your recovery phrase. This can take a few minutes and needs a connection.'}
          </Text>
        </VStack>

        {mints.length > 0 && renderMintList()}
      </VStack>

      <VStack gap={12} className="w-full items-center pb-6">
        <HStack className="bg-surface-secondary w-full items-center justify-between rounded-2xl px-4 py-3">
          <VStack gap={2} className="flex-1">
            <Text size={14} bold className="text-foreground">
              Search all mints
            </Text>
            <Text size={12} className="text-muted">
              Also check mints you may have used before
            </Text>
          </VStack>
          <Switch
            testID="recovery-search-all-toggle"
            accessibilityLabel="Search all mints"
            isSelected={deepProbe}
            onSelectedChange={setDeepProbe}
          />
        </HStack>

        {isDiscovering ? (
          <Text size={14} className="text-muted" accessibilityLiveRegion="polite">
            Loading mint list…
          </Text>
        ) : (
          <SlideToConfirm
            testID="recovery-swipe"
            onConfirm={handleStartRecovery}
            iconName="mdi:shield-refresh"
            label="Swipe to recover"
            trackColor={surfaceSecondary}
            thumbColor={foreground}
            textColor={foreground}
            iconColor={surfaceSecondary}
          />
        )}
        {!gateMode && (
          <View className="w-full">
            <Button
              testID="recovery-cancel"
              variant="secondary"
              text="Cancel"
              onPress={handleClose}
            />
          </View>
        )}
      </VStack>
    </VStack>
  );

  // Every row of the run is a mint we are actually restoring: probed mints
  // were already filtered down to those the shallow probe found history at, so
  // there is nothing left to hide and no separate aggregate probe row to show.
  const mintsByUrl = Object.fromEntries(mints.map((m) => [m.mintUrl, m]));
  const visibleResults = run.phase === 'idle' ? [] : run.rows;

  // ─── Recovering + complete states (single tree) ──────────────────────────
  //
  // Rendered with one JSX structure so React reconciles instead of
  // unmount/remount on the `recovering → complete` flip. That keeps the
  // hero LoadingIndicator and per-row indicators mounted across the
  // transition so they animate from `loading → done/success` instead of
  // mounting fresh in the terminal state and short-circuiting the
  // animation (see LoadingIndicator's `startedDone` ref).

  const renderActiveOrCompleteState = (
    progress: { step: 'discovering' | 'restoring' | 'finalizing'; label: string | null } | null
  ) => {
    const isComplete = progress === null;
    // Every mint in the list is one we are really restoring, so the ring can
    // count them all — the denominator is fixed before the first mint starts
    // and never moves, which is what keeps the ring honest.
    const counts = computeRecoveryCounts(visibleResults);
    const successMintCount = visibleResults.filter((r) => isSuccess(r.status)).length;
    const canContinue = successMintCount > 0 || counts.total === 0;
    const active = currentMint(visibleResults);
    const activeMint = active ? mintsByUrl[active.mint] : undefined;
    return (
      <VStack gap={24} className="flex-1 px-6 pt-12">
        <VStack gap={24} className="flex-1 items-center justify-center">
          <View
            className="h-24 w-24 items-center justify-center self-center rounded-full"
            style={{ backgroundColor: surfaceSecondary }}>
            <LoadingIndicator
              size={48}
              phase={isComplete ? 'done' : 'loading'}
              result={counts.failed > 0 ? 'warning' : 'success'}
              // One segment per mint: the ring itself now carries how far the
              // run has actually got, instead of spinning identically from the
              // first mint to the last.
              segmentedProgress={{
                completedSegments: counts.settled,
                segmentCount: Math.max(1, counts.total),
              }}
              segmentedInProgress={progress?.step === 'restoring'}
              color={foreground}
              successColor={successColor}
              errorColor={dangerColor}
              warningColor={warningColor}
            />
          </View>

          <VStack gap={8} className="items-center">
            <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
              {isComplete
                ? 'Recovery Complete'
                : progress.step === 'finalizing'
                  ? 'Finishing Up'
                  : 'Recovering Wallet'}
            </Text>
            <Text
              size={isComplete ? 16 : 14}
              style={{
                color: withAlpha(foreground, 0.5),
                textAlign: 'center',
                lineHeight: isComplete ? 24 : undefined,
              }}>
              {isComplete
                ? `Successfully recovered from ${successMintCount} mint${
                    successMintCount !== 1 ? 's' : ''
                  }.`
                : progress.step === 'restoring'
                  ? `Mint ${currentMintPosition(visibleResults)} of ${counts.total}`
                  : (progress.label ?? 'Putting your wallet back together')}
            </Text>
            {/* Proof of life. The JS thread blocks for tens of seconds at a
                time during restore, so this is deliberately UI-thread driven —
                it keeps counting when nothing else on screen can move. */}
            {!isComplete && (
              <ElapsedSeconds
                running={locked}
                size={13}
                color={withAlpha(foreground, 0.4)}
                testID="recovery-elapsed"
              />
            )}
            {/* Naming the mint in flight only became possible once mints run
                one at a time. */}
            {active && (
              <Text size={13} numberOfLines={1} style={{ color: withAlpha(foreground, 0.6) }}>
                {getMintDisplayName(activeMint, active.mint)}
              </Text>
            )}
          </VStack>

          <View className="w-full">
            <Surface contentStyle={{ padding: pad }}>
              <VStack gap={12}>
                {visibleResults.map((r, i) => (
                  <MintRecoveryRow
                    key={r.mint}
                    mintUrl={r.mint}
                    mint={mintsByUrl[r.mint]}
                    state={r}
                    index={i}
                  />
                ))}
              </VStack>
            </Surface>
          </View>
        </VStack>

        <VStack gap={12} className="w-full pb-6">
          {isComplete ? (
            <Button
              variant="primary"
              text={gateMode ? 'Continue' : 'Close'}
              testID="recovery-continue"
              disabled={gateMode && !canContinue}
              onPress={
                gateMode
                  ? () => {
                      if (canContinue) onComplete?.();
                    }
                  : handleClose
              }
            />
          ) : (
            // Stop between mints; a cancelled run stays available for retry.
            !gateMode && (
              <Button
                variant="secondary"
                text={run.phase === 'cancelling' ? 'Stopping…' : 'Cancel'}
                testID="recovery-stop"
                disabled={run.phase === 'cancelling'}
                onPress={handleCancelRecovery}
              />
            )
          )}
        </VStack>
      </VStack>
    );
  };

  // ─── Error state (retry available) ──────────────────────────────────────

  const renderErrorState = (
    end: { kind: 'incomplete' | 'stopped' } | { kind: 'error'; message: string }
  ) => {
    const stopped = end.kind === 'stopped';
    const visibleSuccessCount = computeRecoveryCounts(visibleResults).succeeded;
    const visibleFailureCount = countKnownFailures(visibleResults);

    return (
      <VStack gap={24} className="flex-1 px-6 pt-12">
        <VStack gap={24} className="flex-1 items-center justify-center">
          <View
            className="h-24 w-24 items-center justify-center self-center rounded-full"
            style={{ backgroundColor: surfaceSecondary }}>
            <LoadingIndicator
              size={48}
              phase="done"
              result="error"
              color={foreground}
              successColor={successColor}
              errorColor={dangerColor}
            />
          </View>

          <VStack gap={8} className="items-center">
            <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
              {stopped
                ? 'Recovery stopped'
                : visibleSuccessCount > 0
                  ? 'Recovery Partial'
                  : 'Recovery Failed'}
            </Text>
            <Text
              size={16}
              style={{ color: withAlpha(foreground, 0.5), textAlign: 'center', lineHeight: 24 }}>
              {stopped
                ? 'Swipe to try again and check the remaining mints.'
                : visibleSuccessCount > 0
                  ? `Recovered from ${visibleSuccessCount} mint${visibleSuccessCount !== 1 ? 's' : ''}, but ${visibleFailureCount} failed.`
                  : (end.kind === 'error' && end.message) ||
                    'An unexpected error occurred during recovery.'}
            </Text>
          </VStack>

          {visibleResults.length > 0 && (
            <View className="w-full">
              <Surface contentStyle={{ padding: pad }}>
                <VStack gap={12}>
                  {visibleResults.map((result) => {
                    const mint = mintsByUrl[result.mint];
                    const displayName = getMintDisplayName(mint, result.mint);
                    const error = mintRecoveryError(result);
                    return (
                      <HStack key={result.mint} gap={12} className="items-center">
                        <MintIcon iconUrl={mint?.mintInfo?.icon_url} name={displayName} size={36} />
                        <VStack gap={2} style={{ flex: 1, minWidth: 0 }}>
                          <Text size={14} bold numberOfLines={1} style={{ color: foreground }}>
                            {displayName}
                          </Text>
                          {error && (
                            <Text size={12} numberOfLines={1} style={{ color: dangerColor }}>
                              {error}
                            </Text>
                          )}
                        </VStack>
                        <View style={{ width: DOT_SIZE, flexShrink: 0, alignItems: 'center' }}>
                          <LoadingIndicator
                            size={DOT_SIZE}
                            strokeWidthPx={STROKE_PX}
                            pendingColor={mutedColor}
                            successColor={successColor}
                            errorColor={dangerColor}
                            revertedColor={warningColor}
                            warningColor={warningColor}
                            {...mapCheckpointStatusToIndicator(
                              mintStatusToCheckpoint(result.status)
                            )}
                          />
                        </View>
                      </HStack>
                    );
                  })}
                </VStack>
              </Surface>
            </View>
          )}
        </VStack>

        <VStack gap={12} className="w-full items-center pb-6">
          <SlideToConfirm
            testID="recovery-swipe"
            onConfirm={handleStartRecovery}
            iconName="mdi:shield-refresh"
            label="Reswipe to try again"
            trackColor={surfaceSecondary}
            thumbColor={foreground}
            textColor={foreground}
            iconColor={surfaceSecondary}
          />
          {!gateMode && (
            <View className="w-full">
              <Button
                testID="recovery-close"
                variant="secondary"
                text="Close"
                onPress={handleClose}
              />
            </View>
          )}
        </VStack>
      </VStack>
    );
  };

  const renderRun = () => {
    switch (run.phase) {
      case 'idle':
        return renderIdleState();
      case 'running':
      case 'cancelling':
        return renderActiveOrCompleteState(run);
      case 'finished':
        return run.end.kind === 'complete'
          ? renderActiveOrCompleteState(null)
          : renderErrorState(run.end);
      default: {
        const exhaustive: never = run;
        return exhaustive;
      }
    }
  };

  return (
    <ScreenWrapper name="SettingsRecoveryScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView
        className="flex-1"
        contentContainerClassName="grow"
        // Scrolling stays enabled throughout. Locking it during a run was
        // conflating "don't navigate away" with "don't move" — navigation is
        // already blocked by the beforeRemove guard above, and with a mint list
        // that can be taller than the screen, freezing the scroll just makes a
        // multi-minute operation feel like a hang.
        scrollEnabled>
        {renderRun()}
      </ScreenScrollView>
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

function getMintDisplayName(mint: Mint | undefined, fallbackUrl: string): string {
  return mint?.mintInfo?.name || tryHostname(fallbackUrl);
}

const STILL_SCANNING_TICK_MS = 5_000;

const MintRecoveryRow: React.FC<{
  mintUrl: string;
  mint?: Mint;
  state: MintRecoveryState;
  index: number;
}> = ({ mintUrl, mint, state, index }) => {
  const [foreground, mutedColor, successColor, dangerColor, warningColor] = useThemeColor([
    'foreground',
    'muted',
    'success',
    'danger',
    'warning',
  ] as const);
  const { balances: liveBalances } = useBalanceContext();
  const mintBalance = liveBalances.byMint[mintUrl]?.total || 0;

  const displayName = getMintDisplayName(mint, mintUrl);
  // A stuck mint produces no state change, so the "still scanning" note needs
  // its own clock. Coarse on purpose, and only while this mint is scanning.
  const isRestoring = state.status === 'restoring';
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isRestoring) return;
    const interval = setInterval(() => setNowMs(Date.now()), STILL_SCANNING_TICK_MS);
    return () => clearInterval(interval);
  }, [isRestoring]);
  const progressLabel = describeMintProgress(state, nowMs);

  return (
    <HStack gap={12} className="items-center">
      <MintIcon iconUrl={mint?.mintInfo?.icon_url} name={displayName} size={36} />
      <VStack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text size={14} bold numberOfLines={1} style={{ color: foreground }}>
          {displayName}
        </Text>
        <Text
          size={12}
          numberOfLines={1}
          style={{ color: isFailure(state.status) ? dangerColor : withAlpha(foreground, 0.4) }}>
          {progressLabel ?? `${mintBalance.toLocaleString()} sats`}
        </Text>
      </VStack>
      {/* Same dot the payment timeline draws, same size, stroke weight and
          cascade — minus the connector rail, since these rows are a list of
          independent mints rather than one payment's ordered steps. A queued
          mint resolves to phase `idle`: dimmed, dashed, and stationary. */}
      <View style={{ width: DOT_SIZE, flexShrink: 0, alignItems: 'center' }}>
        <LoadingIndicator
          size={DOT_SIZE}
          strokeWidthPx={STROKE_PX}
          transitionDelayMs={rowDelays(index).dotDelayMs}
          pendingColor={mutedColor}
          successColor={successColor}
          errorColor={dangerColor}
          revertedColor={warningColor}
          warningColor={warningColor}
          {...mapCheckpointStatusToIndicator(mintStatusToCheckpoint(state.status))}
        />
      </View>
    </HStack>
  );
};
