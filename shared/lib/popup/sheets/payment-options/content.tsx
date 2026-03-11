import React, { useCallback, useEffect, useRef, useState } from 'react';
import { decodePaymentRequest } from '@cashu/cashu-ts';
import opacity from 'hex-color-opacity';
import { Alert, ListGroup, PressableFeedback } from 'heroui-native';

import Icon from 'assets/icons';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { AnnotatedOption } from '@/shared/lib/cashu/paymentIntent';
import type {
  SupportedPaymentKind,
  SupportedPaymentOption,
} from '@/shared/lib/cashu/paymentInputParser';
import { getEcashTokenAmount } from '@/shared/lib/cashu/utils';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import type { CustomSheetSharedProps } from '../types';
import { SheetHeader } from '../SheetHeader';

interface PaymentOptionsContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['payment-options'];
}

const CASHU_KINDS: SupportedPaymentKind[] = ['cashuPaymentRequest', 'ecashToken'];
const LIGHTNING_KINDS: SupportedPaymentKind[] = ['lightningInvoice', 'lightningAddress', 'lnurlp'];

function getMethodLabel(kind: SupportedPaymentKind): string {
  if (CASHU_KINDS.includes(kind)) return 'Cashu';
  if (LIGHTNING_KINDS.includes(kind)) return 'Lightning';
  return kind;
}

function getMethodIcon(kind: SupportedPaymentKind): string {
  if (CASHU_KINDS.includes(kind)) return 'majesticons:coins';
  if (LIGHTNING_KINDS.includes(kind)) return 'mdi:lightning-bolt';
  return 'mdi:gesture-tap-button';
}

function getOptionAmount(option: SupportedPaymentOption): number | undefined {
  if (option.amount != null && option.amount > 0) return option.amount;
  if (option.kind === 'cashuPaymentRequest') {
    try {
      return decodePaymentRequest(option.value.trim()).amount;
    } catch {
      return undefined;
    }
  }
  if (option.kind === 'ecashToken') return getEcashTokenAmount(option.value);
  return undefined;
}

export function PaymentOptionsContent({ payload, close }: PaymentOptionsContentProps) {
  const [inflightIndex, setInflightIndex] = useState<number | null>(null);
  const selectedRef = useRef(false);
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);

  // If the sheet is closed without selecting, reset the scanner.
  useEffect(() => {
    return () => {
      if (!selectedRef.current) {
        payload.onDismiss?.();
      }
    };
  }, [payload]);

  const handleSelect = useCallback(
    (annotated: AnnotatedOption, index: number) => {
      if (annotated.status === 'disabled') return;
      selectedRef.current = true;
      setInflightIndex(index);
      payload.onSelectOption(annotated.option);
      close();
    },
    [close, payload]
  );

  const hasMultipleKinds = new Set(payload.options.map((o) => o.option.kind)).size > 1;
  const isProcessing = inflightIndex !== null;
  const unit = payload.unit ?? 'sat';

  return (
    <View>
      <SheetHeader title="Choose how to pay" centered />
      <View className="px-0 pt-4">
        {hasMultipleKinds && (
          <Alert status="default" className="bg-surface-secondary mb-4">
            <Alert.Content>
              <Alert.Title>Multiple payment options</Alert.Title>
              <Alert.Description>
                This payment supports more than one method. Choose the one that works best for you.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}
        <ListGroup variant="secondary">
          {payload.options.map((annotated, index) => {
            const isDisabled = annotated.status === 'disabled' || isProcessing;
            const label = getMethodLabel(annotated.option.kind);
            const subtitle = annotated.status === 'recommended' ? 'Recommended' : undefined;
            const amount = getOptionAmount(annotated.option);
            const hasAmount = amount != null && amount > 0;

            return (
              <PressableFeedback
                key={index}
                animation={false}
                onPress={() => handleSelect(annotated, index)}
                isDisabled={isDisabled}>
                <PressableFeedback.Scale>
                  <ListGroup.Item
                    disabled={isDisabled}
                    style={annotated.status === 'disabled' ? { opacity: 0.5 } : undefined}>
                    <ListGroup.ItemPrefix>
                      <View
                        className="rounded-full p-2"
                        style={{ backgroundColor: opacity(muted, 0.25) }}>
                        <Icon
                          color={isDisabled ? muted : foreground}
                          name={getMethodIcon(annotated.option.kind)}
                          size={24}
                        />
                      </View>
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{label}</ListGroup.ItemTitle>
                      {subtitle && (
                        <Text size={12} className="text-muted mt-0.5">
                          {subtitle}
                        </Text>
                      )}
                      {annotated.status === 'disabled' && annotated.reason && (
                        <Text size={12} className="text-muted mt-0.5">
                          {annotated.reason}
                        </Text>
                      )}
                    </ListGroup.ItemContent>
                    {hasAmount && amount != null && (
                      <ListGroup.ItemSuffix>
                        <AmountFormatter amount={amount} unit={unit} size={16} weight="medium" />
                      </ListGroup.ItemSuffix>
                    )}
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
