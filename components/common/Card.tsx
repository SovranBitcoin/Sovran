import React from 'react';
import { greys, reds } from 'helper/colors';
import { TouchableOpacity } from './TouchableOpacity';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';

interface CardProps {
  title?: string;
  message: string;
  variant: 'warning' | 'info';
  onPress?: () => void;
  icon?: React.ReactNode;
}

export const Card = ({ title, message, variant, icon, onPress }: CardProps) => {
  const theme = useSelector(memoizedGetTheme);

  const getBorderColor = () => {
    switch (variant) {
      case 'warning':
        return reds[300];
      case 'info':
      default:
        return greys(theme)[100];
    }
  };

  const getTextColor = () => {
    switch (variant) {
      case 'warning':
        return reds[300];
      case 'info':
      default:
        return greys(theme)[100];
    }
  };

  return (
    <TouchableOpacity onPress={onPress}>
      <View
        className="flex-col rounded-lg border-l-[5px] shadow-sm"
        style={{
          backgroundColor: greys(theme)[800],
          borderLeftColor: getBorderColor(),
        }}
        blur>
        {title && (
          <Text
            heavy
            overpass
            className="pl-4 pr-1 pt-4 text-base"
            style={{
              color: greys(theme)[300],
            }}>
            {title}
          </Text>
        )}

        <View className="flex-row">
          <Text className="flex-1 p-4 pr-1 text-base" style={{ color: getTextColor() }}>
            {message}
          </Text>
          {icon && <View className="p-4 pl-1">{icon}</View>}
        </View>
      </View>
    </TouchableOpacity>
  );
};
