/**
 * Minimal amount input component — zero business logic.
 *
 * Collects a sats amount via AmountFormatter + CustomKeyboard and
 * calls onAmountSubmit. The route wrapper handles what happens next.
 */

import { useCallback, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CustomKeyboard } from '@/features/auth';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

import type { ButtonHandlerProps } from '@/shared/ui/composed/ButtonHandler';

export interface AmountSelectorProps {
  unit: string;
  transactionType: 'send' | 'receive';
  initialAmount?: number;
  onAmountSubmit: (amount: number) => void;
  /** Called when amount changes (e.g. for header offline indicator). */
  onAmountChange?: (amount: number) => void;
  loading?: boolean;
  /** Slot for extra buttons (e.g. Paste / Scan QR) rendered alongside Next. */
  extraButtons?: ButtonHandlerProps['buttons'];
}

export function AmountSelector({
  unit,
  transactionType,
  initialAmount = 0,
  onAmountSubmit,
  onAmountChange,
  loading = false,
  extraButtons = [],
}: AmountSelectorProps) {
  const background = useThemeColor('background');
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const isCompactPhone = screenHeight <= 760;
  const isVeryCompactPhone = screenHeight <= 680;
  const amountTextSize = isVeryCompactPhone ? 36 : isCompactPhone ? 42 : 48;
  const centerSpacing = isCompactPhone ? 3 : 4;
  const topPadding = insets.top + (isCompactPhone ? 12 : 24);

  const [amount, setAmount] = useState(initialAmount);

  const handleKeyPress = useCallback(
    (value: string) => {
      const next = parseFloat(value) || 0;
      setAmount(next);
      onAmountChange?.(next);
    },
    [onAmountChange]
  );

  const handleNext = useCallback(async () => {
    if (amount > 0) onAmountSubmit(amount);
  }, [amount, onAmountSubmit]);

  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <View style={{ flex: 1, paddingTop: topPadding, paddingHorizontal: 16 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <VStack align="center" spacing={centerSpacing}>
            <AmountFormatter
              amount={amount}
              unit={unit}
              size={amountTextSize}
              weight="heavy"
              animated
              useTypeColors
              transactionType={transactionType}
              centered
            />
          </VStack>
        </View>
      </View>

      <BottomButtons style={{ position: 'relative' }} paddingBottom={0}>
        <CustomKeyboard
          loading={loading}
          unit={unit}
          compact={isCompactPhone}
          value={amount > 0 ? String(amount) : ''}
          onKeyPress={handleKeyPress}
        />
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Next',
                icon: 'lucide:arrow-right',
                variant: 'primary',
                onPress: handleNext,
                loading,
                disabled: amount <= 0,
              },
              ...extraButtons,
            ]}
          />
        </HStack>
      </BottomButtons>
    </View>
  );
}
