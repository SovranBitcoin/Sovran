import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useOfflineStatus } from '@/runtime/connectivity';

const BORDER_WIDTH = 2;
const BANNER_HEIGHT = 14;

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

// Renders the blue "YOU ARE OFFLINE" banner and screen border around its
// children, from the runtime's connectivity verdict. Mounted around the
// navigation stack so the banner overlays every screen.
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
