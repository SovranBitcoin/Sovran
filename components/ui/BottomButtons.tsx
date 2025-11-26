import React, { ReactNode } from 'react';
import { StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View } from 'components/ui/View';

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
export function BottomButtons({ children, paddingBottom = 16, style }: BottomButtonsProps) {
  const insets = useSafeAreaInsets();

  return (
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
