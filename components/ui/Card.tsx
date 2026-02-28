import React from 'react';
import { TouchableOpacity } from './TouchableOpacity';
import { useThemeColor } from 'hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';

interface CardProps {
  title?: string;
  message: string;
  variant: 'warning' | 'info';
  onPress?: () => void;
  icon?: React.ReactNode;
}

export const Card = ({ title, message, variant, icon, onPress }: CardProps) => {
  const [foreground, surfaceSecondary, danger] = useThemeColor(['foreground', 'surface-secondary', 'danger'] as const);

  const getBorderColor = () => {
    switch (variant) {
      case 'warning':
        return danger;
      case 'info':
      default:
        return opacity(foreground, 0.8);
    }
  };

  const getTextColor = () => {
    switch (variant) {
      case 'warning':
        return danger;
      case 'info':
      default:
        return opacity(foreground, 0.8);
    }
  };

  return (
    <TouchableOpacity onPress={onPress}>
      <View
        className="rounded-lg border-l-[5px] shadow-sm"
        style={{
          backgroundColor: surfaceSecondary,
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
                color: opacity(foreground, 0.5),
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
