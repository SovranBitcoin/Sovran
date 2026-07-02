/**
 * BIP-321 unified receive rail: ONE bitcoin: URI composing the standing
 * rails — onchain address (URI body), BOLT 12 offer (`lno`), and the cashu
 * payment request (`creq`, NUT-26's consensus key, bech32m). Payer wallets
 * use the best method they support and fall back across keys. There is NO
 * key for lightning ADDRESSES (npub@npub.cash) — human-readable names are
 * BIP-353 (DNS) and resolve TO a BIP-321 URI — so the Lightning rail is
 * deliberately absent here.
 *
 * The parts resolve asynchronously, so the QR re-renders as each rail lands
 * — which is exactly why this tab is NOT the receive hub's default.
 */

import React, { memo, useCallback, useMemo } from 'react';

import { ListGroup, PressableFeedback } from 'heroui-native';
import { setStringAsync } from 'expo-clipboard';

import {
  buildUnifiedBip321Uri,
  getMintMethodCapability,
  type ReusableQuoteIdentityStore,
  type WalletContext,
} from 'wallet';
import { useReusableMintQuote, useStandingPaymentRequest } from 'wallet/react';
import { paymentLog } from '@/shared/lib/logger';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Section } from '@/shared/ui/composed/Section';
import { useReceiveMethodMint } from '@/features/receive/hooks/useReceiveMethodMint';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { truncateMiddle } from '@/shared/lib/strings';
import { copyPopup } from '@/shared/lib/popup';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import Icon from 'assets/icons';

const MAX_ADVERTISED_MINTS = 5;

interface ReceiveUnifiedTabProps {
  unit: string;
  walletContext: Pick<WalletContext, 'trustedMintUrls' | 'mintMethodCapabilities' | 'mintBalances'>;
  muted: string;
}

export const ReceiveUnifiedTab = memo(function ReceiveUnifiedTab({
  unit,
  walletContext,
  muted,
}: ReceiveUnifiedTabProps) {
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

  // Same standing singletons as the dedicated tabs (in-flight dedup + shared
  // identity store means no extra quotes/requests are ever created here).
  const { mintUrl: onchainMint } = useReceiveMethodMint('onchain', unit);
  const onchainSupported =
    !!onchainMint &&
    (() => {
      const cap = getMintMethodCapability(walletContext, onchainMint, {
        operation: 'mint',
        method: 'onchain',
        unit,
      });
      return cap.supported && !cap.disabled;
    })();
  const onchain = useReusableMintQuote(
    onchainSupported && onchainMint ? { mintUrl: onchainMint, method: 'onchain', unit } : null,
    identityStore
  );

  const { mintUrl: bolt12Mint } = useReceiveMethodMint('bolt12', unit);
  const bolt12Supported =
    !!bolt12Mint &&
    (() => {
      const cap = getMintMethodCapability(walletContext, bolt12Mint, {
        operation: 'mint',
        method: 'bolt12',
        unit,
      });
      return cap.supported && !cap.disabled;
    })();
  const bolt12 = useReusableMintQuote(
    bolt12Supported && bolt12Mint ? { mintUrl: bolt12Mint, method: 'bolt12', unit } : null,
    identityStore
  );

  const creqMints = useMemo(
    () => walletContext.trustedMintUrls.slice(0, MAX_ADVERTISED_MINTS),
    [walletContext.trustedMintUrls]
  );
  const creq = useStandingPaymentRequest(
    creqMints.length > 0 ? { unit, mints: creqMints } : null,
    identityStore
  );

  const uri = useMemo(
    () =>
      buildUnifiedBip321Uri({
        address: onchain.quote?.request ?? null,
        lno: bolt12.quote?.request ?? null,
        creq: creq.request?.encodedRequestB ?? null,
      }),
    [onchain.quote, bolt12.quote, creq.request]
  );

  const included = [
    ...(onchain.quote ? ['Onchain'] : []),
    ...(bolt12.quote ? ['BOLT 12'] : []),
    ...(creq.request ? ['Cashu'] : []),
  ];

  const anyLoading = onchain.isLoading || bolt12.isLoading || creq.isLoading;

  const handleCopy = useCallback(async () => {
    if (!uri) return;
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(uri);
    copyPopup('bip321');
    paymentLog.info('receive.bip321.copied', {
      uriLength: uri.length,
      included: included.join(','),
    });
  }, [uri, included]);

  if (!uri && anyLoading) {
    return (
      <View className="mx-4 mt-8">
        <Skeleton style={{ height: 320, borderRadius: 16 }} />
      </View>
    );
  }

  if (!uri) {
    return (
      <View className="mx-4 mt-8">
        <View className="bg-surface-secondary items-center rounded-xl p-6">
          <Icon name="stash:qr-code" size={48} color={muted} />
          <Text size={14} className="text-muted mt-3 text-center">
            No rails available for a unified URI — add a mint that supports onchain, BOLT 12, or
            Cashu payment requests.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <PaymentInfo data={uri} copyTarget="bip321" unit={unit} />
      <View className="mx-4">
        <Section title="BIP-321 URI">
          <GradientCard>
            <ListGroup variant="transparent">
              <PressableFeedback animation={false} onPress={handleCopy}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Icon name="stash:qr-code" size={20} color={muted} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{truncateMiddle(uri, 10)}</ListGroup.ItemTitle>
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
