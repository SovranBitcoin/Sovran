import React from 'react';
import { Log } from '@/shared/lib/logger';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';

interface CardProps {
  title?: string;
  message: string;
  variant: 'warning' | 'info';
  onPress?: () => void;
  icon?: React.ReactNode;
  /** VoiceOver/TalkBack label. Defaults to `title` (or `message` when no title). */
  accessibilityLabel?: string;
  /** Optional VoiceOver hint describing the tap outcome. */
  accessibilityHint?: string;
}

export const Card = ({
  title,
  message,
  variant,
  icon,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: CardProps) => {
  const [foreground, surfaceSecondary, danger] = useThemeColor([
    'foreground',
    'surface-secondary',
    'danger',
  ] as const);

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

  const body = (
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
  );

  const a11yLabel = accessibilityLabel ?? title ?? message;

  return (
    <Log name="Card">
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint={accessibilityHint}>
          {body}
        </Pressable>
      ) : (
        body
      )}
    </Log>
  );
};
