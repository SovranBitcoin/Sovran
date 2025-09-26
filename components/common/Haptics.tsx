import * as ExpoHaptics from 'expo-haptics';

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
 * Haptics module that provides a consistent API across all platforms
 * Uses native implementation on supported platforms and a no-op implementation on web
 */
const Haptics: HapticsInterface = ExpoHaptics;

export default Haptics;
