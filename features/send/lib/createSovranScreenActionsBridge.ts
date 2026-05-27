import type { MutableRefObject } from 'react';

import type { Manager, MeltOperationLike, MintReviewInfo, ScreenType } from 'colada';
import {
  meltOperationToScreenActionEntry,
  mergeEntryUpdate as defaultMerge,
  shouldApplyEntryUpdate as defaultShouldApply,
} from 'colada';
import type { ScreenActionsBridge } from 'colada/react';

import { paymentLog } from '@/shared/lib/logger';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useAuditMintStore } from '@/shared/stores/global/auditMintStore';
import { useKYMMintStore } from '@/shared/stores/global/kymMintStore';
import { getCachedMintInfo } from '@/shared/stores/global/mintInfoCache';
import { useMintProfileStore } from '@/shared/stores/global/mintProfileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { useTransactionDistributionStore } from '@/shared/stores/profile/transactionDistributionStore';

type EntryRecord = Record<string, unknown>;

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

export function getSovranMintEnrichment(mintUrl: string): Partial<MintReviewInfo> {
  const normalized = normalizeMintUrlKey(mintUrl);
  const audit = useAuditMintStore.getState().getCached(normalized);
  const kym = useKYMMintStore.getState().getCached(normalized);

  const enrichment: Partial<MintReviewInfo> = {};
  if (kym) {
    enrichment.kymScore = kym.score;
    enrichment.reviewCount = kym.recommendations?.length;
  }

  const profile = useMintProfileStore.getState().getCached(normalized);
  if (profile) {
    enrichment.contactFollowers = profile.followers;
    if (typeof profile.reputation === 'number') {
      enrichment.contactReputation = Math.round(profile.reputation);
    }
  }

  if (audit) {
    const swaps = audit.auditData.swaps ?? [];
    const swapSuccess = swaps.reduce((acc, swap) => acc + (swap.state === 'OK' ? 1 : 0), 0);
    const swapTotal = swaps.length;
    const successRate = swapTotal > 0 ? swapSuccess / swapTotal : undefined;
    const successfulTimes = swaps
      .filter((swap) => swap.state === 'OK' && typeof swap.time_taken === 'number')
      .map((swap) => swap.time_taken)
      .filter((time) => time > 0);

    enrichment.auditScore = typeof successRate === 'number' ? successRate * 5 : undefined;
    enrichment.auditState = audit.auditData.state;
    enrichment.successRate = successRate;
    enrichment.swapSuccess = swapSuccess;
    enrichment.swapTotal = swapTotal;
    enrichment.totalMints = audit.auditData.n_mints;
    enrichment.totalMelts = audit.auditData.n_melts;
    enrichment.avgTimeMs =
      successfulTimes.length > 0
        ? successfulTimes.reduce((sum, time) => sum + time, 0) / successfulTimes.length
        : undefined;
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
    onEntryUpdate: (screenType, callback) => {
      const unsubscribes: (() => void)[] = [];
      const expectedHistoryType = HISTORY_TYPE_BY_SCREEN[screenType];

      if (expectedHistoryType !== undefined) {
        unsubscribes.push(
          manager.on(
            'history:updated',
            ({ entry: updated }: { mintUrl: string; entry: unknown }) => {
              const updatedRecord =
                typeof updated === 'object' && updated !== null ? (updated as EntryRecord) : null;
              if (updatedRecord?.type !== expectedHistoryType) return;
              paymentLog.info('send.entry_updated', {
                screenType,
                type: updatedRecord.type,
                id: updatedRecord.id,
                state: updatedRecord.state,
                quoteId: updatedRecord.quoteId,
              });
              callback(updatedRecord);
            }
          )
        );
      }

      if (screenType === 'meltQuote') {
        const subscribeMeltOperation = (
          eventName: 'melt-op:prepared' | 'melt-op:pending' | 'melt-op:finalized'
        ) =>
          manager.on(eventName, ({ operation }) => {
            const updatedEntry = meltOperationToScreenActionEntry(
              operation as unknown as MeltOperationLike
            );
            if (updatedEntry) callback(updatedEntry);
          });
        unsubscribes.push(subscribeMeltOperation('melt-op:prepared'));
        unsubscribes.push(subscribeMeltOperation('melt-op:pending'));
        unsubscribes.push(subscribeMeltOperation('melt-op:finalized'));
      }

      if (screenType === 'mintQuote') {
        unsubscribes.push(
          manager.on('mint-op:quote-state-changed', ({ quoteId, state, operation }) => {
            paymentLog.info('send.mint_quote_state_changed', {
              screenType,
              quoteId,
              state: state ?? null,
            });
            callback({
              type: 'mint',
              quoteId,
              operationId: operation.id,
              state,
              remoteState: state,
            });
          })
        );
        unsubscribes.push(
          manager.on(
            'mint-op:finalized',
            ({ operationId }: { mintUrl: string; operationId: string }) => {
              paymentLog.info('send.mint_op_finalized', { screenType, operationId });
              callback({ type: 'mint', operationId, state: 'finalized' });
            }
          )
        );
      }

      if (screenType === 'receive') {
        unsubscribes.push(
          useNpcMintStore.subscribe(
            (state) => state.mintUrl,
            () => callback({ _npcMintUpdate: true })
          )
        );
        const subscriber = (newKey: string | null) => {
          callback({ _p2pkKeyUpdate: true, p2pkKey: newKey });
        };
        p2pkKeyRefreshedSubscribers.current.add(subscriber);
        unsubscribes.push(() => p2pkKeyRefreshedSubscribers.current.delete(subscriber));
      }

      if (screenType === 'mintInfo') {
        const pushEnrichment = () => callback({ _mintEnrichment: true });
        const cacheSliceForCurrentMint = <T>(cache: Record<string, T>): T | undefined =>
          mintInfoFetchingUrl ? cache[mintInfoFetchingUrl] : undefined;

        unsubscribes.push(
          useAuditMintStore.subscribe(
            (state) => cacheSliceForCurrentMint(state.cache),
            pushEnrichment
          )
        );
        unsubscribes.push(
          useKYMMintStore.subscribe(
            (state) => cacheSliceForCurrentMint(state.cache),
            pushEnrichment
          )
        );
        unsubscribes.push(
          useMintProfileStore.subscribe(
            (state) => cacheSliceForCurrentMint(state.cache),
            pushEnrichment
          )
        );

        mintInfoCallback = callback;
        unsubscribes.push(() => {
          mintInfoCallback = null;
          mintInfoFetchingUrl = null;
        });
        pushEnrichment();
      }

      if (screenType === 'mintSelector') {
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
                callback({
                  _mintItemAdded: true,
                  _newMintItem: {
                    mintUrl,
                    displayName: info?.name ?? mintUrl,
                    iconUrl: info?.icon_url,
                    balance: balancesByMint[mintUrl]?.total ?? 0,
                    unit: 'sat',
                    status: 'available',
                    reason: null,
                    isPreferred: false,
                  },
                });
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
                });
              }
            })();
          })
        );
      }

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
                mintUrl,
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
    subscribeGlobalScreenActions: (listener) => {
      const unScan = useScanHistoryStore.subscribe((state) => state.entries, listener);
      const unDistribution = useTransactionDistributionStore.subscribe(
        (state) => state.distributions,
        listener
      );
      const unSettings = useSettingsStore.subscribe((state) => state.language, listener);
      return () => {
        unScan();
        unDistribution();
        unSettings();
      };
    },
    getSourceLabel,
  };
}
