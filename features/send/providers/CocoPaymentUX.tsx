/**
 * @fileoverview Sovran CocoPaymentUXProvider — wires coco-payment-ux to the app
 *
 * Uses createCocoPaymentUX for built-in operations and wallet context tracking.
 * Sovran only provides: handlers (navigation), notifications (UI + state),
 * platform primitives, and app-specific enrichment.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share } from 'react-native';

import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useHandleCameraPermission } from '@/features/camera/hooks/useHandleCameraPermission';

import { URDecoder } from '@gandlaf21/bc-ur';

import { useManager } from '@cashu/coco-react';

import type { MachineOperations, NavigationCallbacks } from 'coco-payment-ux';
import { createCocoPaymentUX } from 'coco-payment-ux';
import {
  CocoPaymentUXProvider as PaymentUXProviderBase,
  type DeepLinkConfig,
} from 'coco-payment-ux/react';

import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { paymentLog } from '@/shared/lib/logger';
import { sendDirectMessageToRelays } from '@/shared/lib/nostr/sendDirectMessage';
import {
  createSovranExecuteMintQuote,
  createSovranExecuteReceive,
  createSovranHandlers,
  createSovranNotifications,
  createSovranScanSources,
  createSovranScreenActionHandlers,
} from '@/features/send/lib/sovranPaymentConfig';
import {
  createSovranScreenActionsBridge,
  getSovranMintEnrichment,
} from '@/features/send/lib/createSovranScreenActionsBridge';
import { createNfcAdapter } from '@/shared/lib/nfc';
import { staticPopup } from '@/shared/lib/popup';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useTransactionDistributionStore } from '@/shared/stores/profile/transactionDistributionStore';
import { getMintCatalog } from '@/shared/lib/getMintCatalog';
import { getCachedMintInfo } from '@/shared/stores/global/mintInfoCache';
import { usePricelistStore } from '@/shared/stores/global/pricelistStore';
import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';

const FIAT_SYMBOLS: Record<string, string> = { usd: '$', eur: '€', gbp: '£' };

export function SovranPaymentUXProvider({ children }: { children: React.ReactNode }) {
  const manager = useManager();
  const { keys } = useNostrKeysContext();
  const { isOffline: contextOffline } = useOfflineStatus();
  const mockOffline = useSettingsStore((state) => state.mockOffline);
  const isOffline = mockOffline || contextOffline;
  const offlineRef = useLatestRef(isOffline);
  const getOffline = useCallback(() => offlineRef.current, [offlineRef]);

  // Camera permission lives here rather than behind a (receive-flow)-scoped
  // context provider so it's reachable from this provider's navigation /
  // screen-action bridges. A descendant context would resolve to undefined
  // here and silently no-op the Receive scan-QR button. Delegating to
  // useHandleCameraPermission keeps a single canonical permission gateway
  // (the hook owns the explainer + Open-Settings popup chain).
  const { handlePermission } = useHandleCameraPermission();
  const requestCameraPermission = useCallback(() => handlePermission(), [handlePermission]);

  const npubRef = useLatestRef(keys?.npub);
  const pubkeyRef = useLatestRef(keys?.pubkey);
  const privateKeyRef = useLatestRef(keys?.privateKey);

  const [nfcAdapter] = useState(() => createNfcAdapter());
  // Receive-screen subscribers register a callback here so the notifications
  // factory can fan a p2pk-keypair regeneration out to every mounted receive
  // surface. A Set (not a single slot) lets co-mounted receive screens — e.g.
  // a modal pushed before the prior screen unmounts — each see the refresh
  // instead of clobbering the prior subscriber's slot.
  const p2pkKeyRefreshedSubscribers = useRef(new Set<(newKey: string | null) => void>());
  const getNpub = useCallback(() => npubRef.current, [npubRef]);

  const getBtcPrice = useCallback(() => {
    const currency = useSettingsStore.getState().displayCurrency;
    return usePricelistStore.getState().getBtcPrice(currency) ?? 0;
  }, []);
  const getDisplayCurrency = useCallback(() => {
    const currency = useSettingsStore.getState().displayCurrency as DisplayCurrency;
    const symbol = FIAT_SYMBOLS[currency];
    return symbol ? { code: currency, symbol } : null;
  }, []);

  const instance = useMemo(
    () =>
      createCocoPaymentUX({
        manager,
        platform: {
          clipboard: { write: (text: string) => Clipboard.setStringAsync(text).then(() => {}) },
          share: (content) =>
            Share.share({ message: content.message, url: content.url }).then(() => {}),
          nfc: nfcAdapter,
          scanSources: createSovranScanSources(nfcAdapter),
          createURDecoder: () => new URDecoder(),
        },
        sendNostrDM: async (nprofile, message) => {
          const pk = privateKeyRef.current;
          if (!pk) throw new Error('Nostr keys not available');
          await sendDirectMessageToRelays({ senderPrivateKey: pk, nprofile, message });
        },
        getOffline,
        getLocale: () => useSettingsStore.getState().language || 'en',
        getBtcPrice,
        getDisplayCurrency,
        getPreferredMintUrl: () => useMintStore.getState().selectedMint,
        // Per-mint audit + KYM + operator Nostr profile, with a fallback to
        // coco's NUT-06 `getMintInfo` for mints that the auditor doesn't
        // track (e.g. mint.sovran.money is excluded from api.sovran.money).
        // Awaited inside coco-payment-ux's buildMintListItems so rows reach
        // the screen with score / audit / followers already set.
        fetchMintCatalog: (mintUrls) =>
          getMintCatalog(mintUrls, (url) =>
            getCachedMintInfo((u) => manager.mint.getMintInfo(u), url)
          ),
        // Trust-review screen still pulls per-mint detail (swap-by-swap timing)
        // from the local audit / KYM caches populated by `useAuditedMint`.
        enrichMintReviewInfo: getSovranMintEnrichment,
        shouldMockFailPaymentRequest: () => useSettingsStore.getState().mockFailPaymentRequest,
        shouldMockFailMelt: () => useSettingsStore.getState().mockFailMelt,
        shouldMockFailSend: () => useSettingsStore.getState().mockFailSend,
        logger: paymentLog,
      }),
    [manager, nfcAdapter, getOffline, getBtcPrice, getDisplayCurrency, privateKeyRef]
  );

  useEffect(() => {
    return () => instance.dispose();
  }, [instance]);

  // Mint-quote distribution source: when a Lightning mint quote transitions
  // to PAID/ISSUED, infer 'displayed' as the source if no explicit copy/share
  // action was recorded. The first-write-wins guard in the distribution store
  // ensures this is a no-op when copy/share/airdrop was already recorded by
  // the mintQuote.copy or mintQuote.share screen-action overrides.
  //
  // We key the distribution write by `payload.quoteId` (NOT a looked-up
  // historyEntry.id). quoteId is the deterministic identifier carried by
  // the lightning quote — it's identical no matter which path resolves it,
  // so the first-write-wins guard correctly engages whether we wrote 'copy'
  // first from the screen action or 'displayed' from this subscription.
  useEffect(() => {
    if (!manager) return;
    const handler = (payload: {
      mintUrl: string;
      operationId: string;
      quoteId: string;
      state: string;
    }) => {
      if (payload.state !== 'PAID' && payload.state !== 'ISSUED') return;
      if (!payload.quoteId) {
        paymentLog.warn('payment.mint_quote.displayed_inference.no_quote_id', {
          operationId: payload.operationId,
          state: payload.state,
        });
        return;
      }
      useTransactionDistributionStore.getState().setDistribution(payload.quoteId, 'displayed');
      paymentLog.debug('payment.mint_quote.displayed_inference.applied', {
        quoteId: payload.quoteId,
        operationId: payload.operationId,
        state: payload.state,
      });
    };
    const unsub = manager.on('mint-op:quote-state-changed', handler);
    return unsub;
  }, [manager]);

  // Override coco-payment-ux's default executeReceive and executeMintQuote so
  // they always return entries with coco's REAL persisted history ids — never
  // synthesized fallbacks (`redeemed-${Date.now()}`) or unverified operation
  // ids. This guarantees the location stamp + scan-history link captured
  // downstream are keyed to the same id `usePaginatedHistory` returns later,
  // so reopening the transaction from the list resolves them correctly.
  // See sovranPaymentConfig.createSovranExecuteReceive / createSovranExecuteMintQuote
  // for the full rationale. Spreading instance.operations preserves all other defaults.
  const operationsOverride = useMemo<MachineOperations>(
    () =>
      ({
        ...instance.operations,
        executeReceive: createSovranExecuteReceive(() => manager),
        executeMintQuote: createSovranExecuteMintQuote(() => manager),
      }) as MachineOperations,
    [instance, manager]
  );

  const actions = useMemo(() => createSovranScreenActionHandlers(), []);

  const navigation = useMemo<NavigationCallbacks>(
    () => ({
      scanQr: async ({ unit, context }) => {
        if (context === 'receive') {
          const granted = await requestCameraPermission();
          paymentLog.info('receive.scan.permission', { granted });
          if (!granted) return;
          router.navigate({
            pathname: '/(receive-flow)/camera',
            params: { unit },
          });
        } else {
          router.navigate({ pathname: '/camera', params: { unit } });
        }
      },
      mintInfo: (mintInfoEntry) => {
        router.navigate({
          pathname: '/(mint-flow)/info',
          params: { mintInfoEntry },
        });
      },
      addMint: () => {
        router.push('/(mint-flow)/add');
      },
      goBack: () => {
        router.back();
      },
    }),
    [requestCameraPermission]
  );

  const deepLinkUrl = Linking.useURL();
  const deepLinks = useMemo<DeepLinkConfig>(
    () => ({
      url: keys?.pubkey ? deepLinkUrl : null,
      customSchemes: ['sovran'],
      ignoredHosts: ['camera', 'expo-development-client'],
      onError: (err) => staticPopup('deeplink-failed', { text: err.message }),
    }),
    [deepLinkUrl, keys?.pubkey]
  );

  const screenActionsBridge = useMemo(
    () =>
      createSovranScreenActionsBridge({
        manager,
        requestCameraPermission,
        p2pkKeyRefreshedSubscribers,
      }),
    [manager, requestCameraPermission]
  );

  return (
    <PaymentUXProviderBase
      handlers={(machine, refs) =>
        createSovranHandlers({
          machine,
          onOptionDismiss: () => refs.getOptionDismiss()?.(),
          getManager: () => manager,
          getNpub,
        })
      }
      engine={{
        instance,
        operations: operationsOverride,
      }}
      callbacks={{
        notifications: createSovranNotifications({
          getPubkey: () => pubkeyRef.current,
          getPrivateKey: () => privateKeyRef.current,
          getManager: () => manager,
          onP2pkKeyRefreshed: (newKey) => {
            for (const subscriber of p2pkKeyRefreshedSubscribers.current) {
              subscriber(newKey);
            }
          },
        }),
        actions,
        screenActionsBridge,
      }}
      platform={{
        deepLinks,
        navigation,
      }}>
      {children}
    </PaymentUXProviderBase>
  );
}
