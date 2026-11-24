/**
 * @fileoverview What a Search query is, before it is searched for.
 *
 * A pasted invoice, ecash token, payment request, `bitcoin:` link, npub,
 * Lightning address or mint address is something to act on, not a name to
 * look up. Colada's parser decides which (`parsePaymentInput` +
 * `describeDestination`, the same pair the Send screen's detected-action row
 * uses), so Search adds no parser of its own.
 *
 * The answer also decides what may leave the phone. A payment string is never
 * sent to the remote people search or kept in recent searches: an ecash token
 * is money, and an invoice says who is paying whom. A pairing secret
 * (`nostrconnect://`, `bunker://`) or a private key (`nsec1…`) gets no action
 * at all, and is likewise never searched, saved or logged.
 */
import {
  describeDestination,
  parsePaymentInput,
  type DestinationDescriptor,
  type Detectors,
  type WalletContext,
} from 'wallet';

import { hasFeature, type Feature } from '@/shared/config/features';
import { isSensitiveScanInput } from '@/shared/stores/profile/scanHistoryStore';

export type SearchQueryKind =
  /** Nothing typed. */
  | { kind: 'empty' }
  /** A secret: no action, never searched, saved or logged. */
  | { kind: 'sensitive' }
  /** Something to pay, claim or open; shown as the action card. */
  | { kind: 'payment'; descriptor: DestinationDescriptor }
  /** Words to look up in people, mints and places. */
  | { kind: 'text'; query: string };

/**
 * Classify the trimmed query. Text with whitespace is always a name search,
 * the same rule the Send screen applies to its destination field.
 */
export function classifySearchQuery(
  rawQuery: string,
  detectors: Detectors,
  walletContext?: WalletContext
): SearchQueryKind {
  const query = rawQuery.trim();
  if (!query) return { kind: 'empty' };
  // Before any parse or log: the secret must not travel further than this.
  if (isSensitiveScanInput(query)) return { kind: 'sensitive' };
  if (/\s/.test(query)) return { kind: 'text', query };
  const descriptor = describeDestination(
    parsePaymentInput(query, detectors),
    detectors,
    walletContext
  );
  if (descriptor.kind === 'unsupported') return { kind: 'text', query };
  return { kind: 'payment', descriptor };
}

/**
 * The text the remote people search may send for this query, or `''` when the
 * query must stay on the phone or the build ships no people search.
 */
export function remoteSearchText(
  kind: SearchQueryKind,
  enabled: (feature: Feature) => boolean = hasFeature
): string {
  if (!enabled('nostrSearch')) return '';
  return kind.kind === 'text' ? kind.query : '';
}

/** Whether a settled query may be kept in recent searches. */
export function isRecordableSearch(kind: SearchQueryKind): boolean {
  return kind.kind === 'text';
}
