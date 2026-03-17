import React, { useCallback, useEffect } from 'react';
import opacity from 'hex-color-opacity';
import { Alert, ListGroup, PressableFeedback } from 'heroui-native';

import Icon from 'assets/icons';
import { useExecutionState } from 'coco-payment-ux/react';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import type { CustomSheetSharedProps } from '../types';
import { SheetHeader } from '../SheetHeader';

interface ProofSelectorContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['proof-selector'];
}

type Option = { direction: 'down' | 'up'; amount: number; label: string };

export function ProofSelectorContent({
  payload,
  close,
  setFooterConfig,
}: ProofSelectorContentProps) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);

  const { suggestions, unit, machine } = payload;
  const { isExecuting } = useExecutionState(machine);

  const options: Option[] = [];
  if (suggestions?.roundUp != null) {
    options.push({
      direction: 'up',
      amount: suggestions.roundUp.amount,
      label: 'Round up',
    });
  }
  if (suggestions?.roundDown != null) {
    options.push({
      direction: 'down',
      amount: suggestions.roundDown.amount,
      label: 'Round down',
    });
  }

  const handleSelect = useCallback(
    (opt: Option) => {
      void machine.chooseProofs(opt.amount);
      close();
    },
    [close, machine]
  );

  useEffect(() => {
    setFooterConfig({
      buttons: [
        {
          label: 'Change Mint',
          variant: 'tertiary',
          onPress: () => {
            close();
            void machine.requestMintSelector();
          },
        },
      ],
    });
    return () => setFooterConfig(null);
  }, [machine, close, setFooterConfig]);

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
                        unit={unit}
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
