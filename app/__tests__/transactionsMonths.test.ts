import {
  findScrollIndexForMonth,
  monthItemFromKey,
  monthItemsFromKeys,
  monthKeyOf,
} from '@/features/transactions/lib/months';

describe('monthKeyOf', () => {
  it('zero-pads the month', () => {
    expect(monthKeyOf(new Date(2026, 0, 15).getTime())).toBe('2026-01');
    expect(monthKeyOf(new Date(2025, 11, 31).getTime())).toBe('2025-12');
  });
});

describe('monthItemFromKey', () => {
  it('builds labels from a key', () => {
    expect(monthItemFromKey('2026-07')).toEqual({
      key: '2026-07',
      label: 'July',
      fullLabel: 'July 2026',
      year: 2026,
      month: 6,
    });
  });

  it('rejects malformed keys', () => {
    expect(monthItemFromKey('2026-13')).toBeNull();
    expect(monthItemFromKey('garbage')).toBeNull();
  });
});

describe('monthItemsFromKeys', () => {
  it('dedupes and sorts newest-first', () => {
    const items = monthItemsFromKeys(['2025-12', '2026-02', '2025-12', '2026-01']);
    expect(items.map((m) => m.key)).toEqual(['2026-02', '2026-01', '2025-12']);
  });

  it('drops invalid keys', () => {
    expect(monthItemsFromKeys(['bogus', '2026-01']).map((m) => m.key)).toEqual(['2026-01']);
  });
});

describe('findScrollIndexForMonth', () => {
  const sections = [
    { monthKey: '2026-07' },
    { monthKey: '2026-07' },
    { monthKey: '2026-05' },
    { monthKey: '2026-04' },
  ];

  it('returns the first section of the requested month', () => {
    expect(findScrollIndexForMonth(sections, '2026-07')).toBe(0);
    expect(findScrollIndexForMonth(sections, '2026-05')).toBe(2);
  });

  it('falls back to the first older section when the month has no rows', () => {
    expect(findScrollIndexForMonth(sections, '2026-06')).toBe(2);
  });

  it('falls back to the last section when everything is newer', () => {
    expect(findScrollIndexForMonth(sections, '2026-01')).toBe(3);
  });

  it('returns -1 for an empty list', () => {
    expect(findScrollIndexForMonth([], '2026-07')).toBe(-1);
  });

  describe('non-chronological display order (All tab: pending block precedes confirmed)', () => {
    // An old stuck-pending section renders BEFORE newer confirmed sections.
    const allTabSections = [
      { monthKey: '2026-02' }, // pending, old
      { monthKey: '2026-07' }, // confirmed, newest
      { monthKey: '2026-06' },
      { monthKey: '2026-04' },
    ];

    it('exact match still honors display order', () => {
      expect(findScrollIndexForMonth(allTabSections, '2026-02')).toBe(0);
      expect(findScrollIndexForMonth(allTabSections, '2026-07')).toBe(1);
    });

    it('fallback picks the nearest OLDER month by value, not the first older in array order', () => {
      // Requested 2026-05: nearest older is 2026-04 (index 3), NOT the
      // pending 2026-02 that happens to appear first in the array.
      expect(findScrollIndexForMonth(allTabSections, '2026-05')).toBe(3);
      // Requested 2026-03: nearest older is 2026-02 (index 0).
      expect(findScrollIndexForMonth(allTabSections, '2026-03')).toBe(0);
    });
  });
});
