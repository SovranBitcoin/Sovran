import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { greys, reds } from 'helper/colors';
import { TouchableOpacity } from './TouchableOpacity';

interface CardProps {
  message: string;
  theme: any;
  variant: 'warning' | 'info';
  onPress?: () => void;
  icon?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ message, theme, variant, icon, onPress }) => {
  const styles = {
    warning: {
      backgroundColor: greys(theme)[1800],
      borderLeftColor: reds[300],
      color: reds[300],
    },
    info: {
      backgroundColor: greys(theme)[1800],
      borderLeftColor: greys(theme)[200],
      color: greys(theme)[200],
    },
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        backgroundColor: styles[variant].backgroundColor,
        borderLeftWidth: 5,
        borderLeftColor: styles[variant].borderLeftColor,
        borderRadius: 8,
        marginVertical: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
        flexDirection: 'row',
        alignItems: 'center',
      }}>
      <Text
        style={{
          color: styles[variant].color,
          fontSize: 16,
          fontWeight: '500',
          padding: 16,
          paddingRight: 4,
          flex: 1,
        }}>
        {message}
      </Text>
      {icon && <View style={{ padding: 16, paddingLeft: 4 }}>{icon}</View>}
    </TouchableOpacity>
  );
};
const createStyles = (theme: any) =>
  StyleSheet.create({
    sectionTitle: {
      margin: 10,
      marginLeft: 14,
      fontSize: 13,
      letterSpacing: 0.33,
      fontWeight: '500',
      color: greys(theme)[600],
      textTransform: 'uppercase',
    },
  });
