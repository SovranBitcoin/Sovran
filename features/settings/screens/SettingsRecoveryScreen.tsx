import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { SlideToConfirm } from '@/shared/ui/composed/SlideToConfirm';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Switch, Button, Card } from 'heroui-native';
import { cashuLog, useLifecycleLogger } from '@/shared/lib/logger';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { useMintManagement } from '@/features/mint';
import { useNavigation } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { Mint } from '@cashu/coco-core';
import { useBalanceContext } from '@cashu/coco-react';
import { deleteMintOperation } from '@/shared/lib/cashu/managerInternals';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { LoadingIndicator } from '@/shared/blocks/status';
import { staticPopup, paramPopup } from '@/shared/lib/popup';
import { fetchJson } from '@/shared/lib/apiClient';
import { MintListResponse, parseWith } from '@sovranbitcoin/schemas';

// ─── Deep probe: discover mints from audit API ─────────────────────────────

const SOVRAN_MINTS_API = 'https://api.sovran.money/api/cashu/mints';
const MAX_DISCOVERED_MINTS = 100;

const parseMintList = parseWith(MintListResponse, 'cashu/mints');

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

function normalizeMintUrl(url: string): string {
  return url.replace(/\/$/, '').toLowerCase();
}

// Hostname allowlist for backend-supplied mint URLs. Every admitted host
// will be probed by `wallet.restore`, which sends the user's IP and derived
// blinded messages — a compromised api.sovran.money response (or CDN MITM)
// must not aim the wallet at LAN, loopback, link-local, or `.onion` hosts.
function isAllowedMintHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost') return false;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.onion')) return false;
  // Block bare IPs entirely — public mints are reached by hostname.
  // `URL.hostname` strips brackets from IPv6 literals, leaving colons.
  if (h.includes(':')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  return true;
}

async function fetchDiscoveredMintUrls(
  knownUrls: string[],
  signal?: AbortSignal
): Promise<string[]> {
  const known = new Set(knownUrls.map(normalizeMintUrl));
  const result = await fetchJson(SOVRAN_MINTS_API, parseMintList, 'cashu/mints', undefined, {
    signal,
  });
  if (result.isErr()) return [];
  const admitted: string[] = [];
  let rejectedHost = 0;
  let rejectedScheme = 0;
  let rejectedMalformed = 0;
  for (const raw of result.value) {
    if (admitted.length >= MAX_DISCOVERED_MINTS) break;
    if (!raw.startsWith('https://')) {
      rejectedScheme++;
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      rejectedMalformed++;
      continue;
    }
    if (!isAllowedMintHost(parsed.hostname)) {
      rejectedHost++;
      continue;
    }
    const normalized = raw.replace(/\/$/, '');
    if (known.has(normalized.toLowerCase())) continue;
    admitted.push(normalized);
  }
  cashuLog.info('recovery.discover.admitted', {
    admittedCount: admitted.length,
    rejectedHost,
    rejectedScheme,
    rejectedMalformed,
    totalReturned: result.value.length,
  });
  return admitted;
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

// ─── Main screen ────────────────────────────────────────────────────────────

interface SettingsRecoveryScreenProps {
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
  const { mints, loadMints } = useMintManagement();

  const [recoveryState, setRecoveryState] = useState<RecoveryState>('idle');
  const [currentMintIndex, setCurrentMintIndex] = useState(0);
  const [results, setResults] = useState<RecoveryResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Deep probe: also check mints from the audit API
  const [deepProbe, setDeepProbe] = useState(false);
  const [discoveredMintUrls, setDiscoveredMintUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!deepProbe) {
      setDiscoveredMintUrls([]);
      return;
    }
    const controller = new AbortController();
    void fetchDiscoveredMintUrls(
      mints.map((m) => m.mintUrl),
      controller.signal
    ).then((urls) => {
      if (controller.signal.aborted) return;
      setDiscoveredMintUrls(urls);
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
      staticPopup('recovery-failed', { text: 'No mints found to recover from. Add a mint first.' });
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
          ...mintUrlLogFields(mintUrl),
          mintIndex: i,
          totalMints: allMintUrls.length,
          isDiscovered,
        });
        try {
          await manager.wallet.restore(mintUrl);
        } catch (error) {
          cashuLog.warn('recovery.mint.restore_threw', {
            ...mintUrlLogFields(mintUrl),
            error: (error as Error)?.message,
          });
        }
        // Check if funds were actually recovered regardless of whether restore threw
        const balances = await manager.wallet.balances
          .byMint()
          .catch(() => ({}) as Awaited<ReturnType<typeof manager.wallet.balances.byMint>>);
        const mintBalance = amountToNumber(balances[mintUrl]?.total);
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

      // Untrust discovered mints that returned no funds. `wallet.restore`
      // calls `mintService.addMintByUrl(url, { trusted: true })` for every
      // probed URL (see ../coco/packages/core/api/WalletApi.ts), which would
      // otherwise leave attacker-supplied URLs from the audit API permanently
      // in the trusted-mints set used by the routing surface.
      const discoveredEmpty = recoveryResults.filter((r) => r.isDiscovered && !r.fundsFound);
      if (discoveredEmpty.length > 0) {
        await Promise.allSettled(
          discoveredEmpty.map(async (r) => {
            try {
              await manager.mint.untrustMint(r.mint);
              cashuLog.info('recovery.cleanup.discovered_mint_untrusted', {
                ...mintUrlLogFields(r.mint),
              });
            } catch (e) {
              cashuLog.warn('recovery.cleanup.untrust_failed', {
                ...mintUrlLogFields(r.mint),
                error: (e as Error)?.message,
              });
            }
          })
        );
      }

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
                ...mintUrlLogFields(op.mintUrl),
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
        // Gate-mode owns its own UI through to AppGate's transition (SOV-00 §8).
        // The runtime popupStore survives a gate→app remount, so a toast pushed
        // here would render over the freshly-mounted wallet. The inline
        // `renderCompleteState` already provides feedback in gate mode.
        if (!gateMode) {
          paramPopup('recovery-success', {
            mintCount: successCount,
            durationSec: (totalMs / 1000).toFixed(1),
          });
        }
        setRecoveryState('complete');
      } else {
        if (!gateMode) {
          if (successCount > 0) {
            paramPopup('recovery-partial', { successCount, failureCount: knownFailureCount });
          } else {
            staticPopup('recovery-failed');
          }
        }
        setRecoveryState('error');
      }
    } catch (error) {
      globalThis.__CASHU_PERF?.disable();
      globalThis.__CASHU_RECOVERY_CONFIG = undefined;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(errorMsg);
      if (!gateMode) {
        staticPopup('recovery-failed', { text: errorMsg });
      }
      setRecoveryState('error');
    }
  }, [mints, deepProbe, discoveredMintUrls, loadMints, gateMode]);

  const handleClose = useCallback(() => router.back(), []);

  // ─── Mint preview list (shared by idle + complete) ───────────────────────

  const renderMintList = () => (
    <Card variant="secondary" className="w-full">
      <Card.Body>
        <VStack spacing={12}>
          {mints.map((mint) => {
            const displayName = getMintDisplayName(mint, mint.mintUrl);
            return (
              <HStack key={mint.mintUrl} spacing={12} className="items-center">
                <MintIcon iconUrl={mint.mintInfo?.icon_url} name={displayName} size={36} />
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
        <SlideToConfirm
          onConfirm={handleStartRecovery}
          iconName="mdi:shield-refresh"
          label="Swipe to recover"
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
          <LoadingIndicator size={24} phase={done ? 'done' : 'loading'} result="success" />
        </View>
      </HStack>
    );
  };

  // Build lookup and filter: only show known mints + discovered mints that recovered funds
  const mintsByUrl = Object.fromEntries(mints.map((m) => [m.mintUrl, m]));
  const visibleResults = results.filter((r) => !r.isDiscovered || r.fundsFound);

  // ─── Recovering + complete states (single tree) ──────────────────────────
  //
  // Rendered with one JSX structure so React reconciles instead of
  // unmount/remount on the `recovering → complete` flip. That keeps the
  // hero LoadingIndicator and per-row indicators mounted across the
  // transition so they animate from `loading → done/success` instead of
  // mounting fresh in the terminal state and short-circuiting the
  // animation (see LoadingIndicator's `startedDone` ref).

  const renderActiveOrCompleteState = () => {
    const isComplete = recoveryState === 'complete';
    const successMintCount = visibleResults.filter((r) => r.success).length;
    return (
      <VStack spacing={24} className="flex-1 px-6 pt-12">
        <VStack spacing={24} className="flex-1 items-center justify-center">
          <View
            className="h-24 w-24 items-center justify-center self-center rounded-full"
            style={{ backgroundColor: surfaceSecondary }}>
            <LoadingIndicator
              size={48}
              phase={isComplete ? 'done' : 'loading'}
              result="success"
              color={foreground}
              successColor={green400}
              errorColor={red400}
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
                    // per-row LoadingIndicator already drives off the
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
            <LoadingIndicator
              size={48}
              phase="done"
              result="error"
              color={foreground}
              successColor={green400}
              errorColor={red400}
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
                    const displayName = getMintDisplayName(mint, result.mint);
                    return (
                      <HStack key={index} spacing={12} className="items-center">
                        <MintIcon iconUrl={mint?.mintInfo?.icon_url} name={displayName} size={36} />
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
                          <LoadingIndicator
                            size={24}
                            phase="done"
                            result={result.success ? 'success' : 'error'}
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
          <SlideToConfirm
            onConfirm={handleStartRecovery}
            iconName="mdi:shield-refresh"
            label="Reswipe to try again"
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

function getMintDisplayName(mint: Mint | undefined, fallbackUrl: string): string {
  return mint?.mintInfo?.name || tryHostname(fallbackUrl);
}

const MintRecoveryRow: React.FC<{
  mintUrl: string;
  mint?: Mint;
  index: number;
  currentIndex: number;
  result?: RecoveryResult;
}> = ({ mintUrl, mint, index, currentIndex, result }) => {
  const foreground = useThemeColor('foreground');
  const { balances: liveBalances } = useBalanceContext();
  const mintBalance = liveBalances.byMint[mintUrl]?.total || 0;

  const allActive = currentIndex === -1;
  const hasResult = result?.durationMs != null;
  const isActive = allActive ? !hasResult : index === currentIndex;
  const isPending = allActive ? false : index > currentIndex;

  const displayName = getMintDisplayName(mint, mintUrl);

  return (
    <HStack spacing={12} className="items-center">
      <MintIcon iconUrl={mint?.mintInfo?.icon_url} name={displayName} size={36} />
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
        <LoadingIndicator
          size={24}
          phase={isActive ? 'loading' : 'done'}
          result={result?.success ? 'success' : 'error'}
        />
      </View>
    </HStack>
  );
};
