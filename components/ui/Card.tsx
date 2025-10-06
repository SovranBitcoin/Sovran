import React from 'react';
import { TouchableOpacity } from './TouchableOpacity';
import { useTheme } from 'providers/ThemeProvider';
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
  const { getPrimaryColor, getShadeColor } = useTheme();

  const getBorderColor = () => {
    switch (variant) {
      case 'warning':
        return getShadeColor('300');
      case 'info':
      default:
        return getPrimaryColor('100');
    }
  };

  const getTextColor = () => {
    switch (variant) {
      case 'warning':
        return getShadeColor('300');
      case 'info':
      default:
        return getPrimaryColor('100');
    }
  };

  return (
    <TouchableOpacity onPress={onPress}>
      <View
        className="rounded-lg border-l-[5px] shadow-sm"
        style={{
          backgroundColor: getPrimaryColor('800'),
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
                color: getPrimaryColor('300'),
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
