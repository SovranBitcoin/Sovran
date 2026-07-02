/**
 * Display screen for a freshly created SINGLE-USE incoming NUT-18 payment
 * request (receive → Fixed Amount → "as Ecash"). The durable coco operation
 * claims the payload automatically via the registered nostr transport — this
 * screen only renders the encoded request and flips to a received state when
 * the claim finalizes (receive-op:finalized correlated by the request
 * operation id). The global payment-status listener owns the toast.
 */

import React, { memo, useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

import { router } from 'expo-router';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { setStringAsync } from 'expo-clipboard';

import { useColadaManager } from 'wallet/react';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { ScreenErrorState } from '@/shared/ui/composed/ScreenStates';
import { Section } from '@/shared/ui/composed/Section';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { copyPopup } from '@/shared/lib/popup';
import { truncateMiddle } from '@/shared/lib/strings';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import Icon from 'assets/icons';

const EntrySchema = z.object({
  operationId: z.string().min(1).max(128),
  encodedRequest: z.string().min(4).max(8192),
  amount: z.number().positive(),
  unit: z.string().min(1).max(16),
  mints: z.array(z.string().max(2048)).max(16),
});

const ParamsSchema = z.object({
  paymentRequestEntry: z.string().min(2),
});

export const ReceivePaymentRequestQuoteScreen = memo(function ReceivePaymentRequestQuoteScreen() {
  useLifecycleLogger('ReceivePaymentRequestQuoteScreen');
  const [muted, success] = useThemeColor(['muted', 'success'] as const);
  const manager = useColadaManager();
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.paymentRequest' });

  const entry = React.useMemo(() => {
    if (!params) return null;
    try {
      return EntrySchema.parse(JSON.parse(params.paymentRequestEntry));
    } catch {
      return null;
    }
  }, [params]);

  const [received, setReceived] = useState(false);

  useEffect(() => {
    if (!entry) return;
    const off = manager.on('receive-op:finalized', ({ operation }) => {
      const source = (operation as { source?: { type?: string; requestOperationId?: string } })
        .source;
      if (source?.type !== 'payment-request') return;
      if (source.requestOperationId !== entry.operationId) return;
      paymentLog.info('receive.creq.fixed_amount.claimed', {
        operationId: entry.operationId,
        amount: entry.amount,
        unit: entry.unit,
      });
      setReceived(true);
    });
    return () => {
      off();
    };
  }, [manager, entry]);

  const handleCopy = useCallback(async () => {
    if (!entry) return;
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(entry.encodedRequest);
    copyPopup('paymentRequest');
  }, [entry]);

  if (!entry) {
    return <ScreenErrorState message="Invalid payment request" onGoBack={() => router.back()} />;
  }

  return (
    <ScreenWrapper name="ReceivePaymentRequestQuoteScreen" contentPadding={0} deferContent={false}>
      <PaymentInfo data={entry.encodedRequest} copyTarget="paymentRequest" unit={entry.unit} />
      <View className="mb-3 items-center">
        {received ? (
          <View className="flex-row items-center">
            <Icon name="mdi:check" size={18} color={success} />
            <Text size={14} bold color={success} style={{ marginLeft: 6 }}>
              Payment received
            </Text>
          </View>
        ) : (
          <Text size={13} className="text-muted">
            {`Requesting ${entry.amount} ${entry.unit} · waiting for payment…`}
          </Text>
        )}
      </View>
      <View className="mx-4">
        <Section title="CASHU PAYMENT REQUEST">
          <GradientCard>
            <ListGroup variant="transparent">
              <PressableFeedback animation={false} onPress={handleCopy}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Icon name="ph:coins" size={20} color={muted} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>
                        {truncateMiddle(entry.encodedRequest, 10)}
                      </ListGroup.ItemTitle>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <Icon name="lets-icons:copy" size={20} color={muted} />
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                </PressableFeedback.Scale>
                <PressableFeedback.Ripple />
              </PressableFeedback>
            </ListGroup>
          </GradientCard>
        </Section>
      </View>
    </ScreenWrapper>
  );
});
