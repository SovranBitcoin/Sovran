/**
 * @fileoverview Sovran ColadaProvider — wires colada to the app
 *
 * Uses createColada for built-in operations and wallet context tracking.
 * Sovran only provides: handlers (navigation), notifications (UI + state),
 * platform primitives, and app-specific enrichment.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share } from 'react-native';

import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useHandleCameraPermission } from '@/features/camera/hooks/useHandleCameraPermission';

import { URDecoder } from '@gandlaf21/bc-ur';

import { useManager } from '@cashu/coco-react';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { Metadata } from 'nostr-tools/kinds';

import type {
  MachineOperations,
  NavigationCallbacks,
  RecipientProfile,
} from '@sovranbitcoin/colada';
import { createColada, createMempoolSpaceChainAdapter, withTimeout } from '@sovranbitcoin/colada';
import {
  ColadaProvider as ColadaProviderBase,
  type ColadaProviderProps,
  type DeepLinkConfig,
} from '@sovranbitcoin/colada/react';

import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { parseRawMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import { paymentLog } from '@/shared/lib/logger';
import { sendDirectMessageToRelays } from '@/shared/lib/nostr/sendDirectMessage';
import { ingestResolvedProfiles } from '@/shared/lib/nostr/useEntityCache';
import {
  createSovranExecuteMintQuote,
  createSovranExecuteReceive,
  createSovranHandlers,
  createSovranNotifications,
  createSovranScanSources,
  createSovranScreenActionHandlers,
} from '@/features/send/lib/sovranPaymentConfig';
import { deriveBitchatBLEIdentityMaterial } from '@/features/bitchat/lib/bleIdentity';
import {
  createSovranScreenActionsBridge,
  getSovranMintEnrichment,
} from '@/features/send/lib/createSovranScreenActionsBridge';
import { createNfcAdapter } from '@/shared/lib/nfc';
import { staticPopup } from '@/shared/lib/popup';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { transactionAnnotationAdapter } from '@/shared/stores/profile/transactionAnnotationStore';
import { runDataMigrations } from '@/shared/lib/migrations/dataMigrations';
import { getMintCatalog } from '@/shared/lib/getMintCatalog';
import { backendConfig } from '@/shared/config/backend';
import { getCachedMintInfo } from '@/shared/stores/global/mintMetadataStore';
import { usePricelistStore } from '@/shared/stores/global/pricelistStore';
import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';

const FIAT_SYMBOLS: Record<string, string> = { usd: '$', eur: '€', gbp: '£' };

// Per-mint NUT-06 deadline used by `fetchMintInfo` below. Only matters on a
// true cache miss; SWR hits resolve synchronously. Kept well under coco's
// 10s `updateMint` timeout so one dead mint can't visibly gate the list.
const FIRST_OPEN_DEADLINE_MS = 3000;

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

export function SovranColadaProvider({ children }: { children: React.ReactNode }) {
  const manager = useManager();
  const { keys } = useNostrKeysContext();
  const { ndk } = useNDK();
  // NDK can change identity across renders (login/logout); the operations
  // closure below must always see the latest instance, so use a ref instead
  // of capturing `ndk` directly.
  const ndkRef = useLatestRef(ndk);
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
  const chainAdapter = useMemo(() => createMempoolSpaceChainAdapter(), []);
  const scanSources = useMemo(() => createSovranScanSources(nfcAdapter), [nfcAdapter]);
  const clipboardAdapter = useMemo<NonNullable<ColadaProviderProps['clipboardAdapter']>>(
    () => ({
      writeText: (text) => Clipboard.setStringAsync(text).then(() => {}),
    }),
    []
  );
  const shareAdapter = useMemo<NonNullable<ColadaProviderProps['shareAdapter']>>(
    () => ({
      share: (content) =>
        Share.share({
          message: content.message,
          url: content.url,
          title: content.title,
        }).then(() => {}),
    }),
    []
  );
  const qrDecoderAdapter = useMemo<NonNullable<ColadaProviderProps['qrDecoderAdapter']>>(
    () => ({
      decode: async (_input) => null,
      createUrDecoder: () => new URDecoder(),
    }),
    []
  );
  // Receive-screen subscribers register a callback here so the notifications
  // factory can fan a p2pk-keypair regeneration out to every mounted receive
  // surface. A Set (not a single slot) lets co-mounted receive screens — e.g.
  // a modal pushed before the prior screen unmounts — each see the refresh
  // instead of clobbering the prior subscriber's slot.
  const p2pkKeyRefreshedSubscribers = useRef(new Set<(newKey: string | null) => void>());
  const getNpub = useCallback(() => npubRef.current, [npubRef]);
  const getBitchatIdentityMaterial = useCallback(() => {
    const privateKey = privateKeyRef.current;
    const pubkey = pubkeyRef.current;
    if (!privateKey || !pubkey) return null;
    return deriveBitchatBLEIdentityMaterial({ privateKey, pubkey });
  }, [privateKeyRef, pubkeyRef]);

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
      createColada({
        manager,
        sendNostrDM: async (nprofile, message) => {
          paymentLog.info('colada.adapter.send_nostr_dm.start', {
            hasPrivateKey: !!privateKeyRef.current,
            nprofileLength: nprofile.length,
            messageLength: message.length,
          });
          const pk = privateKeyRef.current;
          if (!pk) throw new Error('Nostr keys not available');
          try {
            await sendDirectMessageToRelays({ senderPrivateKey: pk, nprofile, message });
            paymentLog.info('colada.adapter.send_nostr_dm.done', {
              nprofileLength: nprofile.length,
            });
          } catch (error) {
            paymentLog.warn('colada.adapter.send_nostr_dm.failed', {
              nprofileLength: nprofile.length,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        getOffline,
        // Disabled while the send-memo UI is WIP. With memos on, a proof-selector
        // round-up/round-down routes PROOFS_CHOSEN -> enterSendMemo, whose sheet is
        // then clobbered by the proof-selector's close() and the send is stranded.
        // Off => PROOFS_CHOSEN goes straight to confirmSend, so round-up just sends.
        enableEcashSendMemo: false,
        getLocale: () => useSettingsStore.getState().language || 'en',
        getBtcPrice,
        getDisplayCurrency,
        getPreferredMintUrl: () => useMintStore.getState().selectedMint,
        nostrAppViewBaseUrl: backendConfig.nostrAppViewBaseUrl,
        nostrAppViewVersion: 'v1',
        // Per-mint audit + KYM + operator Nostr profile. Reads existing
        // source caches first so offline Select Mint rows keep the rich data
        // the app has already seen; online opens refresh those caches behind
        // the same API surface.
        fetchMintCatalog: async (mintUrls) => {
          const startedAt = performance.now();
          const networkMode = getOffline() ? 'cache-only' : 'cache-first';
          paymentLog.info('colada.adapter.fetch_mint_catalog.start', {
            mintCount: mintUrls.length,
            networkMode,
          });
          try {
            const catalog = await getMintCatalog(
              mintUrls,
              (url) => getCachedMintInfo((u) => manager.mint.getMintInfo(u), url),
              { networkMode }
            );
            paymentLog.info('colada.adapter.fetch_mint_catalog.done', {
              mintCount: mintUrls.length,
              returnedCount: Object.keys(catalog).length,
              duration_ms: Math.round(performance.now() - startedAt),
            });
            return catalog;
          } catch (error) {
            paymentLog.warn('colada.adapter.fetch_mint_catalog.failed', {
              mintCount: mintUrls.length,
              duration_ms: Math.round(performance.now() - startedAt),
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        // Per-mint NUT-06 fetcher for the Select Mint list. Routes through the
        // 24h SWR cache so a dead mint can't gate the screen — cached entries
        // resolve synchronously, and even a true cold miss is bounded to
        // FIRST_OPEN_DEADLINE_MS so the slowest mint doesn't pin the list.
        // The background refresh continues after the deadline and writes through
        // via attachMintMetadataToManager.
        fetchMintInfo: async (url) => {
          const startedAt = performance.now();
          paymentLog.debug('colada.adapter.fetch_mint_info.start', {
            ...mintUrlLogFields(url),
            timeoutMs: FIRST_OPEN_DEADLINE_MS,
          });
          try {
            const info = await withTimeout(
              getCachedMintInfo((u) => manager.mint.getMintInfo(u), url),
              FIRST_OPEN_DEADLINE_MS,
              'buildMintListItems.getMintInfo'
            );
            paymentLog.debug('colada.adapter.fetch_mint_info.done', {
              ...mintUrlLogFields(url),
              hasInfo: !!info,
              duration_ms: Math.round(performance.now() - startedAt),
            });
            return info;
          } catch (error) {
            paymentLog.warn('colada.adapter.fetch_mint_info.failed', {
              ...mintUrlLogFields(url),
              duration_ms: Math.round(performance.now() - startedAt),
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          }
        },
        // Trust-review screen still pulls per-mint detail (swap-by-swap timing)
        // from the local audit / KYM caches populated by `useAuditedMint`.
        enrichMintReviewInfo: getSovranMintEnrichment,
        shouldMockFailPaymentRequest: () => useSettingsStore.getState().mockFailPaymentRequest,
        shouldMockFailMelt: () => useSettingsStore.getState().mockFailMelt,
        shouldMockFailSend: () => useSettingsStore.getState().mockFailSend,
        logger: paymentLog,
      }),
    [manager, getOffline, getBtcPrice, getDisplayCurrency, privateKeyRef]
  );

  useEffect(() => {
    return () => instance.dispose();
  }, [instance]);

  // Run pending cross-store data migrations for this profile (level-gated, so
  // a no-op once caught up). Adding the next migration is one appended step in
  // shared/lib/migrations/dataMigrations.ts — no new flag here.
  useEffect(() => {
    void runDataMigrations();
  }, []);

  // Override colada's default executeReceive and executeMintQuote so
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
        // Stage 2 of recipient resolution: hex pubkey → Nostr kind-0 profile.
        // Stage 1 (NIP-05 → pubkey) is shipped by colada's default
        // operation set; this one has no default because NDK / cache wiring
        // is app-specific. Returning null on any failure is the contract:
        // the machine's resolver treats it as best-effort cosmetic data and
        // does not block the flow.
        resolveRecipientProfile: async (pubkey, signal): Promise<RecipientProfile | null> => {
          paymentLog.debug('colada.adapter.resolve_recipient_profile.start', {
            pubkeyLength: pubkey.length,
          });
          const currentNdk = ndkRef.current;
          if (!currentNdk) {
            paymentLog.debug('colada.adapter.resolve_recipient_profile.skipped', {
              reason: 'no_ndk',
            });
            return null;
          }
          if (signal?.aborted) {
            paymentLog.debug('colada.adapter.resolve_recipient_profile.skipped', {
              reason: 'aborted_before_fetch',
            });
            return null;
          }
          try {
            const event = await currentNdk.fetchEvent({
              kinds: [Metadata as number],
              authors: [pubkey],
              limit: 1,
            });
            if (!event) {
              paymentLog.debug('colada.adapter.resolve_recipient_profile.skipped', {
                reason: 'not_found',
              });
              return null;
            }
            const parsed = parseRawMetadata(event.content);
            if (!parsed) {
              paymentLog.debug('colada.adapter.resolve_recipient_profile.skipped', {
                reason: 'invalid_metadata',
              });
              return null;
            }
            // Warm the single owner (entity cache) so other surfaces (ContactRow,
            // DmChatHeader, profile screens, HistoryEntryHeader) hit warm cache
            // for this pubkey on next render without re-fetching.
            ingestResolvedProfiles({ [pubkey]: parsed });
            const displayName = resolveIdentityName({ pubkey, nostrProfile: parsed });
            if (!displayName) {
              paymentLog.debug('colada.adapter.resolve_recipient_profile.skipped', {
                reason: 'no_display_name',
              });
              return null;
            }
            paymentLog.debug('colada.adapter.resolve_recipient_profile.done', {
              hasAvatar: !!parsed.picture,
              hasNip05: !!parsed.nip05,
            });
            return {
              displayName,
              avatarUrl: parsed.picture ?? null,
              nip05: parsed.nip05 ?? null,
            };
          } catch (err) {
            paymentLog.warn('recipient.resolveProfile.threw', {
              error: err instanceof Error ? err.message : String(err),
            });
            return null;
          }
        },
      }) as MachineOperations,
    [instance, manager, ndkRef]
  );

  const actions = useMemo(() => createSovranScreenActionHandlers(), []);

  const navigation = useMemo<NavigationCallbacks>(
    () => ({
      scanQr: ({ unit, context }) => {
        void (async () => {
          const granted = await requestCameraPermission();
          paymentLog.info(`${context}.scan.permission`, { granted });
          if (!granted) return;
          if (context === 'receive') {
            router.navigate({
              pathname: '/(receive-flow)/camera',
              params: { unit },
            });
          } else {
            router.navigate({ pathname: '/camera', params: { unit } });
          }
        })();
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

  const handlers = useCallback<ColadaProviderProps['handlers']>(
    (machine, refs) =>
      createSovranHandlers({
        machine,
        onOptionDismiss: () => refs.getOptionDismiss()?.(),
        getManager: () => manager,
        getNpub,
        getBitchatIdentityMaterial,
      }),
    [manager, getNpub, getBitchatIdentityMaterial]
  );

  return (
    <ColadaProviderBase
      handlers={handlers}
      instance={instance}
      getManager={() => manager}
      annotationStore={transactionAnnotationAdapter}
      operations={operationsOverride}
      notifications={createSovranNotifications({
        getPubkey: () => pubkeyRef.current,
        getPrivateKey: () => privateKeyRef.current,
        getManager: () => manager,
        onP2pkKeyRefreshed: (newKey) => {
          for (const subscriber of p2pkKeyRefreshedSubscribers.current) {
            subscriber(newKey);
          }
        },
      })}
      actions={actions}
      screenActionsBridge={screenActionsBridge}
      clipboardAdapter={clipboardAdapter}
      shareAdapter={shareAdapter}
      nfcAdapter={nfcAdapter}
      chainAdapter={chainAdapter}
      scanSources={scanSources}
      qrDecoderAdapter={qrDecoderAdapter}
      deepLinks={deepLinks}
      navigation={navigation}>
      {children}
    </ColadaProviderBase>
  );
}
