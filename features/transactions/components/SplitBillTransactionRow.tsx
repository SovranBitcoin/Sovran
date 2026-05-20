/**
 * @fileoverview `SplitBillTransactionRow` — rendered in the unified
 * transactions timeline.
 *
 * Visually mirrors [`SwapTransactionRow`](./SwapTransactionRow.tsx): a
 * leading glyph + title + aggregated status + timestamp + secondary
 * "N/M paid" counter. Tapping the row opens the per-participant detail
 * screen.
 *
 * The aggregated status reflects the group's combined state so at a glance
 * the user knows whether the bill is outstanding, partially paid, or
 * complete — matching how the swap row flips between Pending/Completed/
 * Failed.
 */

import React, { useCallback, useMemo } from 'react';
import opacity from 'hex-color-opacity';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import Icon from 'assets/icons';
import { UntranslatedText } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { formatDate } from '@/shared/lib/date';
import type { SplitBillGroup } from '@/shared/stores/profile/splitBillTransactionsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, Log } from '@/shared/lib/logger';

interface Props {
  group: SplitBillGroup;
}

export const SplitBillTransactionRow = React.memo(({ group }: Props) => {
  const [foreground, danger, success] = useThemeColor(['foreground', 'danger', 'success'] as const);

  const aggregate = useMemo(() => {
    const total = group.participants.length;
    const paid = group.participants.filter((p) => p.paymentState === 'paid').length;
    const failed = group.participants.filter((p) => p.deliveryState === 'failed').length;

    if (group.state === 'cancelled') {
      return {
        text: 'Cancelled',
        color: opacity(foreground, 0.5),
        counter: `${paid}/${total} paid`,
      };
    }
    if (group.state === 'paid' || paid === total) {
      return { text: 'Complete', color: success, counter: `${total}/${total} paid` };
    }
    if (group.state === 'expired') {
      return { text: 'Expired', color: danger, counter: `${paid}/${total} paid` };
    }
    if (paid > 0) {
      return {
        text: 'Partial',
        color: opacity(foreground, 0.7),
        counter: `${paid}/${total} paid`,
      };
    }
    if (failed > 0) {
      return {
        text: 'Needs retry',
        color: danger,
        counter: `${paid}/${total} paid`,
      };
    }
    return {
      text: 'Pending',
      color: opacity(foreground, 0.5),
      counter: `${paid}/${total} paid`,
    };
  }, [group.state, group.participants, foreground, danger, success]);

  const handlePress = useCallback(() => {
    log.info('transaction.split_bill.press', {
      groupId: group.id,
      state: group.state,
      participants: group.participants.length,
    });
    router.navigate({
      pathname: '/(split-bill-flow)/detail',
      params: { groupId: group.id },
    });
  }, [group.id, group.state, group.participants.length]);

  return (
    <Log name="SplitBillTransactionRow">
      <Pressable
        className="flex-row items-center justify-between bg-transparent px-4 py-5"
        onPress={handlePress}>
        <HStack spacing={12} flex={1}>
          <View className="relative h-7 w-7 items-center justify-center bg-transparent">
            <Icon name="mdi:silverware-fork-knife" color={opacity(foreground, 0.9)} size={26} />
          </View>

          <VStack spacing={0} flex={1}>
            <HStack justify="space-between" align="flex-end">
              <UntranslatedText color={foreground} bold size={14}>
                Split bill
              </UntranslatedText>
              <UntranslatedText bold size={14} color={aggregate.color}>
                {aggregate.text}
              </UntranslatedText>
            </HStack>

            <HStack justify="space-between" align="center">
              <UntranslatedText size={10} color={opacity(foreground, 0.8)}>
                {formatDate(group.createdAt, 'short-date-time')}
              </UntranslatedText>
              <UntranslatedText bold size={10} color={opacity(foreground, 0.8)}>
                {aggregate.counter}
              </UntranslatedText>
            </HStack>
          </VStack>
        </HStack>
      </Pressable>
    </Log>
  );
});

SplitBillTransactionRow.displayName = 'SplitBillTransactionRow';
