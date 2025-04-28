import * as ExpoHaptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Type definitions for the Haptics module
 * Provides type safety for haptic feedback operations across platforms
 */
interface HapticsInterface {
  notificationAsync: (type: ExpoHaptics.NotificationFeedbackType) => Promise<void>;
  impactAsync: (style?: ExpoHaptics.ImpactFeedbackStyle) => Promise<void>;
  selectionAsync: () => Promise<void>;

  NotificationFeedbackType: {
    readonly Success: ExpoHaptics.NotificationFeedbackType;
    readonly Warning: ExpoHaptics.NotificationFeedbackType;
    readonly Error: ExpoHaptics.NotificationFeedbackType;
  };

  ImpactFeedbackStyle: {
    readonly Light: ExpoHaptics.ImpactFeedbackStyle;
    readonly Medium: ExpoHaptics.ImpactFeedbackStyle;
    readonly Heavy: ExpoHaptics.ImpactFeedbackStyle;
  };
}

/**
 * Create a no-op implementation for platforms that don't support haptics (like web)
 */
const createWebHaptics = (): HapticsInterface => ({
  notificationAsync: () => Promise.resolve(),
  impactAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  NotificationFeedbackType: {
    Success: 'Success' as ExpoHaptics.NotificationFeedbackType,
    Warning: 'Warning' as ExpoHaptics.NotificationFeedbackType,
    Error: 'Error' as ExpoHaptics.NotificationFeedbackType,
  },
  ImpactFeedbackStyle: {
    Light: 'Light' as ExpoHaptics.ImpactFeedbackStyle,
    Medium: 'Medium' as ExpoHaptics.ImpactFeedbackStyle,
    Heavy: 'Heavy' as ExpoHaptics.ImpactFeedbackStyle,
  },
});

/**
 * Haptics module that provides a consistent API across all platforms
 * Uses native implementation on supported platforms and a no-op implementation on web
 */
const Haptics: HapticsInterface = Platform.OS === 'web' ? createWebHaptics() : ExpoHaptics;

export default Haptics;
