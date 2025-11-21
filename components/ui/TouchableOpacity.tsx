import React, { useRef, FC, useCallback } from 'react';
import {
  TouchableOpacity as RNTouchableOpacity,
  TouchableOpacityProps,
  GestureResponderEvent,
} from 'react-native';
import { EnhancedHaptics } from './Haptics';

interface TouchPosition {
  pageX: number;
  pageY: number;
}

/**
 * Configuration for haptic feedback
 *
 * @interface HapticConfig
 * @description
 * Controls the type and behavior of haptic feedback when the component is pressed.
 */
interface HapticConfig {
  /** Type of haptic feedback to trigger */
  type?: 'selection' | 'impact' | 'notification';
  /** Impact style for impact haptic (only applies when type is 'impact') */
  impactStyle?: 'light' | 'medium' | 'heavy';
  /** Notification type for notification haptic (only applies when type is 'notification') */
  notificationType?: 'success' | 'warning' | 'error';
  /** Whether to trigger haptic feedback on press start (default: true) */
  onPressStart?: boolean;
  /** Whether to trigger haptic feedback on press end (default: false) */
  onPressEnd?: boolean;
}

interface EnhancedTouchableOpacityProps extends TouchableOpacityProps {
  /** Haptic feedback configuration (boolean or config object) */
  haptics?: boolean | HapticConfig;
}

/**
 * Enhanced TouchableOpacity that prevents press events when dragged.
 * This component tracks the touch position to determine if the user has
 * dragged their finger before releasing, preventing accidental presses.
 * Supports haptic feedback matching Button component's implementation.
 */
export const TouchableOpacity: FC<EnhancedTouchableOpacityProps> = ({
  onPress,
  onPressIn,
  onPressOut,
  haptics = false,
  ...props
}) => {
  const touchActivatePositionRef = useRef<TouchPosition | null>(null);

  // Haptic config
  const hapticConfig = typeof haptics === 'object' ? haptics : {};
  const {
    type = 'selection',
    impactStyle = 'medium',
    notificationType = 'success',
    onPressStart = true,
    onPressEnd = false,
  } = hapticConfig;

  const shouldUseHaptics = haptics !== false;

  /**
   * Triggers haptic feedback based on configuration
   *
   * @description
   * Executes the appropriate haptic feedback based on the configured type and parameters.
   * Supports selection, impact, and notification haptic types with customizable options.
   *
   * @param {string} trigger - When the haptic should trigger ('start' or 'end')
   */
  const triggerHaptic = useCallback(
    async (trigger: 'start' | 'end') => {
      if (!shouldUseHaptics) return;
      if (trigger === 'start' && !onPressStart) return;
      if (trigger === 'end' && !onPressEnd) return;

      try {
        switch (type) {
          case 'selection':
            await EnhancedHaptics.buttonHaptic();
            break;
          case 'impact':
            switch (impactStyle) {
              case 'light':
                await EnhancedHaptics.buttonHaptic();
                break;
              case 'medium':
                await EnhancedHaptics.actionHaptic();
                break;
              case 'heavy':
                await EnhancedHaptics.destructiveHaptic();
                break;
              default:
                await EnhancedHaptics.buttonHaptic();
            }
            break;
          case 'notification':
            switch (notificationType) {
              case 'success':
                await EnhancedHaptics.successHaptic();
                break;
              case 'warning':
                await EnhancedHaptics.warningHaptic();
                break;
              case 'error':
                await EnhancedHaptics.errorHaptic();
                break;
              default:
                await EnhancedHaptics.successHaptic();
            }
            break;
          default:
            await EnhancedHaptics.buttonHaptic();
        }
      } catch (error) {
        // Silently fail if haptics are not supported
        console.warn('Haptic feedback not supported on this device:', error);
      }
    },
    [shouldUseHaptics, type, impactStyle, notificationType, onPressStart, onPressEnd]
  );

  const handlePressIn = async (e: GestureResponderEvent): Promise<void> => {
    const { pageX, pageY } = e.nativeEvent;

    touchActivatePositionRef.current = {
      pageX,
      pageY,
    };

    await triggerHaptic('start');
    onPressIn?.(e);
  };

  const handlePress = async (e: GestureResponderEvent): Promise<void> => {
    // Skip if no initial position was recorded or no onPress handler
    if (!touchActivatePositionRef.current || !onPress) return;

    const { pageX, pageY } = e.nativeEvent;
    const initialPosition = touchActivatePositionRef.current;

    const absX = Math.abs(initialPosition.pageX - pageX);
    const absY = Math.abs(initialPosition.pageY - pageY);

    // Define a threshold for what constitutes a drag - currently set to 1px
    const DRAG_THRESHOLD = 1;
    const isDragged = absX > DRAG_THRESHOLD || absY > DRAG_THRESHOLD;

    if (!isDragged) {
      await triggerHaptic('end');
      onPress(e);
    }
  };

  return (
    <RNTouchableOpacity
      onPressIn={handlePressIn}
      onPress={handlePress}
      onPressOut={onPressOut}
      {...props}>
      {props.children}
    </RNTouchableOpacity>
  );
};
