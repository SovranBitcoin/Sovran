import type { HistoryEntry } from '@cashu/coco-core';

type EntryRecord = Record<string, unknown>;

function getMetadata(entry: HistoryEntry | null | undefined): EntryRecord | undefined {
  const metadata = (entry as EntryRecord | null | undefined)?.metadata;
  return metadata && typeof metadata === 'object' ? (metadata as EntryRecord) : undefined;
}

export function getOnchainMeltAddress(entry: HistoryEntry | null | undefined): string | null {
  if (!entry || entry.type !== 'melt') return null;

  const metadata = getMetadata(entry);
  if (!metadata) return null;

  const method = metadata.method ?? metadata.meltQuoteMethod ?? metadata.paymentMethod;
  if (method !== 'onchain') return null;

  const target = metadata.onchainAddress ?? metadata.meltTarget ?? metadata.destination;
  return typeof target === 'string' && target.trim() ? target.trim() : null;
}
