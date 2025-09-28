import React from 'react';
import { greys, reds } from 'helper/colors';
import { TouchableOpacity } from './TouchableOpacity';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';

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
        className="rounded-lg border-l-[5px] shadow-sm"
        style={{
          backgroundColor: greys(theme)[800],
          borderLeftColor: getBorderColor(),
        }}
        blur>
        <VStack>
          {title && (
            <Text
              heavy
              overpass
              className="text-base"
              style={{
                color: greys(theme)[300],
                paddingLeft: 16,
                paddingRight: 4,
                paddingTop: 16,
              }}>
              {title}
            </Text>
          )}

          <HStack className="bg-transparent">
            <Text
              className="flex-1 text-base"
              style={{ color: getTextColor(), padding: 16, paddingRight: 4 }}>
              {message}
            </Text>
            {icon && <View style={{ padding: 16, paddingLeft: 4 }}>{icon}</View>}
          </HStack>
        </VStack>
      </View>
    </TouchableOpacity>
  );
};
