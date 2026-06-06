import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { LoadingIndicator } from '@/shared/blocks/status';

export function Spinner({
  size = 8,
  style,
  color,
}: {
  size?: number;
  style?: StyleProp<ViewStyle>;
  color?: string;
}) {
  return (
    <View testID="spinner-loading-indicator" style={[styles.container, style]}>
      <LoadingIndicator size={size} phase="loading" color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
