import type { HistoryEntry } from '@cashu/coco-core';

import { cashuLog } from '@/shared/lib/logger';

type EntryRecord = Record<string, unknown>;

function getMetadata(entry: HistoryEntry | null | undefined): EntryRecord | undefined {
  const metadata = (entry as EntryRecord | null | undefined)?.metadata;
  return metadata && typeof metadata === 'object' ? (metadata as EntryRecord) : undefined;
}

export function getOnchainMeltAddress(entry: HistoryEntry | null | undefined): string | null {
  if (!entry || entry.type !== 'melt') {
    cashuLog.debug('onchain.melt.address.result', {
      reason: !entry ? 'missing-entry' : 'wrong-type',
      type: entry?.type ?? null,
    });
    return null;
  }

  const metadata = getMetadata(entry);
  if (!metadata) {
    cashuLog.debug('onchain.melt.address.result', {
      reason: 'missing-metadata',
      type: entry.type,
      state: typeof (entry as EntryRecord).state === 'string' ? (entry as EntryRecord).state : null,
    });
    return null;
  }

  const method = metadata.method ?? metadata.meltQuoteMethod ?? metadata.paymentMethod;
  if (method !== 'onchain') {
    cashuLog.debug('onchain.melt.address.result', {
      reason: 'not-onchain',
      type: entry.type,
      state: typeof (entry as EntryRecord).state === 'string' ? (entry as EntryRecord).state : null,
      method: typeof method === 'string' ? method : null,
    });
    return null;
  }

  const target = metadata.onchainAddress ?? metadata.meltTarget ?? metadata.destination;
  const address = typeof target === 'string' && target.trim() ? target.trim() : null;
  cashuLog.debug('onchain.melt.address.result', {
    reason: address ? 'metadata' : 'missing-target',
    type: entry.type,
    state: typeof (entry as EntryRecord).state === 'string' ? (entry as EntryRecord).state : null,
    targetSource:
      metadata.onchainAddress != null
        ? 'onchainAddress'
        : metadata.meltTarget != null
          ? 'meltTarget'
          : metadata.destination != null
            ? 'destination'
            : 'none',
    addressLength: address?.length ?? null,
  });
  return address;
}
