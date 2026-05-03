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

import { URDecoder } from '@gandlaf21/bc-ur';

import { useManager } from '@cashu/coco-react';

import type { MachineOperations, MeltOperationLike, NavigationCallbacks } from 'coco-payment-ux';
import {
  createCocoPaymentUX,
  meltOperationToScreenActionEntry,
  shouldApplyEntryUpdate as defaultShouldApply,
  mergeEntryUpdate as defaultMerge,
  sendDirectMessageToRelays,
} from 'coco-payment-ux';
import {
  CocoPaymentUXProvider as PaymentUXProviderBase,
  type DeepLinkConfig,
  type ScreenActionsBridge,
} from 'coco-payment-ux/react';

import { paymentLog } from '@/shared/lib/logger';
import { useReceivePaymentUXExtras } from '@/features/receive/providers/ReceivePaymentUXExtras';
import {
  createSovranExecuteMintQuote,
  createSovranExecuteReceive,
  createSovranHandlers,
  createSovranNotifications,
  createSovranScanSources,
  createSovranScreenActionHandlers,
} from '@/features/send/lib/sovranPaymentConfig';
import { createNfcAdapter } from '@/shared/lib/nfc/adapter';
import { deeplinkFailedPopup } from '@/shared/lib/popup';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { useTransactionDistributionStore } from '@/shared/stores/profile/transactionDistributionStore';
import { useAuditMintStore } from '@/shared/stores/global/auditMintStore';
import { useKYMMintStore } from '@/shared/stores/global/kymMintStore';
import { useMintProfileStore } from '@/shared/stores/global/mintProfileStore';
import { getMintCatalog } from '@/shared/lib/getMintCatalog';
import { usePricelistStore } from '@/shared/stores/global/pricelistStore';
import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { normalizeMintUrlKey } from '@/shared/lib/url';

export { usePaymentFlowMachine } from 'coco-payment-ux/react';

const FIAT_SYMBOLS: Record<string, string> = { usd: '$', eur: '€', gbp: '£' };

type EntryRecord = Record<string, unknown>;

/**
 * Per-mint enrichment for the trust-review screen — reads detailed audit
 * data (swap-by-swap timing, error breakdown) from the local stores that
 * `useAuditedMint` / `MintReviewsScreen` populate when the user navigates
 * into a mint's detail view. The Select-Mint list path goes through
 * `getMintCatalog` instead and never calls this.
 */
function getMintEnrichment(mintUrl: string): EntryRecord {
  const normalized = normalizeMintUrlKey(mintUrl);
  const audit = useAuditMintStore.getState().getCached(normalized);
  const kym = useKYMMintStore.getState().getCached(normalized);

  const enrichment: EntryRecord = {};
  if (kym) {
    enrichment.kymScore = kym.score;
    enrichment.reviewCount = kym.recommendations?.length;
  }
  const profile = useMintProfileStore.getState().getCached(normalized);
  if (profile) {
    enrichment.contactFollowers = profile.followers;
    enrichment.contactReputation = Math.round(profile.reputation);
  }
  if (audit) {
    const swaps = audit.auditData.swaps ?? [];
    const swapSuccess = swaps.reduce((acc, s) => acc + (s.state === 'OK' ? 1 : 0), 0);
    const swapTotal = swaps.length;
    // Prefer server-side aggregates so the score lights up even when the
    // auditor hasn't run swaps recently — same logic as the mint-add screen.
    const totalOps = (audit.auditData.n_mints ?? 0) + (audit.auditData.n_melts ?? 0);
    const aggregateSuccessRate =
      totalOps > 0
        ? Math.max(0, Math.min(1, 1 - (audit.auditData.n_errors ?? 0) / totalOps))
        : undefined;
    const swapSuccessRate = swapTotal > 0 ? swapSuccess / swapTotal : undefined;
    const successRate = aggregateSuccessRate ?? swapSuccessRate;
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

  const npubRef = useRef(keys?.npub);
  npubRef.current = keys?.npub;
  const pubkeyRef = useRef(keys?.pubkey);
  pubkeyRef.current = keys?.pubkey;
  const privateKeyRef = useRef(keys?.privateKey);
  privateKeyRef.current = keys?.privateKey;

  const [nfcAdapter] = useState(() => createNfcAdapter());
  const p2pkKeyRefreshedRef = useRef<((newKey: string | null) => void) | null>(null);
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
        getPreferredMintUrl: () => {
          const pk = pubkeyRef.current;
          return pk ? useMintStore.getState().getSelectedMint(pk) : undefined;
        },
        // Per-mint audit + KYM + operator Nostr profile, with a fallback to
        // coco's NUT-06 `getMintInfo` for mints that the auditor doesn't
        // track (e.g. mint.sovran.money is excluded from api.sovran.money).
        // Awaited inside coco-payment-ux's buildMintListItems so rows reach
        // the screen with score / audit / followers already set.
        fetchMintCatalog: (mintUrls) =>
          getMintCatalog(mintUrls, (url) => manager.mint.getMintInfo(url)),
        // Trust-review screen still pulls per-mint detail (swap-by-swap timing)
        // from the local audit / KYM caches populated by `useAuditedMint`.
        enrichMintReviewInfo: (url) => getMintEnrichment(url) as any,
        shouldMockFailPaymentRequest: () => useSettingsStore.getState().mockFailPaymentRequest,
      }),
    [manager, nfcAdapter, getOffline, getBtcPrice, getDisplayCurrency]
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
          if (!receiveExtras?.requestCameraPermission) {
            // The Receive screen mounts inside `ReceivePaymentUXExtrasProvider`,
            // which supplies `requestCameraPermission`. If we got here without
            // it the provider isn't wrapping the route — log loudly so we can
            // investigate, and fall through to the generic camera path so the
            // user isn't stuck with a dead button.
            paymentLog.warn('receive.scan.no_permission_provider');
            router.navigate({ pathname: '/(receive-flow)/camera', params: { unit } });
            return;
          }
          const granted = await receiveExtras.requestCameraPermission();
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

  const screenActionsBridge = useMemo<ScreenActionsBridge>(() => {
    // Closure state for async mint-info fetches triggered from mergeEntryUpdate.
    let mintInfoCallback: ((entry: EntryRecord) => void) | null = null;
    let mintInfoFetchingUrl: string | null = null;

    return {
      getExtraContext: () => ({
        manager,
        requestCameraPermission: receiveExtras?.requestCameraPermission,
      }),
      onEntryUpdate: (screenType, callback) => {
        const unsubscribes: (() => void)[] = [];

        if (screenType !== 'mintSelector' && screenType !== 'mintInfo') {
          unsubscribes.push(
            manager.on('history:updated', ({ entry: updated }: { mintUrl: string; entry: any }) => {
              paymentLog.info('send.entry_updated', {
                screenType,
                type: updated?.type,
                id: updated?.id,
                state: updated?.state,
                quoteId: updated?.quoteId,
              });
              callback(updated as unknown as EntryRecord);
            })
          );
        }

        if (screenType === 'meltQuote') {
          const subscribeMeltOperation = (
            eventName: 'melt-op:prepared' | 'melt-op:pending' | 'melt-op:finalized'
          ) =>
            manager.on(
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

        if (screenType === 'mintQuote') {
          // Subscribe to mint operation state changes (UNPAID → PAID → ISSUED).
          // Must include type:'mint' so defaultShouldApply can match by type+quoteId.
          unsubscribes.push(
            manager.on(
              'mint-op:quote-state-changed',
              ({
                operationId,
                quoteId,
                state,
              }: {
                mintUrl: string;
                operationId: string;
                quoteId: string;
                state: string;
              }) => {
                paymentLog.info('send.mint_quote_state_changed', {
                  screenType,
                  operationId,
                  quoteId,
                  state,
                });
                callback({ type: 'mint', quoteId, state, operationId } as unknown as EntryRecord);
              }
            )
          );
          unsubscribes.push(
            manager.on(
              'mint-op:finalized',
              ({ operationId }: { mintUrl: string; operationId: string }) => {
                paymentLog.info('send.mint_op_finalized', { screenType, operationId });
                callback({ type: 'mint', operationId, state: 'ISSUED' } as unknown as EntryRecord);
              }
            )
          );
        }

        if (screenType === 'receive') {
          unsubscribes.push(
            useNpcMintStore.subscribe(() => {
              callback({ _npcMintUpdate: true } as EntryRecord);
            })
          );
          p2pkKeyRefreshedRef.current = (newKey: string | null) => {
            callback({ _p2pkKeyUpdate: true, p2pkKey: newKey } as EntryRecord);
          };
          unsubscribes.push(() => {
            p2pkKeyRefreshedRef.current = null;
          });
        }

        // The mint-info (trust review) screen still pulls per-mint detail
        // (swap timing, full review list) from the local audit / KYM / profile
        // caches — populated by `useAuditedMint` and friends when the user
        // navigates into a mint detail view. Subscribe so already-cached data
        // and any in-flight fetches refresh the screen.
        if (screenType === 'mintInfo') {
          const pushEnrichment = () => {
            callback({ _mintEnrichment: true } as EntryRecord);
          };
          unsubscribes.push(useAuditMintStore.subscribe(pushEnrichment));
          unsubscribes.push(useKYMMintStore.subscribe(pushEnrichment));
          unsubscribes.push(useMintProfileStore.subscribe(pushEnrichment));

          mintInfoCallback = callback;
          unsubscribes.push(() => {
            mintInfoCallback = null;
            mintInfoFetchingUrl = null;
          });
          pushEnrichment();
        }

        if (screenType === 'mintSelector') {
          // Live-update the open selector when a mint is added. Catalog data
          // for the new mint is unavailable on the API immediately so the row
          // shows up without score / audit pills until the next list build.
          unsubscribes.push(
            manager.on('mint:added', ({ mint }: { mint: { mintUrl: string } }) => {
              const mintUrl = mint.mintUrl;
              (async () => {
                try {
                  const [info, balances] = await Promise.all([
                    manager.mint.getMintInfo(mintUrl).catch(() => null),
                    manager.wallet.balances
                      .byMint({ mintUrls: [mintUrl] })
                      .catch(
                        () => ({}) as Awaited<ReturnType<typeof manager.wallet.balances.byMint>>
                      ),
                  ]);
                  callback({
                    _mintItemAdded: true,
                    _newMintItem: {
                      mintUrl,
                      displayName: (info as any)?.name ?? mintUrl,
                      iconUrl: (info as any)?.icon_url ?? undefined,
                      balance: balances[mintUrl]?.total ?? 0,
                      unit: 'sat',
                      status: 'available',
                      reason: null,
                      isPreferred: false,
                    },
                  } as EntryRecord);
                } catch {
                  callback({
                    _mintItemAdded: true,
                    _newMintItem: {
                      mintUrl,
                      displayName: mintUrl,
                      balance: 0,
                      unit: 'sat',
                      status: 'available',
                      reason: null,
                      isPreferred: false,
                    },
                  } as EntryRecord);
                }
              })();
            })
          );
        }

        return () => {
          unsubscribes.forEach((unsubscribe) => unsubscribe());
        };
      },
      shouldApplyEntryUpdate: (current, updated) => {
        if (!current) return false;
        if (updated?._npcMintUpdate && current.type === 'receive') return true;
        if (updated?._p2pkKeyUpdate && current.type === 'receive') return true;
        if (updated?._mintEnrichment && typeof current.mintUrl === 'string') return true;
        if (updated?._mintInfoFetched && typeof current.mintUrl === 'string') return true;
        if (updated?._mintItemAdded && Array.isArray(current.items)) return true;
        return defaultShouldApply(current, updated);
      },
      mergeEntryUpdate: (current, updated) => {
        if (!current) return updated;
        if (updated._npcMintUpdate && current.type === 'receive') {
          const npcMintUrl = useNpcMintStore.getState().getActiveMintUrl();
          return { ...current, selectedMintUrl: npcMintUrl, mintUrl: npcMintUrl ?? '' };
        }
        if (updated._p2pkKeyUpdate && current.type === 'receive') {
          return { ...current, p2pkKey: updated.p2pkKey ?? undefined };
        }
        if (updated._mintEnrichment && typeof current.mintUrl === 'string') {
          const enrichment = getMintEnrichment(current.mintUrl as string);
          const merged = { ...current, ...enrichment };

          // Bare entry (e.g. navigated from user profile with only mintUrl) —
          // kick off an async fetch of full mint info from the mint API.
          const mintUrl = current.mintUrl as string;
          if (
            !current.displayName &&
            !current._mintInfoFetched &&
            mintInfoCallback &&
            mintInfoFetchingUrl !== mintUrl
          ) {
            mintInfoFetchingUrl = mintUrl;
            const cb = mintInfoCallback;
            (async () => {
              try {
                const [mintInfo, isTrusted] = await Promise.all([
                  manager.mint.getMintInfo(mintUrl).catch(() => undefined),
                  manager.mint.isTrustedMint(mintUrl).catch(() => false),
                ]);
                const info: any = mintInfo ?? {};
                cb({
                  _mintInfoFetched: true,
                  displayName: info.name ?? mintUrl,
                  iconUrl: info.icon_url,
                  description: info.description,
                  longDescription: info.description_long,
                  motd: info.motd,
                  contact: info.contact,
                  isTrusted,
                } as EntryRecord);
              } catch (e) {
                paymentLog.warn('send.mint_info_fetch_failed', {
                  mintUrl,
                  error: e instanceof Error ? e : new Error(String(e)),
                });
              }
            })();
          }

          return merged;
        }
        if (updated._mintInfoFetched && typeof current?.mintUrl === 'string') {
          const { _mintInfoFetched, ...rest } = updated;
          return { ...current, ...rest, _mintInfoFetched: true };
        }
        if (updated._mintItemAdded && updated._newMintItem && Array.isArray(current.items)) {
          const newItem = updated._newMintItem as EntryRecord;
          const exists = (current.items as EntryRecord[]).some(
            (item) => item.mintUrl === newItem.mintUrl
          );
          if (exists) return current;

          // Determine status based on the flow's destination/scope
          const destination = current.destination as string | undefined;
          const scope = current.scope as string | undefined;
          const needsBalance =
            destination === 'paymentRequest' ||
            destination === 'meltQuote' ||
            destination === 'sendEcash';
          const skipBalance = !needsBalance || scope === 'selected' || scope === 'npc';
          if (!skipBalance && ((newItem.balance as number) ?? 0) <= 0) {
            newItem.status = 'disabled';
            newItem.reason = { code: 'NO_BALANCE', message: 'No balance' };
          }

          return { ...current, items: [...(current.items as EntryRecord[]), newItem] };
        }
        return defaultMerge(current, updated);
      },
      getLocale: () => useSettingsStore.getState().language || 'en',
      subscribeGlobalScreenActions: (listener) => {
        const unScan = useScanHistoryStore.subscribe(listener);
        const unDistribution = useTransactionDistributionStore.subscribe(listener);
        const unSettings = useSettingsStore.subscribe(listener);
        return () => {
          unScan();
          unDistribution();
          unSettings();
        };
      },
      getSourceLabel: (entry) => {
        const entryId = entry && typeof entry.id === 'string' ? entry.id : undefined;
        if (!entryId) return null;
        // Inbound source (scan history) takes precedence — those are user
        // actions that brought data INTO the wallet. Outbound distribution
        // is the fallback for transactions where the user shared data OUT
        // (currently only Lightning mint quotes).
        const scan = useScanHistoryStore
          .getState()
          .entries.find((e) => e.transactionId === entryId);
        // Distribution store is keyed by `quoteId` for mint entries (the
        // deterministic identifier from the lightning quote) and by entry.id
        // for everything else. Mirror this in `useTransactionSource` in
        // Transaction.tsx — both readers must use the same key.
        const distKey =
          entry?.type === 'mint' && typeof entry?.quoteId === 'string'
            ? (entry.quoteId as string)
            : entryId;
        const distribution = useTransactionDistributionStore.getState().distributions[distKey];
        const source = scan?.source ?? distribution?.source ?? null;
        if (!source) return null;
        const labels: Record<string, string> = {
          // Inbound (scan history)
          qr: 'QR Code',
          nfc: 'NFC',
          paste: 'Clipboard',
          deeplink: 'Deep Link',
          // Outbound (transaction distribution)
          copy: 'Copied',
          share: 'Shared',
          airdrop: 'AirDrop',
          displayed: 'QR Code',
        };
        return labels[source] ?? null;
      },
    };
  }, [manager, receiveExtras?.requestCameraPermission]);

  return (
    <PaymentUXProviderBase
      instance={instance}
      operations={operationsOverride}
      handlers={(machine, refs) =>
        createSovranHandlers({
          machine,
          onOptionDismiss: () => refs.getOptionDismiss()?.(),
          getManager: () => manager,
          getNpub,
        })
      }
      notifications={createSovranNotifications({
        getPubkey: () => pubkeyRef.current,
        getPrivateKey: () => privateKeyRef.current,
        getManager: () => manager,
        onP2pkKeyRefreshed: (newKey) => p2pkKeyRefreshedRef.current?.(newKey),
      })}
      actions={actions}
      screenActionsBridge={screenActionsBridge}
      deepLinks={deepLinks}
      navigation={navigation}>
      {children}
    </PaymentUXProviderBase>
  );
}
