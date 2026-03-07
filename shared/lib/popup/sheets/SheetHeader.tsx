import React from 'react';
import { BottomSheet } from 'heroui-native';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

interface SheetHeaderProps {
  title: string;
  description?: string;
  centered?: boolean;
}

/**
 * Shared custom-sheet header so all action sheets keep the same title/close-row styling.
 */
export function SheetHeader({ title, description, centered }: SheetHeaderProps) {
  return (
    <View>
      <View className="border-border flex-row items-center justify-between border-b py-1">
        <BottomSheet.Title className={`text-lg font-bold ${centered ? 'flex-1 text-center' : ''}`}>
          {title}
        </BottomSheet.Title>
        <BottomSheet.Close />
      </View>
      {description ? <Text className="text-foreground/50 pt-1 text-sm">{description}</Text> : null}
    </View>
  );
}
