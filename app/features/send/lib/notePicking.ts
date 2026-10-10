/**
 * The arithmetic of picking notes: which denominations the wallet holds, how
 * many of each are picked, and what they add up to. A picked set is always an
 * amount the wallet holds exactly, which is what lets it leave with no mint.
 *
 * Pure: no hooks, no I/O.
 */

export interface NoteDenomination {
  value: number;
  /** How many notes of this value the wallet holds. */
  held: number;
}

/** Picked count per denomination value. A missing value means none. */
export type NotePick = Readonly<Record<number, number>>;

/** The denominations held, largest first. */
export function groupNotes(notes: readonly number[]): NoteDenomination[] {
  const held = new Map<number, number>();
  for (const value of notes) {
    if (value > 0) held.set(value, (held.get(value) ?? 0) + 1);
  }
  return [...held.entries()]
    .map(([value, count]) => ({ value, held: count }))
    .sort((a, b) => b.value - a.value);
}

export function pickTotal(pick: NotePick): number {
  return Object.entries(pick).reduce((sum, [value, count]) => sum + Number(value) * count, 0);
}

export function pickCount(pick: NotePick): number {
  return Object.values(pick).reduce((sum, count) => sum + count, 0);
}

/** `pick` with one more or one fewer of `value`, kept within what is held. */
export function stepPick(pick: NotePick, denomination: NoteDenomination, delta: 1 | -1): NotePick {
  const next = Math.max(0, Math.min(denomination.held, (pick[denomination.value] ?? 0) + delta));
  return { ...pick, [denomination.value]: next };
}

/** How much of the search a pick may cost before it gives up. */
const SEARCH_BUDGET = 20_000;

/**
 * The notes that make `amount` exactly, or nothing when no set of held notes
 * does. Prefers large notes, so the pick is the fewest notes that work.
 *
 * Opening the picker on an amount the wallet already holds shows which notes
 * it is; any other amount starts empty rather than showing a near miss the
 * sender did not ask for. Largest-first alone is not enough: holding 6, 4 and
 * 4, an amount of 8 is the two fours, which taking the 6 first never finds.
 * So it backtracks, bounded by `SEARCH_BUDGET`.
 */
export function pickFor(denominations: readonly NoteDenomination[], amount: number): NotePick {
  if (amount <= 0) return {};
  // What the denominations from each index onward can still add up to: a
  // branch that cannot reach the amount even by taking all of them is dead.
  const reach: number[] = new Array(denominations.length + 1).fill(0);
  for (let i = denominations.length - 1; i >= 0; i--) {
    const { value, held } = denominations[i]!;
    reach[i] = reach[i + 1]! + value * held;
  }
  let budget = SEARCH_BUDGET;
  const pick: Record<number, number> = {};

  const search = (index: number, remaining: number): boolean => {
    if (remaining === 0) return true;
    if (index >= denominations.length || reach[index]! < remaining || budget-- <= 0) return false;
    const { value, held } = denominations[index]!;
    for (let take = Math.min(held, Math.floor(remaining / value)); take >= 0; take--) {
      if (take > 0) pick[value] = take;
      else delete pick[value];
      if (search(index + 1, remaining - take * value)) return true;
    }
    delete pick[value];
    return false;
  };

  return search(0, amount) ? pick : {};
}

/**
 * The next amount the held notes can make, below or above `total`, with the
 * notes that make it. Null at either end: nothing below nothing, nothing
 * above everything. `nearest` is the wallet's own subset-sum search
 * (`composeSatoshis`), handed in so this stays pure.
 */
export function stepTotal(
  denominations: readonly NoteDenomination[],
  total: number,
  direction: 1 | -1,
  nearest: (target: number) => { exactMatch: boolean; lower: number | null; upper: number | null }
): { total: number; pick: NotePick } | null {
  const held = denominations.reduce((sum, { value, held: count }) => sum + value * count, 0);
  const target = total + direction;
  if (target <= 0) return total > 0 ? { total: 0, pick: {} } : null;
  if (target > held) return null;
  const found = nearest(target);
  const next = found.exactMatch ? target : direction > 0 ? found.upper : found.lower;
  if (next === null || next <= 0) return direction < 0 && total > 0 ? { total: 0, pick: {} } : null;
  if (direction > 0 ? next <= total : next >= total) return null;
  const pick = pickFor(denominations, next);
  return pickTotal(pick) === next ? { total: next, pick } : null;
}
