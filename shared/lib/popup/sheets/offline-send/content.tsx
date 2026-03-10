import React, { useCallback, useEffect, useMemo } from 'react';
import { Alert } from 'heroui-native';
import { View } from '@/shared/ui/primitives/View/View';
import { SheetHeader } from '../SheetHeader';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import type { CustomSheetSharedProps } from '../types';

interface OfflineSendContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['offline-send'];
}

function formatSats(amount: number): string {
  return `${amount.toLocaleString('en-US')} sats`;
}

function formatFiatMinorUnit(minorUnit: number, symbol: string): string {
  return `${symbol}${(minorUnit / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function OfflineSendContent({ payload, close, setFooterConfig }: OfflineSendContentProps) {
  const { fiat } = payload;

  const requestedDisplay = fiat
    ? formatFiatMinorUnit(fiat.requestedMinorUnit, fiat.symbol)
    : formatSats(payload.requestedAmount);

  const footerButtons = useMemo(() => {
    const buttons: { direction: 'down' | 'up'; amount: number; label: string }[] = [];
    if (payload.roundDownAmount != null) {
      const display =
        fiat?.roundDownMinorUnit != null
          ? formatFiatMinorUnit(fiat.roundDownMinorUnit, fiat.symbol)
          : formatSats(payload.roundDownAmount);
      buttons.push({ direction: 'down', amount: payload.roundDownAmount, label: display });
    }
    if (payload.roundUpAmount != null) {
      const display =
        fiat?.roundUpMinorUnit != null
          ? formatFiatMinorUnit(fiat.roundUpMinorUnit, fiat.symbol)
          : formatSats(payload.roundUpAmount);
      buttons.push({ direction: 'up', amount: payload.roundUpAmount, label: display });
    }
    return buttons;
  }, [payload.roundDownAmount, payload.roundUpAmount, fiat]);

  const handleRoundDown = useCallback(() => {
    if (payload.roundDownAmount != null) {
      payload.onRoundDown(payload.roundDownAmount);
    }
    close();
  }, [close, payload]);

  const handleRoundUp = useCallback(() => {
    if (payload.roundUpAmount != null) {
      payload.onRoundUp(payload.roundUpAmount);
    }
    close();
  }, [close, payload]);

  const handleCancel = useCallback(() => {
    payload.onCancel();
    close();
  }, [close, payload]);

  useEffect(() => {
    setFooterConfig({
      buttons: footerButtons.length
        ? [
            ...footerButtons.map((btn) => ({
              label:
                btn.direction === 'down'
                  ? `Round down to ${btn.label}`
                  : `Round up to ${btn.label}`,
              variant: btn.direction === 'down' ? ('primary' as const) : ('tertiary' as const),
              isDisabled: false,
              onPress: btn.direction === 'down' ? handleRoundDown : handleRoundUp,
            })),
            {
              label: 'Cancel',
              variant: 'tertiary' as const,
              isDisabled: false,
              onPress: handleCancel,
            },
          ]
        : [
            {
              label: 'Close',
              variant: 'tertiary' as const,
              isDisabled: false,
              onPress: handleCancel,
            },
          ],
    });

    return () => setFooterConfig(null);
  }, [footerButtons, handleRoundDown, handleRoundUp, handleCancel, setFooterConfig]);

  return (
    <View>
      <SheetHeader title="Adjust amount" centered />
      <View className="px-0 pt-4">
        <Alert status="warning" className="bg-surface-secondary">
          <Alert.Content>
            <Alert.Title>Exact amount unavailable</Alert.Title>
            <Alert.Description>
              You requested {requestedDisplay} but your existing proofs don&apos;t match that
              exactly. Pick a nearby sendable amount to continue.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      </View>
    </View>
  );
}
