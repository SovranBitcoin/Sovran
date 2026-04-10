import React, { ReactNode } from 'react';
import { StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Log } from '@/shared/lib/logger';
import { View } from '@/shared/ui/primitives/View/View';

interface BottomButtonsProps {
  children: ReactNode;
  /** Additional padding at the bottom, on top of safe area insets. Default: 16 */
  paddingBottom?: number;
  /** Additional styles for the container */
  style?: StyleProp<ViewStyle>;
}

/**
 * A lightweight wrapper for positioning buttons at the bottom of a screen.
 * Handles safe area insets and absolute positioning automatically.
 */
export function BottomButtons({ children, paddingBottom = 0, style }: BottomButtonsProps) {
  return (
    <Log name="BottomButtons">
      <View
        style={[
          styles.container,
          {
            paddingBottom,
          },
          style,
        ]}>
        {children}
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
  },
});
