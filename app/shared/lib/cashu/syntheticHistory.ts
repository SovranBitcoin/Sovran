import type {
  HistoryEntry,
  LegacyHistoryEntry,
  LegacyMeltHistoryEntry,
  LegacyMintHistoryEntry,
  LegacyReceiveHistoryEntry,
  LegacySendHistoryEntry,
} from '@cashu/coco-core';

/**
 * App-constructed history entries (previews, poll fallbacks, mock data)
 * follow the serialization contract: plain numeric amounts. Live coco v2
 * rows carry cashu-ts `Amount` value objects instead, and every reader in
 * the app converts through `amountToNumber`, which accepts both shapes.
 *
 * These types are the legacy history variants with a numeric amount, and
 * `asHistoryEntry` is the single sanctioned bridge back into `HistoryEntry`
 * where an API demands the coco type. Never JSON.stringify a live Amount —
 * it serializes to a quoted string.
 */
type WithNumericAmount<E> = E extends { amount: unknown }
  ? Omit<E, 'amount'> & { amount: number }
  : E;

export type SyntheticHistoryEntry = WithNumericAmount<LegacyHistoryEntry>;
export type SyntheticMintHistoryEntry = WithNumericAmount<LegacyMintHistoryEntry>;
export type SyntheticMeltHistoryEntry = WithNumericAmount<LegacyMeltHistoryEntry>;
export type SyntheticSendHistoryEntry = WithNumericAmount<LegacySendHistoryEntry>;
export type SyntheticReceiveHistoryEntry = WithNumericAmount<LegacyReceiveHistoryEntry>;

export function asHistoryEntry(entry: SyntheticHistoryEntry): HistoryEntry {
  return entry as unknown as HistoryEntry;
}
