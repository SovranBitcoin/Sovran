import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';

const Container: React.FC<{
  children: React.ReactNode;
  style?: any;
  contentContainerStyle?: any;
  scroll?: boolean;
}> = ({ children, style = {}, contentContainerStyle = {}, scroll = true }) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: greys(theme)[2300], ...style }}>
      <ScrollView
        scrollEnabled={scroll}
        contentContainerStyle={[
          styles.content,
          {
            ...contentContainerStyle,
          },
        ]}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: 16,
    },
  });

export default Container;
