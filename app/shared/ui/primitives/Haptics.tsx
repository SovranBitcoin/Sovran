import * as Haptics from 'expo-haptics';
import { log } from '@/shared/lib/logger';

/** Fire one haptic; an unsupported platform (web, some Android) only logs. */
async function fire(type: string, play: () => Promise<void>): Promise<void> {
  try {
    await play();
  } catch (error) {
    log.warn('ui.haptics.not_supported', { type, error });
  }
}

const { ImpactFeedbackStyle: Impact, NotificationFeedbackType: Notify } = Haptics;

/** Semantic haptics. Callers `void` them: no action waits on the haptic bridge. */
class EnhancedHaptics {
  /** Success notification, only for a completed copy to the clipboard. */
  static copyHaptic = () => fire('copy', () => Haptics.notificationAsync(Notify.Success));
  /** Selection tick: tabs, toggles, pickers, slider steps. */
  static navigateHaptic = () => fire('navigation', () => Haptics.selectionAsync());
  /** Light impact: the default button press. */
  static buttonHaptic = () => fire('button', () => Haptics.impactAsync(Impact.Light));
  /** Medium impact: primary actions. */
  static actionHaptic = () => fire('action', () => Haptics.impactAsync(Impact.Medium));
  /** Heavy impact: destructive actions. */
  static destructiveHaptic = () => fire('destructive', () => Haptics.impactAsync(Impact.Heavy));
  static errorHaptic = () => fire('error', () => Haptics.notificationAsync(Notify.Error));
  static warningHaptic = () => fire('warning', () => Haptics.notificationAsync(Notify.Warning));
  static successHaptic = () => fire('success', () => Haptics.notificationAsync(Notify.Success));
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
export function outcomeHaptic(
  severity: 'success' | 'warning' | 'error' | 'info' | undefined
): void {
  if (severity === 'success') void EnhancedHaptics.successHaptic();
  else if (severity === 'warning') void EnhancedHaptics.warningHaptic();
  else if (severity === 'error') void EnhancedHaptics.errorHaptic();
}
