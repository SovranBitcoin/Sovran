/**
 * @fileoverview Sovran CocoPaymentUXProvider — wires coco-payment-ux to the app
 *
 * Passes flat props into coco’s CocoPaymentUXProvider: step handlers, operations,
 * notifications, persistence, scan sources, and screen action handlers.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Share } from 'react-native';

import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';

import { URDecoder } from '@gandlaf21/bc-ur';

import type { HistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

import type { WalletContext, MeltOperationLike, NavigationCallbacks } from 'coco-payment-ux';
import {
  meltOperationToScreenActionEntry,
  shouldApplyEntryUpdate as defaultShouldApply,
  mergeEntryUpdate as defaultMerge,
} from 'coco-payment-ux';
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
import { createNfcAdapter } from '@/shared/lib/nfc/adapter';
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
import { useAuditMintStore } from '@/shared/stores/global/auditMintStore';
import { useKYMMintStore } from '@/shared/stores/global/kymMintStore';
import { usePricelistStore } from '@/shared/stores/global/pricelistStore';
import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { normalizeMintUrlKey } from '@/shared/lib/url';

export { usePaymentFlowMachine, usePaymentFlowMint } from 'coco-payment-ux/react';

const FIAT_SYMBOLS: Record<string, string> = { usd: '$', eur: '€', gbp: '£' };

type EntryRecord = Record<string, unknown>;

function getMintEnrichment(mintUrl: string): EntryRecord {
  const normalized = normalizeMintUrlKey(mintUrl);
  const audit = useAuditMintStore.getState().getCached(normalized);
  const kym = useKYMMintStore.getState().getCached(normalized);

  const enrichment: EntryRecord = {};
  if (kym) enrichment.kymScore = kym.score;
  if (audit) {
    const swaps = audit.auditData.swaps ?? [];
    const swapSuccess = swaps.reduce((acc, s) => acc + (s.state === 'OK' ? 1 : 0), 0);
    const swapTotal = swaps.length;
    const successRate = swapTotal > 0 ? swapSuccess / swapTotal : undefined;
    enrichment.auditScore = typeof successRate === 'number' ? successRate * 5 : undefined;
    enrichment.auditState = audit.auditData.state;
    enrichment.successRate = successRate;
    enrichment.swapSuccess = swapSuccess;
    enrichment.swapTotal = swapTotal;
    enrichment.totalMints = audit.auditData.n_mints;
    enrichment.totalMelts = audit.auditData.n_melts;

    const successfulTimes = swaps
      .filter((s) => s.state === 'OK' && typeof s.time_taken === 'number' && s.time_taken > 0)
      .map((s) => s.time_taken);
    enrichment.avgTimeMs =
      successfulTimes.length > 0
        ? successfulTimes.reduce((sum, t) => sum + t, 0) / successfulTimes.length
        : undefined;
  }
  return enrichment;
}

export function CocoPaymentUXProvider({ children }: { children: React.ReactNode }) {
  const manager = useManager();
  const receiveExtras = useReceivePaymentUXExtras();
  const { keys } = useNostrKeysContext();
  const { isOffline: contextOffline } = useOfflineStatus();
  const mockOffline = useSettingsStore((state) => state.mockOffline);
  const isOffline = mockOffline || contextOffline;
  const offlineRef = useRef(isOffline);
  offlineRef.current = isOffline;
  const getOffline = useCallback(() => offlineRef.current, []);

  const pubkeyRef = useRef(keys?.pubkey);
  pubkeyRef.current = keys?.pubkey;
  const npubRef = useRef(keys?.npub);
  npubRef.current = keys?.npub;
  const privateKeyRef = useRef(keys?.privateKey);
  privateKeyRef.current = keys?.privateKey;

  const writeClipboard = useCallback(
    (text: string) => Clipboard.setStringAsync(text).then(() => {}),
    []
  );
  const shareContent = useCallback(
    (content: { message: string; url?: string }) =>
      Share.share({ message: content.message, url: content.url }).then(() => {}),
    []
  );

  const getManager = useCallback(() => manager, [manager]);
  const [nfcAdapter] = useState(() => createNfcAdapter());
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

  const navigation = useMemo<NavigationCallbacks>(
    () => ({
      scanQr: async ({ unit, context }) => {
        if (context === 'receive') {
          const granted = receiveExtras?.requestCameraPermission
            ? await receiveExtras.requestCameraPermission()
            : false;
          if (!granted) return;
          router.navigate({
            pathname: '/(receive-flow)/camera' as any,
            params: { unit },
          });
        } else {
          router.navigate({ pathname: '/camera' as any, params: { unit } });
        }
      },
      mintInfo: (mintInfoEntry) => {
        router.navigate({
          pathname: '/(mint-flow)/info' as any,
          params: { mintInfoEntry },
        });
      },
      addMint: () => {
        router.push('/(mint-flow)/add' as any);
      },
      goBack: () => {
        router.back();
      },
    }),
    [receiveExtras?.requestCameraPermission]
  );

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
        const unsubscribes: (() => void)[] = [];

        if (screenType !== 'mintSelector' && screenType !== 'mintInfo') {
          unsubscribes.push(
            mgr.on(
              'history:updated',
              ({ entry: updated }: { mintUrl: string; entry: HistoryEntry }) => {
                callback(updated as unknown as EntryRecord);
              }
            )
          );
        }

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

        if (screenType === 'receive') {
          unsubscribes.push(
            useNpcMintStore.subscribe(() => {
              callback({ _npcMintUpdate: true } as EntryRecord);
            })
          );
        }

        if (screenType === 'mintInfo' || screenType === 'mintSelector') {
          const pushEnrichment = () => {
            if (screenType === 'mintInfo') {
              callback({ _mintEnrichment: true } as EntryRecord);
            } else {
              callback({ _mintItemsEnrichment: true } as EntryRecord);
            }
          };
          unsubscribes.push(useAuditMintStore.subscribe(pushEnrichment));
          unsubscribes.push(useKYMMintStore.subscribe(pushEnrichment));
        }

        return () => {
          unsubscribes.forEach((unsubscribe) => unsubscribe());
        };
      },
      shouldApplyEntryUpdate: (current, updated) => {
        if (!current) return false;
        if (updated?._npcMintUpdate && current.type === 'receive') return true;
        if (updated?._mintEnrichment && typeof current.mintUrl === 'string') return true;
        if (updated?._mintItemsEnrichment && Array.isArray(current.items)) return true;
        return defaultShouldApply(current, updated);
      },
      mergeEntryUpdate: (current, updated) => {
        if (!current) return updated;
        if (updated._npcMintUpdate && current.type === 'receive') {
          const npcMintUrl = useNpcMintStore.getState().getActiveMintUrl();
          return { ...current, selectedMintUrl: npcMintUrl, mintUrl: npcMintUrl ?? '' };
        }
        if (updated._mintEnrichment && typeof current.mintUrl === 'string') {
          const enrichment = getMintEnrichment(current.mintUrl as string);
          return { ...current, ...enrichment };
        }
        if (updated._mintItemsEnrichment && Array.isArray(current.items)) {
          const items = (current.items as EntryRecord[]).map((item) => {
            const mintUrl = item.mintUrl as string | undefined;
            if (!mintUrl) return item;
            const enrichment = getMintEnrichment(mintUrl);
            return { ...item, ...enrichment };
          });
          return { ...current, items };
        }
        return defaultMerge(current, updated);
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
      scanSources: createSovranScanSources(nfcAdapter),
      nfcAdapter,
      getOffline,
      getBtcPrice,
      getDisplayCurrency,
      writeClipboard,
      shareContent,
      actions,
      screenActionsBridge,
      deepLinks,
      navigation,
    }),
    [
      getManager,
      getWalletContext,
      getNpub,
      nfcAdapter,
      getOffline,
      getBtcPrice,
      getDisplayCurrency,
      writeClipboard,
      shareContent,
      actions,
      screenActionsBridge,
      deepLinks,
      navigation,
    ]
  );

  return <PaymentUXProviderBase {...providerProps}>{children}</PaymentUXProviderBase>;
}
