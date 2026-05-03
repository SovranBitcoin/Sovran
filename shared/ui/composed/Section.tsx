import React from 'react';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface SectionProps {
  title: string;
  children: React.ReactNode;
  isDanger?: boolean;
}

/**
 * iOS Settings-style section: an uppercase title above a rounded content card.
 * Used as the standard container for grouped rows on settings, profile, share,
 * receive, mint info, and merchant detail screens.
 */
export const Section: React.FC<SectionProps> = ({ title, children, isDanger }) => {
  const danger = useThemeColor('danger');

  return (
    <View className="py-3">
      <Text
        className="text-foreground/50 my-2 ml-3 uppercase tracking-wide"
        size={13}
        medium
        style={isDanger ? { color: danger } : undefined}>
        {title}
      </Text>
      <View className="overflow-hidden rounded-xl">{children}</View>
    </View>
  );
};
