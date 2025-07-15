import React from 'react';
import { SafeAreaView, StyleSheet, ViewStyle } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, Theme } from 'helper/colors';

interface CustomSafeAreaViewProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

const CustomSafeAreaView: React.FC<CustomSafeAreaViewProps> = ({ children, style }) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return <SafeAreaView style={[styles.container, style]}>{children}</SafeAreaView>;
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: greys(theme)[950],
    },
  });

export default CustomSafeAreaView;
