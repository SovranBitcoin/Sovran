/**
 * Amountless receive tab for coco v2 reusable mint quotes — the Bolt12 offer
 * and the standing Onchain address. One standing quote per (mint, method,
 * unit): colada's `useReusableMintQuote` reuses the open quote so the QR
 * stays stable; deposits auto-mint via coco's watcher + processor. The
 * fixed-amount flow intentionally creates FRESH quotes instead (payment
 * attribution), so this tab never shows those.
 */

import React, { memo, useCallback, useMemo } from 'react';

import { ListGroup, PressableFeedback } from 'heroui-native';

import {
  getMintMethodCapability,
  buildBip321OnchainUri,
  type ReusableQuoteIdentityStore,
  type WalletContext,
} from 'wallet';
import { useReusableMintQuote, type UseScreenActionsResult } from 'wallet/react';
import { paymentLog } from '@/shared/lib/logger';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Section } from '@/shared/ui/composed/Section';
import { HistoryEntryRefresh } from '@/features/transactions';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { truncateMiddle } from '@/shared/lib/strings';
import { setStringAsync } from 'expo-clipboard';
import { copyPopup } from '@/shared/lib/popup';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import Icon from 'assets/icons';

interface ReceiveReusableQuoteTabProps {
  method: 'bolt12' | 'onchain';
  /** Hub default; the per-method "Receiving with" selection overrides it. */
  mintUrl: string | undefined;
  unit: string;
  walletContext: Pick<WalletContext, 'trustedMintUrls' | 'mintMethodCapabilities' | 'mintBalances'>;
  actions: UseScreenActionsResult<'receive'>['actions'];
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
  actions,
  muted,
}: ReceiveReusableQuoteTabProps) {
  const copy = METHOD_COPY[method];
  // Each amountless rail keeps its own "Receiving with" mint (like the
  // Lightning tab's npub.cash mint) — falling back to the hub's mint.
  const methodMint = useMintStore((s) => s.receiveMintByMethod[method]) ?? mintUrl;
  const methodMintInfo = useMintInfo(methodMint);
  const capability = methodMint
    ? getMintMethodCapability(walletContext, methodMint, { operation: 'mint', method, unit })
    : null;
  const mintSupports = !!capability?.supported && !capability.disabled;

  // The pick runs through the payment machine's mint-select page (scope =
  // method): colada builds the capability-filtered list, the selection comes
  // back via onReceiveMethodMintChanged, and mintStore persists it.
  const changeMintAction =
    method === 'bolt12' ? actions.changeBolt12Mint : actions.changeOnchainMint;
  const openMintSelect = useCallback(async () => {
    paymentLog.info(`receive.${method}.change_mint_requested`, {
      available: changeMintAction.available,
    });
    if (!changeMintAction.available) return;
    await EnhancedHaptics.copyHaptic();
    await changeMintAction.execute();
  }, [method, changeMintAction]);

  // Persisted identity map pins the standing quote — fixed-amount requests
  // (which create their own fresh reusable quotes) can never displace it.
  const identityStore = useMemo<ReusableQuoteIdentityStore>(
    () => ({
      get: (key) => useMintStore.getState().standingQuotes[key],
      set: (key, quoteId) => useMintStore.getState().setStandingQuote(key, quoteId),
    }),
    []
  );
  const { quote, isLoading, error } = useReusableMintQuote(
    methodMint && mintSupports ? { mintUrl: methodMint, method, unit } : null,
    identityStore
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

  const renderEmptyState = (message: string) => (
    <View className="mx-4 mt-8">
      <View className="bg-surface-secondary items-center rounded-xl p-6">
        <Icon name={copy.icon} size={48} color={muted} />
        <Text size={14} className="text-muted mt-3 text-center">
          {message}
        </Text>
      </View>
    </View>
  );

  if (!mintSupports) {
    return (
      <Pressable onPress={() => void openMintSelect()} testID={`receive-${method}-pick-mint`}>
        {renderEmptyState(`${copy.unsupported} Tap to choose a mint.`)}
      </Pressable>
    );
  }

  if (error) {
    return renderEmptyState(
      `Could not load the standing ${method === 'bolt12' ? 'offer' : 'address'}: ${error}`
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
      <HistoryEntryRefresh
        mintInfo={methodMintInfo}
        historyEntry={{ type: 'receive', mintUrl: methodMint }}
        onPress={changeMintAction.available ? openMintSelect : undefined}
      />
    </>
  );
});
