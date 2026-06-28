import type { MutableRefObject } from 'react';

import type {
  ColadaSubscriptionBus,
  ColadaSubscriptionEvent,
  JsonRecord,
  Manager,
  MeltOperationLike,
  MintReviewInfo,
  ScreenActionsBridge,
  ScreenType,
} from '@sovranbitcoin/colada';
import {
  isMintQuotePaymentObserved,
  meltOperationToScreenActionEntry,
  mergeEntryUpdate as defaultMerge,
  shouldApplyEntryUpdate as defaultShouldApply,
} from '@sovranbitcoin/colada';

import { paymentLog } from '@/shared/lib/logger';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { getCachedMintInfo, useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { useTransactionDistributionStore } from '@/shared/stores/profile/transactionDistributionStore';
import { setDistributionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';

type EntryRecord = Record<string, unknown>;

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

const HISTORY_TYPE_BY_SCREEN: Partial<Record<ScreenType, string>> = {
  meltQuote: 'melt',
  mintQuote: 'mint',
  paymentRequest: 'send',
  receive: 'receive',
  receiveToken: 'receive',
  sendToken: 'send',
};

const SOURCE_LABELS: Record<string, string> = {
  qr: 'QR Code',
  nfc: 'NFC',
  paste: 'Clipboard',
  deeplink: 'Deep Link',
  copy: 'Copied',
  share: 'Shared',
  airdrop: 'AirDrop',
  displayed: 'QR Code',
};

function asEntryRecord(value: unknown): EntryRecord | null {
  return typeof value === 'object' && value !== null ? (value as EntryRecord) : null;
}

function getStringField(entry: EntryRecord | null, key: string): string | undefined {
  const value = entry?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getHistoryType(
  entry: EntryRecord | null
): 'send' | 'receive' | 'melt' | 'mint' | undefined {
  const type = getStringField(entry, 'type');
  return type === 'send' || type === 'receive' || type === 'melt' || type === 'mint'
    ? type
    : undefined;
}

function publishHistoryUpdated(bus: ColadaSubscriptionBus, updated: unknown): void {
  const entry = asEntryRecord(updated);
  if (!entry) return;
  bus.publish({
    type: 'history.updated',
    entry: entry as JsonRecord,
    historyType: getHistoryType(entry),
    entryId: getStringField(entry, 'id'),
    quoteId: getStringField(entry, 'quoteId'),
    operationId: getStringField(entry, 'operationId'),
    mintUrl: getStringField(entry, 'mintUrl'),
  });
}

function publishMeltUpdated(
  bus: ColadaSubscriptionBus,
  operation: MeltOperationLike | unknown
): void {
  const entry = meltOperationToScreenActionEntry(operation as unknown as MeltOperationLike);
  const operationRecord = asEntryRecord(operation);
  const operationId = getStringField(operationRecord, 'id');
  const mintUrl = getStringField(operationRecord, 'mintUrl');
  const state = getStringField(operationRecord, 'state');
  if (!entry) {
    bus.publish({
      type: 'melt.updated',
      entry: {
        type: 'melt',
        ...(operationId ? { operationId } : {}),
        ...(state ? { state } : {}),
      },
      operationId,
      mintUrl,
    });
    return;
  }
  bus.publish({
    type: 'melt.updated',
    entry: entry as JsonRecord,
    entryId: getStringField(entry, 'id'),
    quoteId: getStringField(entry, 'quoteId'),
    operationId: getStringField(entry, 'operationId') ?? operationId,
    mintUrl: getStringField(entry, 'mintUrl') ?? mintUrl,
  });
}

function subscriptionEventToEntryUpdate(
  screenType: ScreenType,
  event: ColadaSubscriptionEvent
): EntryRecord | null {
  const expectedHistoryType = HISTORY_TYPE_BY_SCREEN[screenType];

  if (event.type === 'history.updated') {
    if (expectedHistoryType !== undefined && event.historyType !== expectedHistoryType) return null;
    paymentLog.info('send.entry_updated', {
      screenType,
      type: event.historyType,
      id: event.entryId,
      state: event.entry.state,
      quoteId: event.quoteId,
    });
    return event.entry as EntryRecord;
  }

  if (screenType === 'meltQuote' && event.type === 'melt.updated') {
    return event.entry as EntryRecord;
  }

  if (screenType === 'mintQuote' && event.type === 'mint.updated') {
    return event.entry as EntryRecord;
  }

  if (screenType === 'receive' && event.type === 'receive.npcMintChanged') {
    return { _npcMintUpdate: true, mintUrl: event.mintUrl ?? undefined };
  }

  if (screenType === 'receive' && event.type === 'receive.p2pkKeyChanged') {
    return { _p2pkKeyUpdate: true, p2pkKey: event.p2pkKey };
  }

  if (screenType === 'mintInfo' && event.type === 'mintInfo.enrichmentChanged') {
    return { _mintEnrichment: true };
  }

  if (screenType === 'mintInfo' && event.type === 'mintInfo.fetched') {
    return { _mintInfoFetched: true, ...event.entry };
  }

  if (screenType === 'mintSelector' && event.type === 'mintSelector.itemAdded') {
    return { _mintItemAdded: true, _newMintItem: event.item };
  }

  return null;
}

export function getSovranMintEnrichment(mintUrl: string): Partial<MintReviewInfo> {
  const normalized = normalizeMintUrlKey(mintUrl);
  const meta = useMintMetadataStore.getState().getCached(normalized);

  const enrichment: Partial<MintReviewInfo> = {};
  if (!meta) return enrichment;

  if (meta.averageScore != null) enrichment.kymScore = meta.averageScore;
  if (meta.reviewCount != null) enrichment.reviewCount = meta.reviewCount;

  if (meta.contactFollowers != null) enrichment.contactFollowers = meta.contactFollowers;
  if (typeof meta.contactReputation === 'number') {
    enrichment.contactReputation = Math.round(meta.contactReputation);
  }

  // Swap-derived metrics need the raw auditor blob, which the store keeps.
  if (meta.auditData) {
    const swaps = meta.auditData.swaps ?? [];
    const swapSuccess = swaps.reduce((acc, swap) => acc + (swap.state === 'OK' ? 1 : 0), 0);
    const swapTotal = swaps.length;
    const successRate = swapTotal > 0 ? swapSuccess / swapTotal : undefined;
    const successfulTimes = swaps
      .filter((swap) => swap.state === 'OK' && typeof swap.time_taken === 'number')
      .map((swap) => swap.time_taken)
      .filter((time) => time > 0);

    enrichment.auditScore = typeof successRate === 'number' ? successRate * 5 : undefined;
    enrichment.auditState = meta.auditData.state;
    enrichment.successRate = successRate;
    enrichment.swapSuccess = swapSuccess;
    enrichment.swapTotal = swapTotal;
    enrichment.totalMints = meta.auditData.n_mints;
    enrichment.totalMelts = meta.auditData.n_melts;
    enrichment.avgTimeMs =
      successfulTimes.length > 0
        ? successfulTimes.reduce((sum, time) => sum + time, 0) / successfulTimes.length
        : undefined;
  } else if (meta.auditState !== undefined || meta.auditScore != null) {
    // Discover-seeded entries carry audit scalars but not the raw `swaps` blob —
    // surface what we have (mirrors `readCachedEntry` in getMintCatalog) so the
    // send-flow selector shows audit state for discover-only mints, not nothing.
    if (meta.auditScore != null) enrichment.auditScore = meta.auditScore;
    if (meta.auditState !== undefined) enrichment.auditState = meta.auditState;
    if (meta.nMints !== undefined) enrichment.totalMints = meta.nMints;
    if (meta.nMelts !== undefined) enrichment.totalMelts = meta.nMelts;
  }

  return enrichment;
}

export function shouldApplySovranEntryUpdate(
  current: EntryRecord | null,
  updated: EntryRecord
): boolean {
  if (!current) return false;
  if (updated._npcMintUpdate && current.type === 'receive') return true;
  if (updated._p2pkKeyUpdate && current.type === 'receive') return true;
  if (updated._mintEnrichment && typeof current.mintUrl === 'string') return true;
  if (updated._mintInfoFetched && typeof current.mintUrl === 'string') return true;
  if (updated._mintItemAdded && Array.isArray(current.items)) return true;
  return defaultShouldApply(current, updated);
}

export function applyMintItemAddedUpdate(current: EntryRecord, newItem: EntryRecord): EntryRecord {
  if (!Array.isArray(current.items)) return current;

  const exists = (current.items as EntryRecord[]).some((item) => item.mintUrl === newItem.mintUrl);
  if (exists) return current;

  const item = { ...newItem };
  const destination = typeof current.destination === 'string' ? current.destination : undefined;
  const scope = typeof current.scope === 'string' ? current.scope : undefined;
  const needsBalance =
    destination === 'paymentRequest' || destination === 'meltQuote' || destination === 'sendEcash';
  const skipBalance = !needsBalance || scope === 'selected' || scope === 'npc';

  if (!skipBalance && ((item.balance as number) ?? 0) <= 0) {
    item.status = 'disabled';
    item.reason = { code: 'NO_BALANCE', message: 'No balance' };
  }

  return { ...current, items: [...(current.items as EntryRecord[]), item] };
}

function getSourceLabel(entry: EntryRecord | null): string | null {
  const entryId = entry && typeof entry.id === 'string' ? entry.id : undefined;
  if (!entryId) return null;

  const scan = useScanHistoryStore
    .getState()
    .entries.find((item) => item.transactionId === entryId);
  const distributionKey =
    entry?.type === 'mint' && typeof entry?.quoteId === 'string'
      ? (entry.quoteId as string)
      : entryId;
  const distribution = useTransactionDistributionStore.getState().distributions[distributionKey];
  const source = scan?.source ?? distribution?.source ?? null;
  return source ? (SOURCE_LABELS[source] ?? null) : null;
}

interface CreateSovranScreenActionsBridgeConfig {
  manager: Manager;
  requestCameraPermission: () => Promise<boolean>;
  p2pkKeyRefreshedSubscribers: MutableRefObject<Set<(newKey: string | null) => void>>;
}

export function createSovranScreenActionsBridge({
  manager,
  requestCameraPermission,
  p2pkKeyRefreshedSubscribers,
}: CreateSovranScreenActionsBridgeConfig): ScreenActionsBridge {
  let mintInfoCallback: ((entry: EntryRecord) => void) | null = null;
  let mintInfoFetchingUrl: string | null = null;

  return {
    getExtraContext: () => ({
      manager,
      requestCameraPermission,
    }),
    bindSubscriptionBus: (bus) => {
      const unsubscribes: (() => void)[] = [];

      unsubscribes.push(
        manager.on('history:updated', ({ entry: updated }: { mintUrl: string; entry: unknown }) =>
          publishHistoryUpdated(bus, updated)
        )
      );

      const subscribeMeltOperation = (
        eventName:
          | 'melt-op:prepared'
          | 'melt-op:pending'
          | 'melt-op:finalized'
          | 'melt-op:rolled-back'
      ) =>
        manager.on(eventName, ({ operation }) => {
          publishMeltUpdated(bus, operation);
        });
      unsubscribes.push(subscribeMeltOperation('melt-op:prepared'));
      unsubscribes.push(subscribeMeltOperation('melt-op:pending'));
      unsubscribes.push(subscribeMeltOperation('melt-op:finalized'));
      unsubscribes.push(subscribeMeltOperation('melt-op:rolled-back'));

      unsubscribes.push(
        manager.on('mint-op:quote-state-changed', ({ quoteId, state, operation }) => {
          paymentLog.info('send.mint_quote_state_changed', {
            quoteId,
            state: state ?? null,
          });
          if (isMintQuotePaymentObserved({ state }) && quoteId) {
            useTransactionDistributionStore.getState().setDistribution(quoteId, 'displayed');
            setDistributionAnnotation(`quote:${quoteId}`, 'displayed');
            bus.publish({ type: 'screenActions.changed', reason: 'transactionDistribution' });
            paymentLog.debug('payment.mint_quote.displayed_inference.applied', {
              quoteId,
              state,
            });
          }
          bus.publish({
            type: 'mint.updated',
            entry: {
              type: 'mint',
              quoteId,
              operationId: operation.id,
              state,
              remoteState: state,
            },
            quoteId,
            operationId: operation.id,
          });
        })
      );
      unsubscribes.push(
        manager.on(
          'mint-op:finalized',
          ({ operationId }: { mintUrl: string; operationId: string }) => {
            paymentLog.info('send.mint_op_finalized', { operationId });
            bus.publish({
              type: 'mint.updated',
              entry: { type: 'mint', operationId, state: 'finalized' },
              operationId,
            });
          }
        )
      );

      unsubscribes.push(
        useNpcMintStore.subscribe(
          (state) => state.mintUrl,
          (mintUrl) => bus.publish({ type: 'receive.npcMintChanged', mintUrl: mintUrl ?? null })
        )
      );

      const p2pkSubscriber = (newKey: string | null) => {
        bus.publish({ type: 'receive.p2pkKeyChanged', p2pkKey: newKey });
      };
      p2pkKeyRefreshedSubscribers.current.add(p2pkSubscriber);
      unsubscribes.push(() => p2pkKeyRefreshedSubscribers.current.delete(p2pkSubscriber));

      const publishMintEnrichment = () =>
        bus.publish({
          type: 'mintInfo.enrichmentChanged',
          mintUrl: mintInfoFetchingUrl ?? undefined,
        });
      unsubscribes.push(
        useMintMetadataStore.subscribe((state) => state.byMintUrl, publishMintEnrichment)
      );

      unsubscribes.push(
        manager.on('mint:added', ({ mint }: { mint: { mintUrl: string } }) => {
          const mintUrl = mint.mintUrl;
          void (async () => {
            try {
              const [info, balances] = await Promise.all([
                getCachedMintInfo((u) => manager.mint.getMintInfo(u), mintUrl).catch(() => null),
                manager.wallet.balances.byMint({ mintUrls: [mintUrl] }).catch(() => ({})),
              ]);
              const balancesByMint = balances as Record<string, { total?: number } | undefined>;
              bus.publish({
                type: 'mintSelector.itemAdded',
                mintUrl,
                item: {
                  mintUrl,
                  displayName: info?.name ?? mintUrl,
                  ...(info?.icon_url ? { iconUrl: info.icon_url } : {}),
                  balance: balancesByMint[mintUrl]?.total ?? 0,
                  unit: 'sat',
                  status: 'available',
                  reason: null,
                  isPreferred: false,
                },
              });
            } catch {
              bus.publish({
                type: 'mintSelector.itemAdded',
                mintUrl,
                item: {
                  mintUrl,
                  displayName: mintUrl,
                  balance: 0,
                  unit: 'sat',
                  status: 'available',
                  reason: null,
                  isPreferred: false,
                },
              });
            }
          })();
        })
      );

      unsubscribes.push(
        useScanHistoryStore.subscribe(
          (state) => state.entries,
          () => bus.publish({ type: 'screenActions.changed', reason: 'scanHistory' })
        )
      );
      unsubscribes.push(
        useTransactionDistributionStore.subscribe(
          (state) => state.distributions,
          () => bus.publish({ type: 'screenActions.changed', reason: 'transactionDistribution' })
        )
      );
      unsubscribes.push(
        useSettingsStore.subscribe(
          (state) => state.language,
          () => bus.publish({ type: 'screenActions.changed', reason: 'settings' })
        )
      );

      return () => {
        unsubscribes.forEach((unsubscribe) => unsubscribe());
      };
    },
    subscribeEntryUpdates: (screenType, callback, bus) => {
      const unsubscribes: (() => void)[] = [];

      if (screenType === 'mintInfo') {
        mintInfoCallback = callback;
        callback({ _mintEnrichment: true });
        unsubscribes.push(() => {
          mintInfoCallback = null;
          mintInfoFetchingUrl = null;
        });
      }

      const eventTypesByScreen: Partial<Record<ScreenType, ColadaSubscriptionEvent['type'][]>> = {
        meltQuote: ['history.updated', 'melt.updated'],
        mintQuote: ['history.updated', 'mint.updated'],
        paymentRequest: ['history.updated'],
        receive: ['history.updated', 'receive.npcMintChanged', 'receive.p2pkKeyChanged'],
        receiveToken: ['history.updated'],
        sendToken: ['history.updated'],
        mintInfo: ['mintInfo.enrichmentChanged', 'mintInfo.fetched'],
        mintSelector: ['mintSelector.itemAdded'],
      };

      const types = eventTypesByScreen[screenType];
      if (!types) return () => {};

      unsubscribes.push(
        bus.subscribe({ type: types }, (event) => {
          const update = subscriptionEventToEntryUpdate(screenType, event);
          if (update) callback(update);
        })
      );

      return () => {
        unsubscribes.forEach((unsubscribe) => unsubscribe());
      };
    },
    shouldApplyEntryUpdate: shouldApplySovranEntryUpdate,
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
        const enrichment = getSovranMintEnrichment(current.mintUrl);
        const merged = { ...current, ...enrichment };
        const mintUrl = current.mintUrl;

        if (
          !current.displayName &&
          !current._mintInfoFetched &&
          mintInfoCallback &&
          mintInfoFetchingUrl !== mintUrl
        ) {
          mintInfoFetchingUrl = mintUrl;
          const cb = mintInfoCallback;
          void (async () => {
            try {
              const [mintInfo, isTrusted] = await Promise.all([
                getCachedMintInfo((u) => manager.mint.getMintInfo(u), mintUrl).catch(
                  () => undefined
                ),
                manager.mint.isTrustedMint(mintUrl).catch(() => false),
              ]);
              cb({
                _mintInfoFetched: true,
                displayName: mintInfo?.name ?? mintUrl,
                iconUrl: mintInfo?.icon_url,
                description: mintInfo?.description,
                longDescription: mintInfo?.description_long,
                motd: mintInfo?.motd,
                contact: mintInfo?.contact,
                isTrusted,
              });
            } catch (error) {
              paymentLog.warn('send.mint_info_fetch_failed', {
                ...mintUrlLogFields(mintUrl),
                error: error instanceof Error ? error : new Error(String(error)),
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
        return applyMintItemAddedUpdate(current, updated._newMintItem as EntryRecord);
      }
      return defaultMerge(current, updated);
    },
    getLocale: () => useSettingsStore.getState().language || 'en',
    getSourceLabel,
  };
}
