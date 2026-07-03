/**
 * @fileoverview Month helpers for the transactions timeline.
 *
 * The month pills, the list sections, and the viewport tracker all key months
 * as zero-padded "YYYY-MM" strings so they compare lexicographically in
 * chronological order.
 */

export interface MonthItem {
  key: string;
  label: string;
  fullLabel: string;
  year: number;
  month: number;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthKeyOf(createdAt: number): string {
  const date = new Date(createdAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthItemFromKey(key: string): MonthItem | null {
  const [yearStr, monthStr] = key.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) return null;
  return {
    key,
    label: MONTH_NAMES[month],
    fullLabel: `${MONTH_NAMES[month]} ${year}`,
    year,
    month,
  };
}

/** Dedupes month keys and returns MonthItems sorted newest-first. */
export function monthItemsFromKeys(keys: Iterable<string>): MonthItem[] {
  const unique = Array.from(new Set(keys));
  const items = unique.map(monthItemFromKey).filter((item): item is MonthItem => item !== null);
  return items.sort((a, b) => (a.year !== b.year ? b.year - a.year : b.month - a.month));
}

/**
 * Index of the first section (in display order) belonging to `monthKey`.
 *
 * `sections` is NOT assumed chronological: the All tab concatenates
 * pending → confirmed → expired blocks, so an old stuck-pending section can
 * precede newer confirmed ones. The fallback therefore compares month VALUES
 * (nearest older month, i.e. the largest key below the requested one) rather
 * than trusting array order. Returns -1 only when `sections` is empty.
 */
export function findScrollIndexForMonth(
  sections: readonly { monthKey: string }[],
  monthKey: string
): number {
  const exact = sections.findIndex((section) => section.monthKey === monthKey);
  if (exact >= 0) return exact;

  let best = -1;
  for (let i = 0; i < sections.length; i++) {
    const key = sections[i].monthKey;
    if (key >= monthKey) continue;
    if (best === -1 || key > sections[best].monthKey) best = i;
  }
  if (best >= 0) return best;
  return sections.length - 1;
}
