/**
 * The Cashu receive rail — a standing NUT-18 payment request. The QR encodes
 * an AMOUNTLESS reusable request (payer wallets prompt for the amount)
 * carrying the wallet's trusted mints and a Nostr transport (NIP-17); the
 * durable coco operation behind it claims incoming payloads automatically
 * via the registered nostr transport plugin. "New request" retires the
 * current request (cancels the op) and mints a fresh id — no cooldown:
 * unlike onchain rotation, this costs nothing at any mint.
 *
 * Mints never advertise NUT-18 (it's wallet-to-wallet), so availability is
 * simply "any trusted mint exists".
 */

import React, { memo, useCallback, useMemo } from 'react';

import { router } from 'expo-router';
import { ListGroup, PressableFeedback } from 'heroui-native';

import { type ReusableQuoteIdentityStore, type WalletContext } from 'wallet';
import { useStandingPaymentRequest } from 'wallet/react';
import { paymentLog } from '@/shared/lib/logger';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Section } from '@/shared/ui/composed/Section';
import { Button } from '@/shared/ui/primitives/Button';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { truncateMiddle } from '@/shared/lib/strings';
import { setStringAsync } from 'expo-clipboard';
import { copyPopup } from '@/shared/lib/popup';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import Icon from 'assets/icons';

/** Keep the QR sane — same cap as the BLE standing creq. */
const MAX_ADVERTISED_MINTS = 5;

interface ReceivePaymentRequestTabProps {
  unit: string;
  walletContext: Pick<WalletContext, 'trustedMintUrls'>;
  muted: string;
}

export const ReceivePaymentRequestTab = memo(function ReceivePaymentRequestTab({
  unit,
  walletContext,
  muted,
}: ReceivePaymentRequestTabProps) {
  const accent = useThemeColor('accent');
  const mints = useMemo(
    () => walletContext.trustedMintUrls.slice(0, MAX_ADVERTISED_MINTS),
    [walletContext.trustedMintUrls]
  );

  // Same persisted identity map as the quote rails (key `creq|<unit>`), so
  // the standing request survives restarts and external rotations propagate.
  const identityStore = useMemo<ReusableQuoteIdentityStore>(
    () => ({
      get: (key) => useMintStore.getState().standingQuotes[key],
      set: (key, id) => useMintStore.getState().setStandingQuote(key, id),
      subscribe: (key, callback) =>
        useMintStore.subscribe((state, prev) => {
          if (state.standingQuotes[key] !== prev.standingQuotes[key]) callback();
        }),
    }),
    []
  );

  const { request, isLoading, error, rotate } = useStandingPaymentRequest(
    mints.length > 0 ? { unit, mints } : null,
    identityStore
  );

  const handleNewRequest = useCallback(async () => {
    paymentLog.info('receive.creq.rotate_requested', { source: 'button' });
    await EnhancedHaptics.copyHaptic();
    await rotate();
  }, [rotate]);

  const handleCopy = useCallback(async () => {
    if (!request) return;
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(request.encodedRequest);
    copyPopup('paymentRequest');
    paymentLog.info('receive.creq.copied', { requestLength: request.encodedRequest.length });
  }, [request]);

  const renderEmptyState = (message: string, cta?: React.ReactNode) => (
    <View className="mx-4 mt-8">
      <View className="bg-surface-secondary items-center rounded-xl p-6">
        <Icon name="ph:coins" size={48} color={muted} />
        <Text size={14} className="text-muted mt-3 text-center">
          {message}
        </Text>
        {cta}
      </View>
    </View>
  );

  if (mints.length === 0) {
    return renderEmptyState(
      'Add a mint to receive Cashu payment requests.',
      <Button
        text="Find mints"
        variant="primary"
        size="compact"
        onPress={() => {
          paymentLog.info('receive.creq.discovery_opened', { unit });
          router.push('/(mint-flow)/add');
        }}
        style={{ marginTop: 16 }}
        testID="receive-creq-find-mints"
      />
    );
  }

  if (error) {
    return renderEmptyState(`Could not load the payment request: ${error}`);
  }

  if (isLoading || !request) {
    return (
      <View className="mx-4 mt-8">
        <Skeleton style={{ height: 320, borderRadius: 16 }} />
      </View>
    );
  }

  return (
    <>
      <PaymentInfo data={request.encodedRequest} copyTarget="paymentRequest" unit={unit} />
      <View className="mb-3 items-center">
        <Pressable
          onPress={() => void handleNewRequest()}
          testID="receive-creq-new-request"
          accessibilityLabel="Generate new payment request">
          <Text size={13} bold color={accent}>
            New request
          </Text>
        </Pressable>
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
                        {truncateMiddle(request.encodedRequest, 10)}
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
    </>
  );
});
