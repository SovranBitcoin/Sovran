/**
 * Amountless receive tab for coco v2 reusable mint quotes — the Bolt12 offer
 * and the standing Onchain address. One standing quote per (mint, method,
 * unit): colada's `useReusableMintQuote` reuses the open quote so the QR
 * stays stable; deposits auto-mint via coco's watcher + processor. The
 * fixed-amount flow intentionally creates FRESH quotes instead (payment
 * attribution), so this tab never shows those.
 */

import React, { memo, useCallback } from 'react';

import { ListGroup, PressableFeedback } from 'heroui-native';

import { getMintMethodCapability, buildBip321OnchainUri, type WalletContext } from 'wallet';
import { useReusableMintQuote } from 'wallet/react';
import { paymentLog } from '@/shared/lib/logger';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Section } from '@/shared/ui/composed/Section';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { truncateMiddle } from '@/shared/lib/strings';
import { setStringAsync } from 'expo-clipboard';
import { copyPopup } from '@/shared/lib/popup';
import Icon from 'assets/icons';

interface ReceiveReusableQuoteTabProps {
  method: 'bolt12' | 'onchain';
  mintUrl: string | undefined;
  unit: string;
  walletContext: Pick<WalletContext, 'trustedMintUrls' | 'mintMethodCapabilities'>;
  muted: string;
}

const METHOD_COPY = {
  bolt12: {
    sectionTitle: 'BOLT12 OFFER',
    icon: 'mingcute:lightning-line', // outline bolt = reusable offer
    copyTarget: 'bolt12Offer' as const,
    unsupported: 'This mint does not offer Bolt12. Select a mint that advertises Bolt12 minting.',
  },
  onchain: {
    sectionTitle: 'ONCHAIN ADDRESS',
    icon: 'hugeicons:blockchain-01',
    copyTarget: 'address' as const,
    unsupported:
      'This mint does not offer onchain deposits. Select a mint that advertises onchain minting.',
  },
} as const;

export const ReceiveReusableQuoteTab = memo(function ReceiveReusableQuoteTab({
  method,
  mintUrl,
  unit,
  walletContext,
  muted,
}: ReceiveReusableQuoteTabProps) {
  const copy = METHOD_COPY[method];
  const capability = mintUrl
    ? getMintMethodCapability(walletContext, mintUrl, { operation: 'mint', method, unit })
    : null;
  const mintSupports = !!capability?.supported && !capability.disabled;

  const { quote, isLoading, error } = useReusableMintQuote(
    mintUrl && mintSupports ? { mintUrl, method, unit } : null
  );

  const request = quote?.request ?? null;
  // The amountless tab shows the BARE standing address; BIP-321 URIs with
  // amounts belong to the fixed-amount flow (fresh address per request).
  const qrData = request && method === 'onchain' ? buildBip321OnchainUri(request) : request;

  const handleCopy = useCallback(async () => {
    if (!request) return;
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(request);
    copyPopup(copy.copyTarget);
    paymentLog.info(`receive.${method}.copied`, { requestLength: request.length });
  }, [request, method, copy.copyTarget]);

  if (!mintSupports) {
    return (
      <View className="mx-4 mt-8">
        <View className="bg-surface-secondary items-center rounded-xl p-6">
          <Icon name={copy.icon} size={48} color={muted} />
          <Text size={14} className="text-muted mt-3 text-center">
            {copy.unsupported}
          </Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="mx-4 mt-8">
        <View className="bg-surface-secondary items-center rounded-xl p-6">
          <Icon name={copy.icon} size={48} color={muted} />
          <Text size={14} className="text-muted mt-3 text-center">
            Could not load the standing {method === 'bolt12' ? 'offer' : 'address'}: {error}
          </Text>
        </View>
      </View>
    );
  }

  if (isLoading || !request || !qrData) {
    return (
      <View className="mx-4 mt-8">
        <Skeleton style={{ height: 320, borderRadius: 16 }} />
      </View>
    );
  }

  return (
    <>
      <PaymentInfo data={qrData} copyTarget={copy.copyTarget} unit={unit} />
      <View className="mx-4">
        <Section title={copy.sectionTitle}>
          <GradientCard>
            <ListGroup variant="transparent">
              <PressableFeedback animation={false} onPress={handleCopy}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Icon name={copy.icon} size={20} color={muted} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{truncateMiddle(request, 10)}</ListGroup.ItemTitle>
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
