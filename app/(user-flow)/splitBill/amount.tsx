/**
 * @fileoverview Split-Bill — Step 1: enter total amount.
 *
 * Lightweight standalone amount screen; doesn't use `AmountSelector` because
 * that screen is tied to coco-payment-ux's `useScreenActions('amountEntry')`
 * state machine, which is scoped to actual send/receive payment flows.
 * We just need a simple sats entry → pass the number along to participants.
 *
 * Only `sat` input for now. Future: toggle fiat like the receive flow.
 */

import React, { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';

import { CustomKeyboard } from '@/features/auth';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { Screen, useLifecycleLogger, walletLog } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';

export default function SplitBillAmountScreen() {
  useLifecycleLogger('SplitBillAmountScreen', walletLog);
  const router = useRouter();
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  // Raw string so CustomKeyboard can backspace correctly. Parsed lazily.
  const [rawInput, setRawInput] = useState('');
  const amount = parseInt(rawInput, 10) || 0;

  const handleKeyPress = useCallback((value: string) => {
    setRawInput(value);
  }, []);

  const handleNext = useCallback(async () => {
    if (amount <= 0) return;
    walletLog.info('split_bill.amount.next', { amount });
    router.push({
      pathname: '/(user-flow)/splitBill/participants' as any,
      params: { totalAmount: String(amount), unit: 'sat' },
    });
  }, [amount, router]);

  return (
    <Screen name="SplitBillAmountScreen" style={{ flex: 1, backgroundColor: background }}>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <VStack align="center" spacing={8}>
            <Text size={13} style={{ color: opacity(foreground, 0.5) }}>
              Total to split
            </Text>
            <AmountFormatter
              amount={amount}
              unit="sat"
              size={48}
              weight="heavy"
              centered
              animated
            />
            <Text size={13} style={{ color: opacity(foreground, 0.4), marginTop: 4 }}>
              You'll pick who pays next
            </Text>
          </VStack>
        </View>
      </View>

      <BottomButtons style={{ position: 'relative' }} paddingBottom={0}>
        <CustomKeyboard unit="sat" value={rawInput} onKeyPress={handleKeyPress} />
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                testID: 'split-bill-amount-next',
                text: 'Next',
                icon: 'lucide:arrow-right',
                variant: 'primary',
                onPress: handleNext,
                disabled: amount <= 0,
              },
            ]}
          />
        </HStack>
      </BottomButtons>
    </Screen>
  );
}
