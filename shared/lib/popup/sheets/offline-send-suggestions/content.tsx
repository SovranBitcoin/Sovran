import React, { useCallback } from 'react';
import opacity from 'hex-color-opacity';
import { Alert, ListGroup, PressableFeedback } from 'heroui-native';

import Icon from 'assets/icons';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import type { CustomSheetSharedProps } from '../types';
import { SheetHeader } from '../SheetHeader';
import { useExecutionState } from '@/coco-payment-ux/src/react';
import { usePaymentFlowMachine } from '@/features/send/providers/PaymentFlowProvider';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

interface OfflineSendSuggestionsContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['offline-send-suggestions'];
}

type Option = { direction: 'down' | 'up'; amount: number; label: string };

export function OfflineSendSuggestionsContent({
  payload,
  close,
}: OfflineSendSuggestionsContentProps) {
  const machine = usePaymentFlowMachine({
    walletContext: useWalletContext(),
    unit: payload.unit,
  });
  const { isExecuting } = useExecutionState(machine);
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);

  const options: Option[] = [];
  if (payload.roundUp != null) {
    options.push({
      direction: 'up',
      amount: payload.roundUp.amount,
      label: payload.roundUp.label ?? `Round up`,
    });
  }
  if (payload.roundDown != null) {
    options.push({
      direction: 'down',
      amount: payload.roundDown.amount,
      label: payload.roundDown.label ?? `Round down`,
    });
  }

  const handleSelect = useCallback(
    async (opt: Option) => {
      try {
        await payload.onSelectAmount(opt.amount);
      } finally {
        close();
      }
    },
    [close, payload]
  );

  return (
    <View>
      <SheetHeader title="Choose amount" centered />
      <View className="px-0 pt-4">
        <Alert status="warning" className="bg-surface-secondary mb-4">
          <Alert.Content>
            <Alert.Title>Rounding required</Alert.Title>
            <Alert.Description>
              This amount can&apos;t be sent exactly. Choose a nearby amount.
            </Alert.Description>
          </Alert.Content>
        </Alert>
        <ListGroup variant="secondary">
          {options.map((opt) => {
            return (
              <PressableFeedback
                key={opt.direction}
                animation={false}
                onPress={() => void handleSelect(opt)}
                isDisabled={isExecuting}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled={isExecuting}>
                    <ListGroup.ItemPrefix>
                      <View
                        className="rounded-full p-2"
                        style={{ backgroundColor: opacity(muted, 0.25) }}>
                        <Icon
                          color={isExecuting ? muted : foreground}
                          name={
                            opt.direction === 'down'
                              ? 'fluent:arrow-download-16-filled'
                              : 'fluent:arrow-upload-16-filled'
                          }
                          size={24}
                        />
                      </View>
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{opt.label}</ListGroup.ItemTitle>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <AmountFormatter
                        amount={opt.amount}
                        unit={payload.unit}
                        size={16}
                        weight="medium"
                      />
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                </PressableFeedback.Scale>
                <PressableFeedback.Ripple />
              </PressableFeedback>
            );
          })}
        </ListGroup>
      </View>
    </View>
  );
}
