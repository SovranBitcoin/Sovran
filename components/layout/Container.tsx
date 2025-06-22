import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { View } from 'components/common/View';
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
      <View
        // scrollEnabled={scroll}
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

const createStyles = (theme: any) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: 16,
    },
  });

export default Container;
