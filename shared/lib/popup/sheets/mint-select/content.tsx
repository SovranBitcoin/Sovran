import React, { useCallback, useEffect } from 'react';
import { LegendList } from '@legendapp/list';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { SheetHeader } from '../SheetHeader';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import type { CustomSheetSharedProps } from '../types';

interface MintSelectContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['mint-select'];
}

type MintRow = ActionSheetPayloads['mint-select']['mints'][number];

export function MintSelectContent({ payload, close, setFooterConfig }: MintSelectContentProps) {
  const foreground = useThemeColor('foreground');

  const handleSelect = useCallback(
    (mintUrl: string) => {
      payload.onSelectMint(mintUrl);
      close();
    },
    [payload, close]
  );

  const handleCancel = useCallback(() => {
    payload.onCancel();
    close();
  }, [payload, close]);

  useEffect(() => {
    setFooterConfig({
      buttons: [
        {
          label: 'Cancel',
          variant: 'tertiary',
          isDisabled: false,
          onPress: handleCancel,
        },
      ],
    });
    return () => setFooterConfig(null);
  }, [handleCancel, setFooterConfig]);

  const renderItem = useCallback(
    ({ item }: { item: MintRow }) => {
      const sufficient = item.balance >= payload.requiredAmount;
      return (
        <TouchableOpacity
          onPress={() => handleSelect(item.mintUrl)}
          style={{ opacity: sufficient ? 1 : 0.4 }}
          className="border-border border-b px-4 py-3">
          <HStack align="center" spacing={3}>
            <Avatar name={item.name} picture={item.iconUrl ?? undefined} size={36} />
            <VStack spacing={0.5} style={{ flex: 1 }}>
              <Text bold size={15} numberOfLines={1}>
                {item.name}
              </Text>
              <AmountFormatter amount={item.balance} unit="sat" size={13} weight="regular" />
            </VStack>
            {sufficient && (
              <Text size={12} style={{ color: foreground, opacity: 0.5 }}>
                ✓
              </Text>
            )}
          </HStack>
        </TouchableOpacity>
      );
    },
    [payload.requiredAmount, handleSelect, foreground]
  );

  return (
    <View>
      <SheetHeader
        title="Select mint"
        description={`Need at least ${payload.requiredAmount.toLocaleString('en-US')} sats`}
      />
      <View style={{ maxHeight: 400 }}>
        <LegendList
          data={payload.mints}
          renderItem={renderItem}
          keyExtractor={(item) => item.mintUrl}
          estimatedItemSize={64}
        />
      </View>
    </View>
  );
}
