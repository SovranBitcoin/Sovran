import React, { useMemo, useCallback } from 'react';
import { router } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import Icon from 'assets/icons';
import { UntranslatedText } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack } from 'components/ui/View/HStack';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import { convertTime } from 'helper/time';
import type { SwapGroup } from 'stores/swapTransactionsStore';

interface Props {
  group: SwapGroup;
}

export const SwapTransactionRow = React.memo(({ group }: Props) => {
  const { getPrimaryColor, getRedColor, getGreenColor } = useTheme();

  const aggregate = useMemo(() => {
    const anyFailed = group.legs.some((l) => l.localStatus === 'failed');
    if (anyFailed) return { text: 'Failed', color: getRedColor('300') };
    if (group.state === 'running') return { text: 'Pending', color: getPrimaryColor('300') };
    return { text: 'Completed', color: getGreenColor('300') };
  }, [group.legs, group.state, getPrimaryColor, getRedColor, getGreenColor]);

  const handlePress = useCallback(() => {
    router.navigate({
      pathname: '/swap' as any,
      params: { groupId: group.id },
    });
  }, [group.id]);

  return (
    <TouchableOpacity
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'transparent',
        padding: 20,
        paddingLeft: 16,
        paddingRight: 16,
      }}
      onPress={handlePress}>
      <HStack spacing={12} flex={1}>
        <View className="relative h-7 w-7 items-center justify-center bg-transparent">
          <Icon name="mdi:swap-horizontal" color={getPrimaryColor('50')} size={28} />
        </View>

        <VStack spacing={0} flex={1}>
          <HStack justify="space-between" align="flex-end">
            <UntranslatedText color={getPrimaryColor('0')} bold size={14}>
              Swap
            </UntranslatedText>
            <UntranslatedText bold size={14} color={aggregate.color}>
              {aggregate.text}
            </UntranslatedText>
          </HStack>

          <HStack justify="space-between" align="center">
            <UntranslatedText regular size={10} color={getPrimaryColor('100')}>
              {convertTime(new Date(group.createdAt))}
            </UntranslatedText>
            <UntranslatedText bold size={10} color={getPrimaryColor('100')}>
              {group.legs.length} {group.legs.length === 1 ? 'step' : 'steps'}
            </UntranslatedText>
          </HStack>
        </VStack>
      </HStack>
    </TouchableOpacity>
  );
});

SwapTransactionRow.displayName = 'SwapTransactionRow';
