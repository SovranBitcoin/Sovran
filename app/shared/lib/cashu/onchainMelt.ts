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

/**
 * Rank of an onchain melt state along the UNPAID → PENDING → PAID progression.
 * Accepts BOTH vocabularies the timeline understands: the melt-quote state
 * (`UNPAID`/`PENDING`/`PAID`) and the coco operation/history state
 * (`prepared`/`executing`/`pending`/`finalized`). `-1` = unknown.
 */
const ONCHAIN_MELT_STATE_RANK: Record<string, number> = {
  unpaid: 0,
  prepared: 0,
  pending: 1,
  executing: 1,
  paid: 2,
  finalized: 2,
};

function isRolledBackMeltState(state: string | null | undefined): boolean {
  return state === 'rolledBack' || state === 'rolled_back' || state === 'failed';
}

function onchainMeltStateRank(state: string | null | undefined): number {
  if (state == null) return -1;
  const rank = ONCHAIN_MELT_STATE_RANK[state.toLowerCase()];
  return rank == null ? -1 : rank;
}

/**
 * The onchain-send timeline state, taking the MOST-ADVANCED of the polled
 * melt-quote row state and the live history-entry (operation) state.
 *
 * Why not a blind `quoteState ?? entryState`: `manager.quotes.melt.get` reads a
 * LOCAL, never-self-refreshing row. On the synchronous-PAID path of an internal
 * (mint-settled, no-broadcast) onchain send, coco finalizes the OPERATION —
 * `entryState` advances to `finalized` — but never bumps the quote row past its
 * initial `UNPAID`. A non-null-but-stale `UNPAID` would then mask the finalized
 * entry and pin the timeline at "Paid" forever. Taking the further-along state
 * fixes that and also lets the normal broadcasting case show "Broadcasting…"
 * off the operation's `pending` before the quote row catches up.
 *
 * A rollback/failure on EITHER side wins outright — a stale quote must never
 * hide that the send was reversed.
 */
export function resolveOnchainMeltTimelineState(
  quoteState: string | null | undefined,
  entryState: string | null | undefined
): string | null {
  if (isRolledBackMeltState(entryState)) return entryState ?? null;
  if (isRolledBackMeltState(quoteState)) return quoteState ?? null;

  const quoteRank = onchainMeltStateRank(quoteState);
  const entryRank = onchainMeltStateRank(entryState);
  const resolved =
    entryRank > quoteRank
      ? entryState
      : quoteRank > entryRank
        ? quoteState
        : (quoteState ?? entryState ?? null);

  cashuLog.debug('onchain.melt.timelineState.result', {
    quoteState: quoteState ?? null,
    entryState: entryState ?? null,
    quoteRank,
    entryRank,
    resolved: resolved ?? null,
  });
  return resolved ?? null;
}

/** Whether an onchain melt state (quote or operation vocabulary) is settled. */
export function isOnchainMeltSettled(state: string | null | undefined): boolean {
  return onchainMeltStateRank(state) === 2;
}

/** Default target confirmations for an onchain SEND timeline. */
export const DEFAULT_ONCHAIN_MELT_CONFIRMATIONS = 6;

function getPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Confirmations to display as the target for an onchain SEND. Mints publish an
 * onchain confirmation count on their NUT-05 (melt) onchain method settings
 * (`nuts['5'].methods[].options.confirmations`) — rarely present today, so this
 * falls back to a sensible default of 6. Mirrors the receive-side
 * `getOnchainRequiredConfirmations` (which reads NUT-04).
 */
export function getOnchainMeltRequiredConfirmations(mintInfo: unknown, unit = 'sat'): number {
  const info = mintInfo && typeof mintInfo === 'object' ? (mintInfo as EntryRecord) : null;
  const nuts = info?.nuts && typeof info.nuts === 'object' ? (info.nuts as EntryRecord) : null;
  const nut05 = nuts?.['5'] && typeof nuts['5'] === 'object' ? (nuts['5'] as EntryRecord) : null;
  const methods = Array.isArray(nut05?.methods) ? nut05.methods : [];
  for (const method of methods) {
    if (!method || typeof method !== 'object') continue;
    const methodRecord = method as EntryRecord;
    if (methodRecord.method !== 'onchain') continue;
    if (typeof methodRecord.unit === 'string' && methodRecord.unit.toLowerCase() !== unit) continue;
    const options =
      methodRecord.options && typeof methodRecord.options === 'object'
        ? (methodRecord.options as EntryRecord)
        : null;
    const confirmations = getPositiveInteger(options?.confirmations);
    if (confirmations != null) {
      cashuLog.debug('onchain.melt.required_confirmations.result', {
        unit,
        source: 'nut05.method.options.confirmations',
        confirmations,
      });
      return confirmations;
    }
  }
  cashuLog.debug('onchain.melt.required_confirmations.result', {
    unit,
    source: 'default',
    confirmations: DEFAULT_ONCHAIN_MELT_CONFIRMATIONS,
  });
  return DEFAULT_ONCHAIN_MELT_CONFIRMATIONS;
}
