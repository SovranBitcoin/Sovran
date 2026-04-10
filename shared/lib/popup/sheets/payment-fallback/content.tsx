import React, { useCallback, useEffect, useRef } from 'react';
import opacity from 'hex-color-opacity';
import { Alert, ListGroup, PressableFeedback } from 'heroui-native';

import Icon from 'assets/icons';
import { defaultDetectors, type AnnotatedOption, type PaymentOptionKind } from 'coco-payment-ux';
import { useExecutionState } from 'coco-payment-ux/react';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { getEcashTokenAmount } from '@/shared/lib/cashu/utils';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import type { CustomSheetSharedProps } from '../types';
import { SheetHeader } from '../SheetHeader';

interface PaymentFallbackContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['payment-fallback'];
}

const CASHU_KINDS: PaymentOptionKind[] = ['paymentRequest', 'ecashToken'];
const LIGHTNING_KINDS: PaymentOptionKind[] = ['lightningInvoice', 'lightningAddress', 'lnurlp'];

function getMethodLabel(kind: PaymentOptionKind): string {
  if (CASHU_KINDS.includes(kind)) return 'Cashu';
  if (LIGHTNING_KINDS.includes(kind)) return 'Lightning';
  return kind;
}

function getMethodIcon(kind: PaymentOptionKind): string {
  if (CASHU_KINDS.includes(kind)) return 'majesticons:coins';
  if (LIGHTNING_KINDS.includes(kind)) return 'mdi:lightning-bolt';
  return 'mdi:gesture-tap-button';
}

function getOptionAmount(option: {
  kind: PaymentOptionKind;
  value: string;
  amount?: number | null;
}): number | undefined {
  if (option.amount != null && option.amount > 0) return option.amount;
  if (option.kind === 'paymentRequest') {
    return defaultDetectors.getPaymentRequestInfo(option.value)?.amount ?? undefined;
  }
  if (option.kind === 'ecashToken') return getEcashTokenAmount(option.value);
  return undefined;
}

export function PaymentFallbackContent({ payload, close }: PaymentFallbackContentProps) {
  const [foreground, muted, danger] = useThemeColor(['foreground', 'muted', 'danger'] as const);

  const {
    options,
    machine,
    unit: payloadUnit,
    onDismiss,
    lastFailedMessage,
    failedOptionValues,
  } = payload;
  const { isExecuting } = useExecutionState(machine);
  const selectedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!selectedRef.current) {
        onDismiss?.();
      }
    };
  }, [onDismiss]);

  const handleSelect = useCallback(
    (annotated: AnnotatedOption) => {
      if (annotated.status === 'disabled') return;
      selectedRef.current = true;
      void machine.chooseOption(annotated.option);
      close();
    },
    [close, machine]
  );

  const unit = payloadUnit ?? 'sat';
  const failedCount = failedOptionValues?.length ?? 0;

  return (
    <View>
      <SheetHeader title="Payment failed" centered />
      <View className="px-0 pt-4">
        <Alert status="warning" className="bg-surface-secondary mb-4">
          <Alert.Content>
            <Alert.Title>
              {failedCount === 1
                ? 'A payment method failed'
                : `${failedCount} payment methods failed`}
            </Alert.Title>
            <Alert.Description>
              {lastFailedMessage ?? 'The payment could not be completed.'}
              {'\n'}Choose another method to try.
            </Alert.Description>
          </Alert.Content>
        </Alert>
        <ListGroup variant="secondary">
          {options.map((annotated, index) => {
            const isFailed = failedOptionValues?.includes(annotated.option.value);
            const isDisabled = annotated.status === 'disabled' || isExecuting;
            const label = getMethodLabel(annotated.option.kind);
            const subtitle = isFailed
              ? 'Failed'
              : annotated.status === 'recommended'
                ? 'Recommended'
                : undefined;
            const amount = getOptionAmount(annotated.option);
            const hasAmount = amount != null && amount > 0;

            return (
              <PressableFeedback
                key={index}
                animation={false}
                onPress={() => handleSelect(annotated)}
                isDisabled={isDisabled}>
                <PressableFeedback.Scale>
                  <ListGroup.Item
                    disabled={isDisabled}
                    style={isDisabled ? { opacity: 0.5 } : undefined}>
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
                        <Text
                          size={12}
                          className="mt-0.5"
                          style={{ color: isFailed ? danger : muted }}>
                          {subtitle}
                        </Text>
                      )}
                      {!isFailed && annotated.status === 'disabled' && annotated.reason && (
                        <Text size={12} className="text-muted mt-0.5">
                          {annotated.reason.message}
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
