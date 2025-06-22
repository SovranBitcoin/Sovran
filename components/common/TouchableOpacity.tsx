import { runWithAnimationFrame } from 'app/onboard/new';
import React, { useRef, FC } from 'react';
import {
  TouchableOpacity as RNTouchableOpacity,
  TouchableOpacityProps,
  GestureResponderEvent,
} from 'react-native';

interface TouchPosition {
  pageX: number;
  pageY: number;
}

/**
 * Enhanced TouchableOpacity that prevents press events when dragged.
 * This component tracks the touch position to determine if the user has
 * dragged their finger before releasing, preventing accidental presses.
 */
export const TouchableOpacity: FC<TouchableOpacityProps> = ({
  onPress,
  onPressIn,
  onPressOut,
  ...props
}) => {
  const touchActivatePositionRef = useRef<TouchPosition | null>(null);

  const handlePressIn = (e: GestureResponderEvent): void => {
    const { pageX, pageY } = e.nativeEvent;

    touchActivatePositionRef.current = {
      pageX,
      pageY,
    };

    onPressIn?.(e);
  };

  const handlePress = (e: GestureResponderEvent): void => {
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
      runWithAnimationFrame(onPress, () => {})(e);
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
