import * as ExpoHaptics from 'expo-haptics';
import { log } from '@/shared/lib/logger';

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

/**
 * Enhanced Haptics class with semantic methods for common actions
 * Provides consistent haptic feedback patterns across the app
 */
class EnhancedHaptics {
  /**
   * Haptic feedback for copy actions (addresses, text, etc.)
   * Uses success notification for positive copy confirmation
   */
  static async copyHaptic(): Promise<void> {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      log.warn('ui.haptics.not_supported', { type: 'copy', error });
    }
  }

  /**
   * Haptic feedback for navigation actions (tab switches, page transitions)
   * Uses selection feedback for navigation confirmation
   */
  static async navigateHaptic(): Promise<void> {
    try {
      await Haptics.selectionAsync();
    } catch (error) {
      log.warn('ui.haptics.not_supported', { type: 'navigation', error });
    }
  }

  /**
   * Haptic feedback for button presses and selections
   * Uses light impact for general button interactions
   */
  static async buttonHaptic(): Promise<void> {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      log.warn('ui.haptics.not_supported', { type: 'button', error });
    }
  }

  /**
   * Haptic feedback for important actions (send, delete, confirm)
   * Uses medium impact for significant actions
   */
  static async actionHaptic(): Promise<void> {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      log.warn('ui.haptics.not_supported', { type: 'action', error });
    }
  }

  /**
   * Haptic feedback for errors and warnings
   * Uses error notification for negative feedback
   */
  static async errorHaptic(): Promise<void> {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } catch (error) {
      log.warn('ui.haptics.not_supported', { type: 'error', error });
    }
  }

  /**
   * Haptic feedback for warnings and caution
   * Uses warning notification for cautionary feedback
   */
  static async warningHaptic(): Promise<void> {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (error) {
      log.warn('ui.haptics.not_supported', { type: 'warning', error });
    }
  }

  /**
   * Haptic feedback for success actions
   * Uses success notification for positive feedback
   */
  static async successHaptic(): Promise<void> {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      log.warn('ui.haptics.not_supported', { type: 'success', error });
    }
  }

  /**
   * Haptic feedback for heavy/destructive actions
   * Uses heavy impact for significant destructive actions
   */
  static async destructiveHaptic(): Promise<void> {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch (error) {
      log.warn('ui.haptics.not_supported', { type: 'destructive', error });
    }
  }
}

export { EnhancedHaptics };
