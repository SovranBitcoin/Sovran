import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { View } from 'components/ui/View';

const Container: React.FC<{
  children: React.ReactNode;
  style?: any;
  contentContainerStyle?: any;
  scroll?: boolean;
}> = ({ children, style = {}, contentContainerStyle = {} }) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: greys(theme)[950], ...style }}>
      <View
        style={[
          styles.content,
          {
            ...contentContainerStyle,
          },
        ]}>
        {children}
      </View>
    </SafeAreaView>
  );
};

const createStyles = () =>
  StyleSheet.create({
    content: {
      paddingHorizontal: 16,
      flex: 1,
    },
  });

export default Container;
