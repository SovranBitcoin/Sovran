import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import { useTheme } from 'providers/ThemeProvider';
import { View } from 'components/ui/View';

const Container: React.FC<{
  children: React.ReactNode;
  style?: any;
  contentContainerStyle?: any;
  scroll?: boolean;
}> = ({ children, style = {}, contentContainerStyle = {} }) => {
  const { getPrimaryColor } = useTheme();
  const styles = createStyles();

  return (
    <SafeAreaView style={{ flex: 1, ...style }} className="bg-primary-950">
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
