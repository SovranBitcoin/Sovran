import { useCallback, useMemo } from 'react';

import { Alert } from 'heroui-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { SheetHeader } from '@/shared/lib/popup/sheets/SheetHeader';

import { useSendMachine } from '../hooks/useSendMachine';

function formatSats(amount: number): string {
  return `${amount.toLocaleString('en-US')} sats`;
}

/**
 * Offline coin selection sheet, shown when the send machine
 * enters the `adjustmentPrompt` state (no exact offline match).
 *
 * Displays round-up and round-down options from the offline
 * resolution algorithm. Selecting an option sends ROUND_UP or
 * ROUND_DOWN to the machine, which executes the send.
 */
export function CoinSelectionSheet() {
  const machine = useSendMachine();
  const [foreground, success, danger] = useThemeColor(['foreground', 'success', 'danger'] as const);

  const { offlineSuggestions, fiatOfflineSuggestions, context } = machine;

  const roundDownAmount = useMemo(() => {
    if (fiatOfflineSuggestions?.roundDownOption) {
      return fiatOfflineSuggestions.roundDownOption.amount;
    }
    return offlineSuggestions?.roundDownAmount ?? null;
  }, [offlineSuggestions, fiatOfflineSuggestions]);

  const roundUpAmount = useMemo(() => {
    if (fiatOfflineSuggestions?.roundUpOption) {
      return fiatOfflineSuggestions.roundUpOption.amount;
    }
    return offlineSuggestions?.roundUpAmount ?? null;
  }, [offlineSuggestions, fiatOfflineSuggestions]);

  const handleRoundDown = useCallback(() => {
    machine.roundDown();
  }, [machine]);

  const handleRoundUp = useCallback(() => {
    machine.roundUp();
  }, [machine]);

  const handleCancel = useCallback(() => {
    machine.cancel();
  }, [machine]);

  const hasOptions = roundDownAmount != null || roundUpAmount != null;

  return (
    <View className="px-4 pb-6 pt-2">
      <SheetHeader title="Adjust Amount" centered />

      <VStack spacing={4} style={{ paddingTop: 16 }}>
        <Alert status="warning" className="bg-surface-secondary">
          <Alert.Content>
            <Alert.Title>Exact amount unavailable offline</Alert.Title>
            <Alert.Description>
              You requested {formatSats(context.amountSat)} but your existing proofs don&apos;t
              match that exactly. Pick a nearby sendable amount:
            </Alert.Description>
          </Alert.Content>
        </Alert>

        {hasOptions ? (
          <VStack spacing={2}>
            {roundDownAmount != null && (
              <TouchableOpacity
                onPress={handleRoundDown}
                className="bg-surface-secondary rounded-xl px-4 py-3">
                <Text bold size={15}>
                  Round down to {formatSats(roundDownAmount)}
                </Text>
                <Text size={13} style={{ color: foreground, opacity: 0.5 }}>
                  Send less than requested
                </Text>
              </TouchableOpacity>
            )}

            {roundUpAmount != null && (
              <TouchableOpacity
                onPress={handleRoundUp}
                className="bg-surface-secondary rounded-xl px-4 py-3">
                <Text bold size={15}>
                  Round up to {formatSats(roundUpAmount)}
                </Text>
                <Text size={13} style={{ color: foreground, opacity: 0.5 }}>
                  Send more than requested
                </Text>
              </TouchableOpacity>
            )}
          </VStack>
        ) : (
          <View className="bg-surface-secondary rounded-xl px-4 py-3">
            <Text size={14} style={{ color: danger }}>
              No sendable amounts found for your current proofs.
            </Text>
          </View>
        )}

        <TouchableOpacity onPress={handleCancel} className="items-center py-3">
          <Text size={15} style={{ color: foreground, opacity: 0.6 }}>
            Cancel
          </Text>
        </TouchableOpacity>
      </VStack>
    </View>
  );
}
