import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'heroui-native';
import { View } from '@/shared/ui/primitives/View/View';
import { SheetHeader } from '../SheetHeader';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import type { CustomSheetSharedProps } from '../types';

type SelectionDirection = 'down' | 'up';

interface OfflineSendSuggestionsContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['offline-send-suggestions'];
}

function formatFooterAmount(amount: number, unit: string): string {
  const normalizedUnit = unit.toLowerCase();
  const suffix = normalizedUnit === 'sat' ? 'sats' : normalizedUnit;
  return `${amount.toLocaleString('en-US')} ${suffix}`;
}

export function OfflineSendSuggestionsContent({
  payload,
  close,
  setFooterConfig,
}: OfflineSendSuggestionsContentProps) {
  const [selectionInFlight, setSelectionInFlight] = useState<SelectionDirection | null>(null);
  const footerButtons = useMemo(() => {
    const buttons: {
      direction: SelectionDirection;
      amount: number;
    }[] = [];

    if (payload.roundUpAmount != null) {
      buttons.push({ direction: 'up', amount: payload.roundUpAmount });
    }
    if (payload.roundDownAmount != null) {
      buttons.push({ direction: 'down', amount: payload.roundDownAmount });
    }

    return buttons.slice(0, 2);
  }, [payload.roundDownAmount, payload.roundUpAmount]);

  const handleSelectAmount = useCallback(
    async (direction: SelectionDirection, amount: number | null) => {
      if (amount == null) return;

      setSelectionInFlight(direction);
      try {
        await payload.onSelectAmount(amount);
      } finally {
        close();
      }
    },
    [close, payload]
  );

  useEffect(() => {
    setFooterConfig({
      buttons: footerButtons.length
        ? footerButtons.map((button) => ({
            label:
              selectionInFlight === button.direction
                ? button.direction === 'down'
                  ? 'Rounding down...'
                  : 'Rounding up...'
                : button.direction === 'down'
                  ? `Round down to ${formatFooterAmount(button.amount, payload.unit)}`
                  : `Round up to ${formatFooterAmount(button.amount, payload.unit)}`,
            variant: button.direction === 'down' ? 'primary' : 'tertiary',
            isDisabled: selectionInFlight !== null,
            onPress: () => void handleSelectAmount(button.direction, button.amount),
          }))
        : [
            {
              label: 'Close',
              variant: 'tertiary',
              isDisabled: selectionInFlight !== null,
              onPress: close,
            },
          ],
    });

    return () => setFooterConfig(null);
  }, [close, footerButtons, handleSelectAmount, payload.unit, selectionInFlight, setFooterConfig]);

  return (
    <View>
      <SheetHeader title="Offline send" centered />
      <View className="px-0 pt-4">
        <Alert status="warning" className="bg-surface-secondary">
          <Alert.Content>
            <Alert.Title>You&apos;re offline</Alert.Title>
            <Alert.Description>
              You can&apos;t send exact amounts while offline but you can send a nearby exact
              sendable amount to continue right now.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      </View>
    </View>
  );
}
