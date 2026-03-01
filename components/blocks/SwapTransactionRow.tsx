import React, { useMemo, useCallback } from 'react';
import { router } from 'expo-router';
import opacity from 'hex-color-opacity';
import Icon from 'assets/icons';
import { UntranslatedText } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack } from 'components/ui/View/HStack';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import { convertTime } from 'helper/time';
import type { SwapGroup } from 'stores/swapTransactionsStore';
import { useThemeColor } from 'hooks/useThemeColor';

interface Props {
  group: SwapGroup;
}

export const SwapTransactionRow = React.memo(({ group }: Props) => {
  const [foreground, danger, success] = useThemeColor(['foreground', 'danger', 'success'] as const);

  const aggregate = useMemo(() => {
    const anyFailed = group.legs.some((l) => l.localStatus === 'failed');
    if (anyFailed) return { text: 'Failed', color: danger };
    if (group.state === 'running') return { text: 'Pending', color: opacity(foreground, 0.5) };
    return { text: 'Completed', color: success };
  }, [group.legs, group.state, foreground, danger, success]);

  const handlePress = useCallback(() => {
    router.navigate({
      pathname: '/swap' as any,
      params: { groupId: group.id },
    });
  }, [group.id]);

  return (
    <TouchableOpacity
      className="flex-row items-center justify-between bg-transparent px-4 py-5"
      onPress={handlePress}>
      <HStack spacing={12} flex={1}>
        <View className="relative h-7 w-7 items-center justify-center bg-transparent">
          <Icon name="mdi:swap-horizontal" color={opacity(foreground, 0.9)} size={28} />
        </View>

        <VStack spacing={0} flex={1}>
          <HStack justify="space-between" align="flex-end">
            <UntranslatedText color={foreground} bold size={14}>
              Swap
            </UntranslatedText>
            <UntranslatedText bold size={14} color={aggregate.color}>
              {aggregate.text}
            </UntranslatedText>
          </HStack>

          <HStack justify="space-between" align="center">
            <UntranslatedText size={10} color={opacity(foreground, 0.8)}>
              {convertTime(new Date(group.createdAt))}
            </UntranslatedText>
            <UntranslatedText bold size={10} color={opacity(foreground, 0.8)}>
              {group.legs.length} {group.legs.length === 1 ? 'step' : 'steps'}
            </UntranslatedText>
          </HStack>
        </VStack>
      </HStack>
    </TouchableOpacity>
  );
});

SwapTransactionRow.displayName = 'SwapTransactionRow';
