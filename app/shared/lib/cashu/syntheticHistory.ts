import type {
  HistoryEntry,
  LegacyMeltHistoryEntry,
  LegacyMintHistoryEntry,
  LegacyReceiveHistoryEntry,
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

export type SyntheticMintHistoryEntry = WithNumericAmount<LegacyMintHistoryEntry>;
export type SyntheticMeltHistoryEntry = WithNumericAmount<LegacyMeltHistoryEntry>;
export type SyntheticReceiveHistoryEntry = WithNumericAmount<LegacyReceiveHistoryEntry>;

/**
 * The field relaxations the app's read-model boundaries actually produce on
 * an otherwise-shaped `HistoryEntry` variant (operation or legacy family):
 *
 * - `amount` — a plain number: colada's `normalizeHistoryEntry` downcasts the
 *   coco `Amount` object at every boundary a raw entry crosses.
 * - `createdAt`/`updatedAt` — colada's `decorateEntry` wraps the epoch number
 *   in a `FormattedTimestamp` (a `Number` subclass with formatting getters),
 *   so screen entries read `createdAt.datetime` rather than a bare number.
 * - `state` — normalized to the legacy contract vocabulary
 *   (`normalizeContractState`), so the operation-family unions don't hold.
 *
 * Everything else (variant discriminants, ids, mint/unit/metadata) must match
 * the real coco shape — that is what keeps this a bridge and not a blank cast.
 */
type RelaxedHistoryEntry<E> = E extends { amount: unknown }
  ? Omit<E, 'amount' | 'createdAt' | 'updatedAt' | 'state'> & {
      amount: number | HistoryEntry['amount'];
      createdAt: number | { datetime: string };
      updatedAt?: unknown;
      state: string;
    }
  : never;

type SyntheticHistoryEntry = RelaxedHistoryEntry<HistoryEntry>;

export function asHistoryEntry(entry: SyntheticHistoryEntry): HistoryEntry {
  // The single sanctioned bridge for the relaxations documented on
  // RelaxedHistoryEntry; call sites must not cast.
  // ast-grep-ignore: double-assertion-ts
  return entry as unknown as HistoryEntry;
}
