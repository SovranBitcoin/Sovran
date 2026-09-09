/**
 * Amountless receive tab for coco v2 reusable mint quotes — the Bolt12 offer
 * and the standing Onchain address. One standing quote per (mint, method,
 * unit): colada's `useReusableMintQuote` reuses the open quote so the QR
 * stays stable; deposits auto-mint via coco's watcher + processor. The
 * fixed-amount flow intentionally creates FRESH quotes instead (payment
 * attribution), so this tab never shows those.
 */

import React, { memo, useCallback, useRef, useState } from 'react';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import { getMintMethodCapability, buildBip321OnchainUri, type WalletContext } from 'wallet';
import { useReusableMintQuote, type UseScreenActionsResult } from 'wallet/react';
import { paymentLog } from '@/shared/lib/logger';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { CopyRequestCard } from '@/shared/ui/composed/CopyRequestCard';
import { ReceiveRailPlaceholder } from '@/features/receive/components/ReceiveRailPlaceholder';
import { HistoryEntryRefresh } from '@/features/transactions';
import { ActionSegmentsCard } from '@/shared/ui/composed/ActionSegmentsCard';
import { useReceiveMethodMint } from '@/features/receive/hooks/useReceiveMethodMint';
import { isExpiryElapsed } from '@/features/receive/lib/receiveRailItems';
import type { OnReceiveQrPayload } from '@/features/receive/lib/qrPayload';
import { standingQuoteIdentityStore } from '@/features/receive/lib/standingQuoteIdentityStore';
import { Button } from '@/shared/ui/primitives/Button';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { truncateMiddle } from '@/shared/lib/strings';
import { setStringAsync } from 'expo-clipboard';
import { copyPopup, staticPopup } from '@/shared/lib/popup';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useMempoolAddressSummary } from '@/shared/hooks/useMempoolAddressSummary';
import Icon from 'assets/icons';

/** Manual "new address" throttle — long enough to stop QR-spamming the
 *  mint, short enough to never feel like a lockout. */
const ROTATE_COOLDOWN_MS = 5000;

interface ReceiveReusableQuoteTabProps {
  method: 'bolt12' | 'onchain';
  unit: string;
  active?: boolean;
  walletContext: Pick<WalletContext, 'trustedMintUrls' | 'mintMethodCapabilities' | 'mintBalances'>;
  actions: UseScreenActionsResult<'receive'>['actions'];
  muted: string;
  /** Reports the rail's copyable payload (bare offer/address) upward for the
   *  QR display's footer Copy button. */
  onQrPayload?: OnReceiveQrPayload;
}

const METHOD_COPY = {
  bolt12: {
    sectionTitle: 'BOLT 12 OFFER',
    icon: 'mingcute:lightning-fill', // same bolt as the Lightning tab's copy row
    copyTarget: 'bolt12Offer' as const,
    unsupported: 'This mint does not offer BOLT 12. Select a mint that advertises BOLT 12 minting.',
    noneSupport: 'None of your mints support BOLT 12 offers.',
  },
  onchain: {
    sectionTitle: 'ONCHAIN ADDRESS',
    icon: 'hugeicons:blockchain-01',
    copyTarget: 'address' as const,
    unsupported:
      'This mint does not offer onchain deposits. Select a mint that advertises onchain minting.',
    noneSupport: 'None of your mints support onchain deposits.',
  },
} as const;

export const ReceiveReusableQuoteTab = memo(function ReceiveReusableQuoteTab({
  method,
  unit,
  active = true,
  walletContext,
  actions,
  muted,
  onQrPayload,
}: ReceiveReusableQuoteTabProps) {
  const copy = METHOD_COPY[method];
  // Each amountless rail keeps its own "Receiving with" mint — one of the
  // four independent selections (preferred / npub.cash / bolt12 / onchain).
  // Explicit picks persist; otherwise colada auto-derives the first trusted
  // mint supporting the method. Never the hub/NPC mint.
  const { mintUrl: methodMint, anyMintSupports } = useReceiveMethodMint(method, unit);
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
  // `subscribe` lets the hook pick up EXTERNAL rotations (the global
  // deposit-received listener retiring a paid onchain address).
  const { quote, error, rotate } = useReusableMintQuote(
    methodMint && mintSupports ? { mintUrl: methodMint, method, unit } : null,
    standingQuoteIdentityStore
  );

  const request = quote?.request ?? null;
  // The amountless tab shows the BARE standing address; BIP-321 URIs with
  // amounts belong to the fixed-amount flow (fresh address per request).
  const qrData = request && method === 'onchain' ? buildBip321OnchainUri(request) : request;

  // Match coco's OWN watch gate (`isExpiryElapsed`, incl. `expiry: 0`): a quote
  // coco treats as expired is not being watched, so deposits to it won't be
  // received. Don't show that QR — offer a fresh one instead. bolt12 offers
  // arrive with `expiry: 0`, so this surfaces coco's not-watched state rather
  // than presenting an address that silently won't collect.
  const quoteExpired = !!quote && isExpiryElapsed(quote.expiry, Math.floor(Date.now() / 1000));

  // Footer Copy copies the same bare value the in-card copy row does — but never
  // an expired quote (coco isn't listening to it).
  React.useEffect(() => {
    onQrPayload?.(
      request && !quoteExpired ? { value: request, copyTarget: copy.copyTarget } : null
    );
  }, [request, quoteExpired, copy.copyTarget, onQrPayload]);

  // Manual address rotation (onchain only) with a short cooldown so the
  // button can't be spammed into a pile of orphan quotes at the mint.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownActive = cooldownUntil > Date.now();
  React.useEffect(
    () => () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    },
    []
  );

  const handleGenerateAddress = useCallback(async () => {
    if (cooldownUntil > Date.now()) {
      paymentLog.info('receive.onchain.rotate_cooldown_blocked', {
        remainingMs: cooldownUntil - Date.now(),
      });
      staticPopup('onchain-address-cooldown');
      return;
    }
    setCooldownUntil(Date.now() + ROTATE_COOLDOWN_MS);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    // Re-render when the window closes so the label un-greys.
    cooldownTimerRef.current = setTimeout(() => setCooldownUntil(0), ROTATE_COOLDOWN_MS);
    paymentLog.info('receive.onchain.rotate_requested', { source: 'button' });
    await EnhancedHaptics.copyHaptic();
    await rotate();
  }, [cooldownUntil, rotate]);

  // "Generate new" for an expired standing quote — works for both rails (unlike
  // the onchain-only "New address" segment). Same cooldown so a rapid tap can't
  // pile up orphan quotes at the mint; the button is also disabled while cooling
  // down, so a silent early-return is enough here.
  const handleGenerateNew = useCallback(async () => {
    if (cooldownUntil > Date.now()) return;
    setCooldownUntil(Date.now() + ROTATE_COOLDOWN_MS);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => setCooldownUntil(0), ROTATE_COOLDOWN_MS);
    paymentLog.info(`receive.${method}.generate_new_requested`, { source: 'expired_quote' });
    await EnhancedHaptics.copyHaptic();
    await rotate('manual');
  }, [cooldownUntil, method, rotate]);

  // Eager onchain address rotation. The standing address is single-use: the
  // moment mempool.space sees ANY payment to it (0-conf included — we do NOT
  // wait for the deposit to confirm or the mint to credit) we retire it and
  // mint a fresh address for the next payer. Mirrors the P2PK rotate-on-receive
  // policy, keeps one transaction per address (so its deposit txid is
  // unambiguous), and the old quote stays pending in coco so the in-flight
  // deposit still auto-mints. Bolt12 offers never watch/rotate.
  const onchainStandingAddress = method === 'onchain' ? request : null;
  const standingMempool = useMempoolAddressSummary(onchainStandingAddress);
  const depositObserved =
    !!standingMempool.summary && standingMempool.summary.totalReceivedSats > 0;
  const rotatedForAddressRef = useRef<string | null>(null);
  React.useEffect(() => {
    if (!onchainStandingAddress || !depositObserved) return;
    // One rotation per observed address — the poll keeps reporting the payment
    // until `request` swaps to the fresh (unpaid) address.
    if (rotatedForAddressRef.current === onchainStandingAddress) return;
    rotatedForAddressRef.current = onchainStandingAddress;
    paymentLog.info('receive.onchain.rotate_requested', {
      source: 'deposit_detected',
      addressLength: onchainStandingAddress.length,
    });
    void rotate('deposit_received');
  }, [onchainStandingAddress, depositObserved, rotate]);

  // "View all": push the rail's list into this same (receive-flow) stack so a
  // paid onchain address can open its deposit transaction to the side. The list
  // screen classifies each row (reusable / paid / expired), marks the pinned
  // standing one, and blocks copying a paid address for privacy.
  const openList = useCallback(() => {
    paymentLog.info(`receive.${method}.list_opened`, { method });
    router.navigate({ pathname: '/railList', params: { rail: method, unit } });
  }, [method, unit]);

  const handleCopy = useCallback(async () => {
    if (!request) return;
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(request);
    copyPopup(copy.copyTarget);
    paymentLog.info(`receive.${method}.copied`, { requestLength: request.length });
  }, [request, method, copy.copyTarget]);

  const openMintDiscovery = useCallback(() => {
    paymentLog.info(`receive.${method}.discovery_opened`, { unit });
    // Thread the rail's unit so discovery filters to the (method, unit) pair
    // (e.g. bolt12+sat), not just the method — see MintAddScreen / useMintSearch.
    router.push({ pathname: '/(mint-flow)/add', params: { method, unit } });
  }, [method, unit]);

  const renderEmptyState = (message: string, cta?: React.ReactNode) => (
    <View className="mx-4 mt-8">
      <View className="bg-surface-secondary items-center rounded-xl p-6">
        <Icon name={copy.icon} size={48} color={muted} />
        <Text size={14} className="text-muted mt-3 text-center">
          {message}
        </Text>
        {cta}
      </View>
    </View>
  );

  if (!active) return null;

  // No trusted mint can serve this rail at all — point at discovery,
  // pre-filtered to mints advertising the method.
  if (!anyMintSupports) {
    return renderEmptyState(
      copy.noneSupport,
      <Button
        text="Find mints"
        variant="primary"
        size="compact"
        onPress={openMintDiscovery}
        style={{ marginTop: 16 }}
        testID={`receive-${method}-find-mints`}
      />
    );
  }

  // An explicitly-picked mint that no longer supports the method (the auto
  // default always resolves to a supporting mint when one exists).
  if (!mintSupports) {
    return (
      <Pressable onPress={() => void openMintSelect()} testID={`receive-${method}-pick-mint`}>
        {renderEmptyState(`${copy.unsupported} Tap to choose a mint.`)}
      </Pressable>
    );
  }

  if (error && !request) {
    return renderEmptyState(
      `Could not load the standing ${method === 'bolt12' ? 'offer' : 'address'}: ${error}`
    );
  }

  if (!request || !qrData) {
    return <ReceiveRailPlaceholder sectionTitle={copy.sectionTitle} />;
  }

  // Expired per coco's own gate → no QR (deposits wouldn't be watched); offer a
  // fresh quote, but keep "View all" reachable so the rail list isn't orphaned.
  if (quoteExpired) {
    return (
      <>
        {renderEmptyState(
          `This ${method === 'bolt12' ? 'offer' : 'address'} has expired.`,
          <Button
            text="Generate new"
            variant="primary"
            size="compact"
            onPress={() => void handleGenerateNew()}
            style={{ marginTop: 16 }}
            disabled={cooldownActive}
            testID={`receive-${method}-generate-new`}
          />
        )}
        <View style={{ marginTop: 12 }}>
          <ActionSegmentsCard
            segments={[
              {
                icon: 'fluent:list-16-filled',
                label: 'View all',
                onPress: openList,
                testID: `receive-${method}-view-all-expired`,
              },
            ]}
          />
        </View>
      </>
    );
  }

  return (
    <>
      <PaymentInfo active={active} data={qrData} copyTarget={copy.copyTarget} unit={unit} />
      {/* Same 12px offset the QR speed controls use under the QR; the Section
          below brings its own py-3, keeping the gaps symmetric. Onchain gets
          New address + View all; bolt12 reuses one standing offer per mint, so
          it only needs View all. */}
      {method === 'onchain' ? (
        <View style={{ marginTop: 12 }}>
          <ActionSegmentsCard
            segments={[
              {
                icon: 'mdi:refresh',
                label: 'New address',
                onPress: () => void handleGenerateAddress(),
                testID: 'receive-onchain-new-address',
                dimmed: cooldownActive,
              },
              {
                icon: 'fluent:list-16-filled',
                label: 'View all',
                onPress: openList,
                testID: 'receive-onchain-view-addresses',
              },
            ]}
          />
        </View>
      ) : (
        <View style={{ marginTop: 12 }}>
          <ActionSegmentsCard
            segments={[
              {
                icon: 'fluent:list-16-filled',
                label: 'View all',
                onPress: openList,
                testID: 'receive-bolt12-view-offers',
              },
            ]}
          />
        </View>
      )}
      <CopyRequestCard
        title={copy.sectionTitle}
        icon={copy.icon}
        display={truncateMiddle(request, 10)}
        muted={muted}
        onPress={handleCopy}
      />
      <HistoryEntryRefresh
        mintInfo={methodMintInfo}
        historyEntry={{ type: 'receive', mintUrl: methodMint }}
        onPress={changeMintAction.available ? openMintSelect : undefined}
      />
    </>
  );
});
