/**
 * @fileoverview Sovran CocoPaymentUXProvider — wires coco-payment-ux to the app
 *
 * Passes flat props into coco’s CocoPaymentUXProvider: step handlers, operations,
 * notifications, persistence, scan sources, and screen action handlers.
 */

import React, { useCallback, useMemo, useRef } from 'react';

import * as Linking from 'expo-linking';

import { URDecoder } from '@gandlaf21/bc-ur';

import type { HistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

import type { WalletContext, MeltOperationLike } from 'coco-payment-ux';
import { meltOperationToScreenActionEntry } from 'coco-payment-ux';
import {
  CocoPaymentUXProvider as PaymentUXProviderBase,
  type CocoPaymentUXProviderProps,
  type DeepLinkConfig,
  type ScreenActionsBridge,
} from 'coco-payment-ux/react';

import { useReceivePaymentUXExtras } from '@/features/receive/providers/ReceivePaymentUXExtras';
import {
  createSovranHandlers,
  createSovranNotifications,
  createSovranOperations,
  createSovranScanSources,
  createSovranScreenActionHandlers,
} from '@/features/send/lib/sovranPaymentConfig';
import { sendDirectMessageToRelays } from '@/shared/lib/nostr/sendDirectMessage';
import {
  deeplinkFailedPopup,
  receiveMintUpdatedPopup,
  receiveMintUpdateFailedPopup,
} from '@/shared/lib/popup';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { usePricelistStore } from '@/shared/stores/global/pricelistStore';
import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';

export { usePaymentFlowMachine, usePaymentFlowMint } from 'coco-payment-ux/react';

const FIAT_SYMBOLS: Record<string, string> = { usd: '$', eur: '€', gbp: '£' };

export function CocoPaymentUXProvider({ children }: { children: React.ReactNode }) {
  const manager = useManager();
  const receiveExtras = useReceivePaymentUXExtras();
  const { keys } = useNostrKeysContext();
  const { isOffline } = useOfflineStatus();
  const offlineRef = useRef(isOffline);
  offlineRef.current = isOffline;
  const getOffline = useCallback(() => offlineRef.current, []);

  const pubkeyRef = useRef(keys?.pubkey);
  pubkeyRef.current = keys?.pubkey;
  const npubRef = useRef(keys?.npub);
  npubRef.current = keys?.npub;
  const privateKeyRef = useRef(keys?.privateKey);
  privateKeyRef.current = keys?.privateKey;

  const getManager = useCallback(() => manager, [manager]);
  const walletContextRef = useRef<WalletContext | null>(null);
  const getWalletContext = useCallback(() => walletContextRef.current, []);
  const getNpub = useCallback(() => npubRef.current, []);

  const getBtcPrice = useCallback(() => {
    const currency = useSettingsStore.getState().displayCurrency;
    return usePricelistStore.getState().getBtcPrice(currency) ?? 0;
  }, []);
  const getDisplayCurrency = useCallback(() => {
    const currency = useSettingsStore.getState().displayCurrency as DisplayCurrency;
    const symbol = FIAT_SYMBOLS[currency];
    return symbol ? { code: currency, symbol } : null;
  }, []);

  const actions = useMemo(() => createSovranScreenActionHandlers(), []);

  const deepLinkUrl = Linking.useURL();
  const deepLinks = useMemo<DeepLinkConfig>(
    () => ({
      url: keys?.pubkey ? deepLinkUrl : null,
      customSchemes: ['sovran'],
      ignoredHosts: ['camera', 'expo-development-client'],
      onError: (err) => deeplinkFailedPopup({ text: err.message }),
    }),
    [deepLinkUrl, keys?.pubkey]
  );

  const sendDirectMessage = useCallback(
    async (nprofile: string, message: string) => {
      const pk = keys?.privateKey;
      if (!pk) throw new Error('Nostr keys not available');
      await sendDirectMessageToRelays({ senderPrivateKey: pk, nprofile, message });
    },
    [keys?.privateKey]
  );

  const screenActionsBridge = useMemo<ScreenActionsBridge>(
    () => ({
      getExtraContext: () => ({
        manager: getManager(),
        sendDirectMessage,
        requestCameraPermission: receiveExtras?.requestCameraPermission,
      }),
      onEntryUpdate: (screenType, callback) => {
        const mgr = getManager();
        const unsubscribes = [
          mgr.on(
            'history:updated',
            ({ entry: updated }: { mintUrl: string; entry: HistoryEntry }) => {
              callback(updated as unknown as Record<string, unknown>);
            }
          ),
        ];
        if (screenType === 'meltQuote') {
          const subscribeMeltOperation = (
            eventName: 'melt-op:prepared' | 'melt-op:pending' | 'melt-op:finalized'
          ) =>
            mgr.on(
              eventName,
              ({ operation }: { mintUrl: string; operation: MeltOperationLike }) => {
                const updatedEntry = meltOperationToScreenActionEntry(operation);
                if (updatedEntry) {
                  callback(updatedEntry);
                }
              }
            );
          unsubscribes.push(subscribeMeltOperation('melt-op:prepared'));
          unsubscribes.push(subscribeMeltOperation('melt-op:pending'));
          unsubscribes.push(subscribeMeltOperation('melt-op:finalized'));
        }
        return () => {
          unsubscribes.forEach((unsubscribe) => unsubscribe());
        };
      },
      getLocale: () => useSettingsStore.getState().language || 'en',
      subscribeGlobalScreenActions: (listener) => {
        const unScan = useScanHistoryStore.subscribe(listener);
        const unSettings = useSettingsStore.subscribe(listener);
        return () => {
          unScan();
          unSettings();
        };
      },
      getSourceLabel: (entry) => {
        const entryId = entry && typeof entry.id === 'string' ? entry.id : undefined;
        if (!entryId) return null;
        const scan = useScanHistoryStore
          .getState()
          .entries.find((e) => e.transactionId === entryId);
        if (!scan?.source) return null;
        const labels: Record<string, string> = {
          qr: 'QR Code',
          nfc: 'NFC',
          paste: 'Clipboard',
          deeplink: 'Deep Link',
        };
        return labels[scan.source] ?? null;
      },
    }),
    [getManager, sendDirectMessage, receiveExtras?.requestCameraPermission]
  );

  const providerProps = useMemo<Omit<CocoPaymentUXProviderProps, 'children'>>(
    () => ({
      handlers: (machine, refs) =>
        createSovranHandlers({
          machine,
          onOptionDismiss: () => refs.getOptionDismiss()?.(),
          getManager,
          getNpub,
        }),
      operations: createSovranOperations({ getManager, getWalletContext }),
      notifications: createSovranNotifications(),
      savePreferredMint: (mintUrl) => {
        const pubkey = pubkeyRef.current;
        if (pubkey) {
          useMintStore.getState().setSelectedMint(pubkey, mintUrl);
        }
      },
      saveNpcMint: async (mintUrl) => {
        const pk = privateKeyRef.current;
        if (pk) {
          const ok = await useNpcMintStore.getState().updateServerMint(mintUrl, pk);
          if (ok) receiveMintUpdatedPopup();
          else receiveMintUpdateFailedPopup();
        }
      },
      onNpcMintSync: async () => {
        const mgr = getManager();
        if (mgr) await useNpcMintStore.getState().syncFromServer(mgr);
      },
      walletContextRef,
      createURDecoder: () => new URDecoder(),
      scanSources: createSovranScanSources(),
      getOffline,
      getBtcPrice,
      getDisplayCurrency,
      actions,
      screenActionsBridge,
      deepLinks,
    }),
    [
      getManager,
      getWalletContext,
      getNpub,
      getOffline,
      getBtcPrice,
      getDisplayCurrency,
      actions,
      screenActionsBridge,
      deepLinks,
    ]
  );

  return <PaymentUXProviderBase {...providerProps}>{children}</PaymentUXProviderBase>;
}
