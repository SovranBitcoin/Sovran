import React, { useCallback, useMemo } from 'react';
import { View, Text } from 'react-native';
import { greys, reds } from 'helper/colors';
import { TouchableOpacity } from './TouchableOpacity';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';

type VariantType = 'warning' | 'info';

interface CardProps {
  title?: string;
  message: string;
  variant: VariantType;
  onPress?: () => void;
  icon?: React.ReactNode;
}

interface VariantStyle {
  backgroundColor: string;
  borderLeftColor: string;
  color: string;
}

export const Card: React.FC<CardProps> = ({ title, message, variant, icon, onPress }) => {
  const theme = useSelector(memoizedGetTheme);

  const variantStyles = useMemo<Record<VariantType, VariantStyle>>(
    () => ({
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
    }),
    [theme]
  );

  const currentStyle = useMemo(() => variantStyles[variant], [variantStyles, variant]);

  const handlePress = useCallback(() => {
    onPress?.();
  }, [onPress]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      className="my-3 flex-row items-center rounded-lg"
      style={{
        backgroundColor: currentStyle.backgroundColor,
        borderLeftWidth: 5,
        borderLeftColor: currentStyle.borderLeftColor,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
        flexDirection: 'column',
        alignItems: 'flex-start',
      }}>
      {title && (
        <Text
          className="pl-4 pr-1 pt-4 text-base font-medium"
          style={{
            color: greys(theme)[600],
            fontFamily: 'OverpassHeavy',
          }}>
          {title}
        </Text>
      )}
      <Text
        className=" p-4 pr-1 text-base font-medium"
        style={{
          color: currentStyle.color,
          marginRight: 8,
        }}>
        {message}
      </Text>
      {icon && <View className="p-4 pl-1">{icon}</View>}
    </TouchableOpacity>
  );
};
