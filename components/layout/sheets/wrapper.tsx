import React, { useState } from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { greys, Theme } from 'helper/colors';
import { useSelector } from 'react-redux';
import { ScrollView } from 'react-native-actions-sheet'; // <- important this is from react-native-actions-sheet
import { memoizedGetTheme } from 'helper/redux/settings';
import { Spacer } from 'components/common/View';

interface WrapperProps {
  children: React.ReactNode;
  buttons?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  scrollContainerStyle?: StyleProp<ViewStyle>;
}

const Wrapper: React.FC<WrapperProps> = ({
  children,
  buttons,
  containerStyle,
  scrollContainerStyle,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const [containerHeight, setContainerHeight] = useState(0);
  const [buttonHeight, setButtonHeight] = useState(0);
  const styles = createStyles(theme, buttonHeight, containerHeight);

  return (
    <View
      onLayout={(event) => setContainerHeight(event.nativeEvent.layout.height)}
      style={[styles.actionSheetContainer, containerStyle]}>
      <ScrollView style={[styles.scrollContainer, scrollContainerStyle]}>
        {children}
        <Spacer size={buttonHeight} />
      </ScrollView>
      {buttons && (
        <View
          style={styles.buttonContainer}
          onLayout={(event) => setButtonHeight(event.nativeEvent.layout.height)}>
          {buttons}
        </View>
      )}
    </View>
  );
};

const createStyles = (theme: Theme, buttonHeight: number = 0, containerHeight: number = 0) =>
  StyleSheet.create({
    actionSheetContainer: {
      height: '100%',
      backgroundColor: greys(theme)[950],
    },
    scrollContainer: {
      padding: 16,
      height: '100%',
      backgroundColor: 'transparent',
    },
    buttonContainer: {
      padding: 0,
      backgroundColor: 'transparent',
      position: 'absolute',
      top: containerHeight - buttonHeight,
      width: '100%',
    },
    button: {
      padding: 16,
      marginTop: 12,
      alignItems: 'center',
      backgroundColor: greys(theme)[800],
      borderBottomRightRadius: 1000,
      borderRadius: 1000,
      borderWidth: 0.5,
      borderColor: greys(theme)[600],
    },
  });

export default Wrapper;
