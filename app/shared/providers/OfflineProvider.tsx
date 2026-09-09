import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import * as Network from 'expo-network';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/shared/ui/primitives/Text';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, initLog, useInitMount } from '@/shared/lib/logger';
import {
  resolveOfflineReachability,
  type OfflineReachabilityResult,
} from '@/shared/lib/offlineReachability';

initLog('Module', 'OfflineProvider loaded');

type OfflineContextValue = {
  isOffline: boolean;
};

const OfflineContext = createContext<OfflineContextValue>({ isOffline: false });

const BORDER_WIDTH = 2;
const BANNER_HEIGHT = 14;
const CONNECTIVITY_POLL_MS = 3000;
// Offline hysteresis: going offline must be CONFIRMED (consecutive failed
// evaluations spanning a minimum window) while coming back online is instant.
// Android's network listener fires per transport change (Wi-Fi<->cell, VPN,
// Doze) with transiently-false reachability fields, which used to flap the
// banner several times a minute while genuinely online.
const OFFLINE_CONFIRM_CHECKS = 2;
const OFFLINE_CONFIRM_MS = 5000;
const OFFLINE_RECHECK_DELAY_MS = 1200;
const MIN_EVAL_INTERVAL_MS = 750;

// iOS uses continuous corners. React Native doesn't expose the exact hardware corner radius,
// so this is a best-effort map by point height for modern rounded-corner iPhones.
const IOS_PHONE_CORNER_RADIUS_BY_HEIGHT: readonly { height: number; radius: number }[] = [
  { height: 812, radius: 39 },
  { height: 844, radius: 47.33 },
  { height: 852, radius: 55 },
  { height: 874, radius: 62 },
  { height: 896, radius: 41.5 },
  { height: 926, radius: 53.33 },
  { height: 932, radius: 55 },
];

function getIosCornerRadius(frameWidth: number, frameHeight: number): number {
  if (Platform.OS !== 'ios') return 0;
  if (Platform.isPad) return 18;

  const longEdge = Math.round(Math.max(frameWidth, frameHeight));
  const nearest = IOS_PHONE_CORNER_RADIUS_BY_HEIGHT.reduce((best, candidate) => {
    const bestDistance = Math.abs(best.height - longEdge);
    const candidateDistance = Math.abs(candidate.height - longEdge);
    return candidateDistance < bestDistance ? candidate : best;
  }, IOS_PHONE_CORNER_RADIUS_BY_HEIGHT[0]);

  // Tighter match for known screens, sensible fallback for newer iPhones.
  if (Math.abs(nearest.height - longEdge) <= 3) {
    return nearest.radius;
  }
  return longEdge >= 850 ? 55 : 47.33;
}

function summarizeReachability(result: OfflineReachabilityResult) {
  const successfulProbe = result.probes.find((probe) => probe.ok);
  const lastProbe = result.probes.at(-1);
  return {
    reachabilityReason: result.reason,
    probeStatus: result.probes.length === 0 ? 'skipped' : result.isOffline ? 'failed' : 'success',
    probeHost: successfulProbe?.host ?? lastProbe?.host,
    probeName: successfulProbe?.name ?? lastProbe?.name,
    probeStatusCode: successfulProbe?.status ?? lastProbe?.status,
    probeError: lastProbe?.ok ? undefined : lastProbe?.error,
    probeCount: result.probes.length,
    probeDurationMs: result.probes.reduce((total, probe) => total + probe.durationMs, 0),
  };
}

// The connectivity engine, hoisted to module scope: the closure state
// (++checkId, ??= hysteresis writes, try/finally mutex) is syntax the React
// Compiler can't lower, and inside the component it bailed the whole provider.
// Verbatim former effect body; returns the effect's cleanup function.
function startConnectivityEngine(ctx: {
  setNetworkOffline: React.Dispatch<React.SetStateAction<boolean>>;
}): () => void {
  const { setNetworkOffline } = ctx;
  let mounted = true;
  let active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
  let checking = false;
  let refreshOnResume = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let networkSubscription: { remove: () => void } | null = null;
  let lastOffline: boolean | null = null;
  let lastCheckId = 0;
  // Offline-confirmation (hysteresis) state — see constants above.
  let offlineSince: number | null = null;
  let offlineEvals = 0;
  let recheckTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEvalAt = 0;

  const commit = (
    nowOffline: boolean,
    reachabilityLog: ReturnType<typeof summarizeReachability>
  ) => {
    setNetworkOffline((prev) => {
      if (prev !== nowOffline) {
        log.info('provider.offline.transition', {
          from: prev ? 'offline' : 'online',
          to: nowOffline ? 'offline' : 'online',
          ...reachabilityLog,
        });
      }
      return nowOffline;
    });
  };

  const applyState = async (state: Network.NetworkState, checkId: number) => {
    try {
      const reachability = await resolveOfflineReachability(state);
      if (!mounted || !active || checkId !== lastCheckId) return;
      const nowOffline = reachability.isOffline;
      const reachabilityLog = summarizeReachability(reachability);
      // Only log when state actually changes to reduce noise.
      if (lastOffline !== nowOffline) {
        log.debug('provider.offline.network_state', {
          isConnected: state.isConnected,
          isInternetReachable: state.isInternetReachable,
          type: state.type,
          resolvedOffline: nowOffline,
          ...reachabilityLog,
        });
        lastOffline = nowOffline;
      }
      if (!nowOffline) {
        if (offlineSince !== null) {
          log.debug('provider.offline.pending_cancelled', { evals: offlineEvals });
        }
        offlineSince = null;
        offlineEvals = 0;
        if (recheckTimer) {
          clearTimeout(recheckTimer);
          recheckTimer = null;
        }
        commit(false, reachabilityLog);
        return;
      }
      offlineEvals += 1;
      offlineSince ??= Date.now();
      const confirmed =
        offlineEvals >= OFFLINE_CONFIRM_CHECKS && Date.now() - offlineSince >= OFFLINE_CONFIRM_MS;
      if (confirmed) {
        commit(true, reachabilityLog);
        return;
      }
      log.debug('provider.offline.pending', {
        evals: offlineEvals,
        sinceMs: Date.now() - offlineSince,
        ...reachabilityLog,
      });
      recheckTimer ??= setTimeout(() => {
        recheckTimer = null;
        void runConnectivityCheck();
      }, OFFLINE_RECHECK_DELAY_MS);
    } catch (err) {
      log.warn('provider.offline.check_failed', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  };

  const runConnectivityCheck = async () => {
    if (!mounted || !active || checking) return;
    // Coalesce listener bursts and overlapping poll/listener triggers — the
    // pending re-check (1200ms) and the poll (3000ms) clear this naturally.
    if (Date.now() - lastEvalAt < MIN_EVAL_INTERVAL_MS) return;
    lastEvalAt = Date.now();
    checking = true;
    refreshOnResume = false;
    const checkId = ++lastCheckId;
    try {
      const state = await Network.getNetworkStateAsync();
      if (!mounted || !active || checkId !== lastCheckId) return;
      await applyState(state, checkId);
    } catch (err) {
      log.warn('provider.offline.check_failed', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    } finally {
      checking = false;
      if (mounted && active && refreshOnResume) {
        lastEvalAt = 0;
        void runConnectivityCheck();
      }
    }
  };

  log.debug('provider.offline.init', { pollIntervalMs: CONNECTIVITY_POLL_MS });
  void runConnectivityCheck();
  // Route listener events through runConnectivityCheck (mutex + coalescing)
  // instead of applyState directly: getNetworkStateAsync re-reads fresh
  // state, and the native module already delays emissions for staleness.
  networkSubscription = Network.addNetworkStateListener(() => {
    void runConnectivityCheck();
  });
  if (active) interval = setInterval(runConnectivityCheck, CONNECTIVITY_POLL_MS);

  const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
    const nextActive = nextAppState === 'active';
    if (active === nextActive) return;
    active = nextActive;
    ++lastCheckId;
    offlineSince = null;
    offlineEvals = 0;
    if (recheckTimer) {
      clearTimeout(recheckTimer);
      recheckTimer = null;
    }
    if (interval) clearInterval(interval);
    interval = null;
    if (!active) return;
    log.debug('provider.offline.app_foregrounded', { reason: 'app_state_active' });
    // Revalidate after foreground even if an earlier probe is still settling.
    refreshOnResume = true;
    lastEvalAt = 0;
    void runConnectivityCheck();
    interval = setInterval(runConnectivityCheck, CONNECTIVITY_POLL_MS);
  });

  const onWebOnline = () => {
    log.info('provider.offline.web_event', { event: 'online' });
    void runConnectivityCheck();
  };

  const onWebOffline = () => {
    log.info('provider.offline.web_event', { event: 'offline' });
    setNetworkOffline(true);
  };

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('online', onWebOnline);
    window.addEventListener('offline', onWebOffline);
  }

  return () => {
    mounted = false;
    if (interval) {
      clearInterval(interval);
    }
    networkSubscription?.remove();
    appStateSubscription.remove();
    if (recheckTimer) {
      clearTimeout(recheckTimer);
      recheckTimer = null;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.removeEventListener('online', onWebOnline);
      window.removeEventListener('offline', onWebOffline);
    }
  };
}

// Context-only provider. Mount above any consumer that needs to react to live
// network state — including colada's machine, which derives the
// offline send-flow branch from getOffline(). The visual offline banner lives
// in <OfflineShell> below and consumes this context like any other UI.
export function OfflineStatusProvider({ children }: { children: React.ReactNode }) {
  useInitMount('OfflineStatusProvider');
  const [networkOffline, setNetworkOffline] = useState(false);
  const mockOffline = useSettingsStore((state) => state.mockOffline);
  const isOffline = mockOffline || networkOffline;

  useEffect(() => startConnectivityEngine({ setNetworkOffline }), []);

  // Context provider `value` — consumers can't opt out of identity churn, so
  // this stays manually memoized even under the React Compiler (hazard class).
  // ast-grep-ignore: no-manual-memo-tsx
  const contextValue = useMemo(() => ({ isOffline }), [isOffline]);

  return <OfflineContext.Provider value={contextValue}>{children}</OfflineContext.Provider>;
}

// Visual wrapper that renders the blue "YOU ARE OFFLINE" banner + screen
// border around its children. Consumes the context from <OfflineStatusProvider>
// — which must be mounted above this component. Lives inside RootLayoutContent
// so the banner overlays the navigation Stack without affecting providers above.
export function OfflineShell({ children }: { children: React.ReactNode }) {
  const { isOffline } = useOfflineStatus();
  const [foreground, info] = useThemeColor(['foreground', 'blue-300'] as const);
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const offlineAccentColor = info;
  const offlineTextColor = foreground;
  const screenCornerRadius = getIosCornerRadius(frame.width, frame.height);
  const shellCornerStyle = {
    borderRadius: screenCornerRadius,
    ...(Platform.OS === 'ios'
      ? ({
          borderCurve: 'continuous',
        } as const)
      : null),
  };
  const outerShellStyle = {
    backgroundColor: isOffline ? offlineAccentColor : 'transparent',
  };
  const topSectionStyle = {
    height: isOffline ? BANNER_HEIGHT + insets.top : 0,
  };
  const contentShellInset = isOffline ? BORDER_WIDTH : 0;
  const contentShellStyle = {
    marginTop: contentShellInset,
    marginBottom: contentShellInset,
    marginHorizontal: contentShellInset,
    borderRadius: Math.max(0, screenCornerRadius - contentShellInset),
  };

  return (
    <View style={[styles.outerShell, shellCornerStyle, outerShellStyle]}>
      <View style={[styles.topSection, topSectionStyle]}>
        {isOffline ? (
          <View
            testID="offline-banner"
            style={[
              styles.banner,
              { paddingTop: insets.top, backgroundColor: offlineAccentColor },
            ]}>
            <Text style={[styles.bannerText, { color: offlineTextColor }]}>YOU ARE OFFLINE</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.contentShell}>
        <View style={[styles.contentContainer, contentShellStyle]}>
          <View style={styles.contentFill}>{children}</View>
        </View>
      </View>
    </View>
  );
}

export function useOfflineStatus(): OfflineContextValue {
  return useContext(OfflineContext);
}

const styles = StyleSheet.create({
  outerShell: {
    flex: 1,
    overflow: 'hidden',
  },
  topSection: {
    overflow: 'hidden',
  },
  contentShell: {
    flex: 1,
  },
  contentContainer: {
    flex: 1,
    overflow: 'hidden',
    ...(Platform.OS === 'ios'
      ? ({
          borderCurve: 'continuous',
        } as const)
      : null),
  },
  contentFill: {
    flex: 1,
  },
  banner: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  bannerText: {
    fontSize: 11,
    fontFamily: 'OxygenBold',
    letterSpacing: 0.8,
  },
});
