import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { Text } from 'components/common/Text';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { ScrollView } from 'react-native-actions-sheet'; // <- important this is from react-native-actions-sheet
import { memoizedGetTheme } from 'helper/redux/settings';

interface WrapperProps {
  children: React.ReactNode;
  buttons: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  scrollContainerStyle?: StyleProp<ViewStyle>;
}

interface ButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export const SheetButton: React.FC<ButtonProps> = ({ onPress, children, disabled }) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <TouchableOpacity disabled={disabled} style={[styles.button]} onPress={onPress}>
      <Text style={styles.buttonText}>{children}</Text>
    </TouchableOpacity>
  );
};

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
      <ScrollView style={[styles.scrollContainer, scrollContainerStyle]}>{children}</ScrollView>
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

const createStyles = (theme: string, buttonHeight: number, containerHeight: number) =>
  StyleSheet.create({
    actionSheetContainer: {
      height: '100%',
      backgroundColor: greys(theme)[950],
    },
    scrollContainer: {
      padding: 16,
      height: '100%',
      marginBottom: buttonHeight,
    },
    buttonContainer: {
      padding: 0,
      backgroundColor: 'transparent',
      position: 'absolute',
      top: containerHeight - buttonHeight,
      width: '100%',
    },
    sectionHeader: {
      color: greys(theme)[0],
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 12,
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
    buttonText: {
      color: greys(theme)[0],
      fontSize: 16,
    },
  });

export default Wrapper;
