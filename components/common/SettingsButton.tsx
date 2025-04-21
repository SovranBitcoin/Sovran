import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle, TextStyle, View } from 'react-native';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { shades } from 'helper/colors';

interface SettingsButtonProps {
  onPress: () => void;
  text: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
  variant?: 'primary' | 'secondary';
  iconRight?: React.ReactNode;
}

const SettingsButton: React.FC<SettingsButtonProps> = ({
  onPress,
  text,
  style,
  textStyle,
  variant = 'secondary',
  iconRight,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const buttonStyle = [
    styles.button,
    variant === 'primary' && { backgroundColor: shades[300] },
    style,
  ];

  return (
    <TouchableOpacity onPress={onPress} style={buttonStyle}>
      <Text style={[styles.buttonText, textStyle]}>{text}</Text>
      {iconRight && <View style={styles.iconRightContainer}>{iconRight}</View>}
    </TouchableOpacity>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    button: {
      backgroundColor: greys(theme)[1800],
      padding: 10,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
    },
    buttonText: {
      color: greys(theme)[0],
      fontSize: 16,
      fontWeight: 'bold',
    },
    iconRightContainer: {
      marginLeft: 8,
    },
  });

export default SettingsButton;
