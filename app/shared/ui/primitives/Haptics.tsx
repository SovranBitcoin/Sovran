import { createContext, useContext, type ReactNode } from 'react';
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

/**
 * Haptic feedback a control fires from its own press lifecycle. Every shared
 * press surface takes `haptics?: PressHaptics`: omitted gives the control's
 * default (a light impact on press-in for a plain `Pressable`), `false` opts
 * out, `true` is the default, and an object overrides fields of it.
 */
export interface HapticConfig {
  /** `'selection'` is the light tick for toggles, tabs and pickers. */
  type?: 'selection' | 'impact' | 'notification';
  /** Impact style — only used when `type` is `'impact'` */
  impactStyle?: 'light' | 'medium' | 'heavy';
  /** Notification kind — only used when `type` is `'notification'` */
  notificationType?: 'success' | 'warning' | 'error';
  /** Fire on `onPressIn`. Default `true`. */
  onPressStart?: boolean;
  /** Fire on `onPress`. Default `false`. */
  onPressEnd?: boolean;
}

export type PressHaptics = boolean | HapticConfig;

const DEFAULT_PRESS_HAPTIC: Required<HapticConfig> = {
  type: 'impact',
  impactStyle: 'light',
  notificationType: 'success',
  onPressStart: true,
  onPressEnd: false,
};

/** Selection tick on press-in, for toggles, tabs, segments and check rows. */
export const SELECTION_HAPTICS: HapticConfig = { type: 'selection' };

/**
 * Light impact on release instead of press-in, for rows in scrolling lists: a
 * press-in fires the moment a finger lands, so a scroll that starts on a row
 * would buzz. A release only reaches `onPress` when the touch was a tap.
 */
export const ROW_HAPTICS: HapticConfig = { onPressStart: false, onPressEnd: true };

/** A selection tick on release, for check/toggle rows in scrolling lists. */
export const TOGGLE_ROW_HAPTICS: HapticConfig = { ...ROW_HAPTICS, type: 'selection' };

/** Resolve a `haptics` prop against a control's default; `null` = no haptic. */
export function resolvePressHaptics(
  haptics: PressHaptics | undefined,
  fallback: PressHaptics = true
): Required<HapticConfig> | null {
  if (haptics === false) return null;
  const base =
    fallback === false
      ? null
      : { ...DEFAULT_PRESS_HAPTIC, ...(typeof fallback === 'object' ? fallback : {}) };
  if (haptics === undefined) return base;
  return { ...(base ?? DEFAULT_PRESS_HAPTIC), ...(typeof haptics === 'object' ? haptics : {}) };
}

/** Fire a resolved config. Never awaited by callers: the action does not wait. */
export function fireHapticConfig(config: Required<HapticConfig>): void {
  switch (config.type) {
    case 'selection':
      void EnhancedHaptics.navigateHaptic();
      return;
    case 'notification':
      outcomeHaptic(config.notificationType);
      return;
    case 'impact':
    default:
      if (config.impactStyle === 'medium') void EnhancedHaptics.actionHaptic();
      else if (config.impactStyle === 'heavy') void EnhancedHaptics.destructiveHaptic();
      else void EnhancedHaptics.buttonHaptic();
  }
}

/**
 * Press-in haptic for controls that bypass `Pressable` (gesture-handler taps,
 * SwiftUI buttons, `Text`/`Icon` `onPress`). Same prop contract as `Pressable`.
 */
export function firePressHaptic(haptics?: PressHaptics, fallback?: PressHaptics): void {
  const config = resolvePressHaptics(haptics, fallback);
  if (config) fireHapticConfig(config);
}

/** Outcome notification haptic. `info` (or nothing) fires none. */
export function outcomeHaptic(severity: 'success' | 'warning' | 'error' | 'info' | undefined): void {
  if (severity === 'success') void EnhancedHaptics.successHaptic();
  else if (severity === 'warning') void EnhancedHaptics.warningHaptic();
  else if (severity === 'error') void EnhancedHaptics.errorHaptic();
}

const HapticsEnabledContext = createContext(true);

/**
 * Silences press haptics for every shared control below it — the design-system
 * demo screens, whose controls are specimens rather than actions.
 */
export function HapticsOff({ children }: { children: ReactNode }) {
  return <HapticsEnabledContext.Provider value={false}>{children}</HapticsEnabledContext.Provider>;
}

/** `false` inside a `HapticsOff` scope; press surfaces skip their haptic. */
export function useHapticsEnabled(): boolean {
  return useContext(HapticsEnabledContext);
}
