/**
 * Amountless receive tab for coco v2 reusable mint quotes — the Bolt12 offer
 * and the standing Onchain address. One standing quote per (mint, method,
 * unit): colada's `useReusableMintQuote` reuses the open quote so the QR
 * stays stable; deposits auto-mint via coco's watcher + processor. The
 * fixed-amount flow intentionally creates FRESH quotes instead (payment
 * attribution), so this tab never shows those.
 */

import React, { memo, useCallback, useRef, useState } from 'react';

import { router } from 'expo-router';
import { ListGroup, PressableFeedback } from 'heroui-native';

import { getMintMethodCapability, buildBip321OnchainUri, type WalletContext } from 'wallet';
import { useColadaManager, useReusableMintQuote, type UseScreenActionsResult } from 'wallet/react';
import { paymentLog } from '@/shared/lib/logger';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { ReceiveRailPlaceholder } from '@/features/receive/components/ReceiveRailPlaceholder';
import { Section } from '@/shared/ui/composed/Section';
import { HistoryEntryRefresh } from '@/features/transactions';
import { ActionSegmentsCard } from '@/shared/ui/composed/ActionSegmentsCard';
import { useReceiveMethodMint } from '@/features/receive/hooks/useReceiveMethodMint';
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
import { actionMenuSheet } from '@/shared/lib/popup/popups/actionMenuSheet';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { getMintDisplayName } from '@/shared/lib/url';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import Icon from 'assets/icons';

/** Manual "new address" throttle — long enough to stop QR-spamming the
 *  mint, short enough to never feel like a lockout. */
const ROTATE_COOLDOWN_MS = 5000;

interface ReceiveReusableQuoteTabProps {
  method: 'bolt12' | 'onchain';
  unit: string;
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
  const { quote, isLoading, error, rotate } = useReusableMintQuote(
    methodMint && mintSupports ? { mintUrl: methodMint, method, unit } : null,
    standingQuoteIdentityStore
  );

  const request = quote?.request ?? null;
  // The amountless tab shows the BARE standing address; BIP-321 URIs with
  // amounts belong to the fixed-amount flow (fresh address per request).
  const qrData = request && method === 'onchain' ? buildBip321OnchainUri(request) : request;

  // Footer Copy copies the same bare value the in-card copy row does.
  React.useEffect(() => {
    onQrPayload?.(request ? { value: request, copyTarget: copy.copyTarget } : null);
  }, [request, copy.copyTarget, onQrPayload]);

  // Manual address rotation (onchain only) with a short cooldown so the
  // button can't be spammed into a pile of orphan quotes at the mint.
  const manager = useColadaManager();
  const accent = useThemeColor('accent');
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

  // "View all": every pending onchain quote in this profile's coco DB,
  // across all mints. coco stores no origin tag — both the standing rail and
  // the fixed-amount flow call the same quotes.mint.create — so the labels
  // are app-derived: "standing" = the id recorded in the identity map (any
  // mint), fixed-amount quotes carry a prepared mint OPERATION with the
  // requested amount, and orphans are retired/rotated addresses. coco never
  // expires or GCs these rows; only ISSUED bolt11 quotes leave listPending.
  const openAddressList = useCallback(async () => {
    const pending = await manager.quotes.mint.listPending({ method: 'onchain' });
    const standingIds = new Set(Object.values(useMintStore.getState().standingQuotes));
    const nowSeconds = Math.floor(Date.now() / 1000);
    const rows = await Promise.all(
      [...pending]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (q) => ({
          q,
          ops: await manager.ops.mint.listByQuote({ mintUrl: q.mintUrl, quoteId: q.quoteId }),
        }))
    );
    paymentLog.info('receive.onchain.debug_addresses_opened', {
      count: rows.length,
      mintCount: new Set(rows.map(({ q }) => q.mintUrl)).size,
    });

    // TEMP DEBUG (dev metro console only — full addresses stay out of the
    // structured/redacted log stream): every onchain address coco knows
    // about, from BOTH stores, diffed against the menu's pending-quote list.
    // The quotes table is upserted by (mintUrl, method, quoteId) — a mint
    // reusing a quote id OVERWRITES the stored request — while mint
    // operations keep the request snapshot they were created with, so
    // operation history can surface addresses the quotes table has lost.
    if (__DEV__) {
      const looksOnchain = (addr: string) => /^(bc1|tb1|bcrt1|[13])[a-z0-9]+$/i.test(addr);
      const bareAddress = (req: string) =>
        req.startsWith('bitcoin:') ? req.slice('bitcoin:'.length).split('?')[0] : req;
      const opAddresses = new Map<string, { quoteId?: string; state?: string }[]>();
      const PAGE = 200;
      for (let offset = 0; ; offset += PAGE) {
        const page = await manager.history.getPaginatedHistory(offset, PAGE);
        for (const entry of page) {
          if (entry.type !== 'mint') continue;
          const e = entry as { paymentRequest?: string; quoteId?: string; state?: string };
          const addr = e.paymentRequest ? bareAddress(e.paymentRequest) : null;
          if (!addr || !looksOnchain(addr)) continue;
          const list = opAddresses.get(addr) ?? [];
          list.push({ quoteId: e.quoteId, state: e.state });
          opAddresses.set(addr, list);
        }
        if (page.length < PAGE) break;
      }
      const quoteAddresses = new Map(rows.map(({ q }) => [bareAddress(q.request), q]));
      /* eslint-disable no-console */
      console.log(
        `[onchain-debug] quotes table: ${quoteAddresses.size} address(es), ` +
          `operation snapshots: ${opAddresses.size} address(es)`
      );
      for (const [addr, q] of quoteAddresses) {
        console.log(
          `[onchain-debug] quote ${addr} id=${q.quoteId} ` +
            `created=${new Date(q.createdAt).toISOString()} ` +
            `updated=${new Date(q.updatedAt).toISOString()}`
        );
      }
      for (const [addr, entries] of opAddresses) {
        console.log(
          `[onchain-debug] op    ${addr} entries=${entries.length} ` +
            `states=${entries.map((e) => e.state).join(',')} ` +
            `inMenu=${quoteAddresses.has(addr)}`
        );
      }
      const onlyInOps = [...opAddresses.keys()].filter((a) => !quoteAddresses.has(a));
      console.log(
        `[onchain-debug] addresses ONLY in operation history (lost from quotes table): ` +
          `${onlyInOps.length}`,
        onlyInOps
      );
      /* eslint-enable no-console */
    }
    actionMenuSheet({
      title: `Onchain addresses (${rows.length})`,
      buttons: rows.map(({ q, ops }) => {
        const isStanding = standingIds.has(q.quoteId);
        const isExpired = q.expiry != null && q.expiry > 0 && q.expiry <= nowSeconds;
        const data = q.quoteData as { amountPaid?: unknown; amountIssued?: unknown };
        const paid = data.amountPaid != null ? amountToNumber(data.amountPaid as never) : 0;
        const lastOp = ops.at(-1) as { amount?: unknown } | undefined;
        const opAmount = lastOp?.amount != null ? amountToNumber(lastOp.amount as never) : null;
        const parts = [
          getMintDisplayName(q.mintUrl, null),
          isStanding ? 'standing' : ops.length > 0 ? 'fixed-amount' : 'orphan',
          ...(opAmount != null ? [`${opAmount} ${q.unit}`] : []),
          ...(__DEV__ ? [`ops ${ops.length}`] : []),
          ...(paid > 0 ? [`paid ${paid}`] : []),
          ...(isExpired ? ['expired'] : []),
          new Date(q.createdAt).toLocaleString(),
          // coco upserts quotes by (mintUrl, method, quoteId): if the mint
          // answers repeated requests with the SAME quote, every "new"
          // create collapses into one row and only bumps updatedAt — a big
          // created→updated gap is the fingerprint of that collapse.
          ...(__DEV__ && q.updatedAt - q.createdAt > 60_000
            ? [`re-upserted until ${new Date(q.updatedAt).toLocaleString()}`]
            : []),
        ];
        return {
          text: truncateMiddle(q.request, 12),
          description: parts.join(' · '),
          suffix: isStanding ? <Icon name="mdi:check" size={20} color={accent} /> : undefined,
          onPress: async () => {
            await setStringAsync(q.request);
            copyPopup('address');
          },
        };
      }),
    });
  }, [manager, accent]);

  const handleCopy = useCallback(async () => {
    if (!request) return;
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(request);
    copyPopup(copy.copyTarget);
    paymentLog.info(`receive.${method}.copied`, { requestLength: request.length });
  }, [request, method, copy.copyTarget]);

  const openMintDiscovery = useCallback(() => {
    paymentLog.info(`receive.${method}.discovery_opened`, { unit });
    router.push({ pathname: '/(mint-flow)/add', params: { method } });
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

  return (
    <>
      <PaymentInfo data={qrData} copyTarget={copy.copyTarget} unit={unit} />
      {method === 'onchain' && (
        // Same 12px offset the QR speed controls use under the QR; the
        // Section below brings its own py-3, keeping the gaps symmetric.
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
                onPress: () => void openAddressList(),
                testID: 'receive-onchain-view-addresses',
              },
            ]}
          />
        </View>
      )}
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
