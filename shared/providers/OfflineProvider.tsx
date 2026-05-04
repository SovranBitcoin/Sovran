import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import * as Network from 'expo-network';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/shared/ui/primitives/Text';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, initLog, useInitMount } from '@/shared/lib/logger';

initLog('Module', 'OfflineProvider loaded');

type OfflineContextValue = {
  isOffline: boolean;
};

const OfflineContext = createContext<OfflineContextValue>({ isOffline: false });

const BORDER_WIDTH = 2;
const BANNER_HEIGHT = 14;
const CONNECTIVITY_POLL_MS = 3000;

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

function isOfflineFromState(state: Network.NetworkState): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

// Context-only provider. Mount above any consumer that needs to react to live
// network state — including coco-payment-ux's machine, which derives the
// offline send-flow branch from getOffline(). The visual offline banner lives
// in <OfflineShell> below and consumes this context like any other UI.
export function OfflineStatusProvider({ children }: { children: React.ReactNode }) {
  useInitMount('OfflineStatusProvider');
  const [networkOffline, setNetworkOffline] = useState(false);
  const isCheckingRef = useRef(false);
  const mockOffline = useSettingsStore((state) => state.mockOffline);
  const isOffline = mockOffline || networkOffline;

  useEffect(() => {
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    let networkSubscription: { remove: () => void } | null = null;
    let lastOffline: boolean | null = null;

    const applyState = (state: Network.NetworkState) => {
      if (!mounted) return;
      const nowOffline = isOfflineFromState(state);
      // Only log when state actually changes to reduce noise
      if (lastOffline !== nowOffline) {
        log.debug('provider.offline.network_state', {
          isConnected: state.isConnected,
          isInternetReachable: state.isInternetReachable,
          type: state.type,
          resolvedOffline: nowOffline,
        });
        lastOffline = nowOffline;
      }
      setNetworkOffline((prev) => {
        if (prev !== nowOffline) {
          log.info('provider.offline.transition', {
            from: prev ? 'offline' : 'online',
            to: nowOffline ? 'offline' : 'online',
          });
        }
        return nowOffline;
      });
    };

    const runConnectivityCheck = async () => {
      if (!mounted || isCheckingRef.current) return;
      isCheckingRef.current = true;
      try {
        const state = await Network.getNetworkStateAsync();
        applyState(state);
      } catch (err) {
        log.warn('provider.offline.check_failed', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
      } finally {
        isCheckingRef.current = false;
      }
    };

    log.debug('provider.offline.init', { pollIntervalMs: CONNECTIVITY_POLL_MS });
    runConnectivityCheck();
    networkSubscription = Network.addNetworkStateListener(applyState);
    interval = setInterval(runConnectivityCheck, CONNECTIVITY_POLL_MS);

    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        log.debug('provider.offline.app_foregrounded', { reason: 'app_state_active' });
        runConnectivityCheck();
      }
    });

    const onWebOnline = () => {
      log.info('provider.offline.web_event', { event: 'online' });
      setNetworkOffline(false);
      runConnectivityCheck();
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
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('online', onWebOnline);
        window.removeEventListener('offline', onWebOffline);
      }
    };
  }, []);

  const contextValue = useMemo(() => ({ isOffline }), [isOffline]);

  return <OfflineContext.Provider value={contextValue}>{children}</OfflineContext.Provider>;
}

// Visual wrapper that renders the orange "YOU ARE OFFLINE" banner + screen
// border around its children. Consumes the context from <OfflineStatusProvider>
// — which must be mounted above this component. Lives inside RootLayoutContent
// so the banner overlays the navigation Stack without affecting providers above.
export function OfflineShell({ children }: { children: React.ReactNode }) {
  const { isOffline } = useOfflineStatus();
  const [foreground, info] = useThemeColor(['foreground', 'red-300'] as const);
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const offlineAccentColor = info;
  const offlineTextColor = foreground;
  const screenCornerRadius = useMemo(
    () => getIosCornerRadius(frame.width, frame.height),
    [frame.height, frame.width]
  );
  const shellCornerStyle = useMemo(
    () => ({
      borderRadius: screenCornerRadius,
      ...(Platform.OS === 'ios'
        ? ({
            borderCurve: 'continuous',
          } as const)
        : null),
    }),
    [screenCornerRadius]
  );
  const outerShellStyle = useMemo(
    () => ({
      backgroundColor: isOffline ? offlineAccentColor : 'transparent',
    }),
    [isOffline, offlineAccentColor]
  );
  const topSectionStyle = useMemo(
    () => ({
      height: isOffline ? BANNER_HEIGHT + insets.top : 0,
    }),
    [insets.top, isOffline]
  );
  const contentShellStyle = useMemo(() => {
    const inset = isOffline ? BORDER_WIDTH : 0;
    const contentRadius = Math.max(0, screenCornerRadius - inset);
    return {
      marginTop: inset,
      marginBottom: inset,
      marginHorizontal: inset,
      borderRadius: contentRadius,
    };
  }, [isOffline, screenCornerRadius]);

  return (
    <View style={[styles.outerShell, shellCornerStyle, outerShellStyle]}>
      <View style={[styles.topSection, topSectionStyle]}>
        {isOffline ? (
          <View
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
