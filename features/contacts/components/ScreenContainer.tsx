import React, { FC, PropsWithChildren } from 'react';
import { View, StyleSheet } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export const ScreenContainer: FC<PropsWithChildren> = ({ children }) => {
  const surface = useThemeColor('surface');

  return <View style={[styles.container, { backgroundColor: surface }]}>{children}</View>;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
