import { spendingConditionDetailItems } from '@/features/send/components/SpendingConditionsCard';

jest.mock('@/shared/ui/composed/DetailsSection', () => ({ DetailsSection: () => null }));
jest.mock('@/shared/ui/composed/MiddleEllipsisValue', () => ({ MiddleEllipsisValue: () => null }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: () => null }));
jest.mock('@/shared/lib/date', () => ({ formatDate: () => 'a date' }));
jest.mock('@/features/send/lib/spendingConditionsCopy', () => ({}));

describe('spendingConditionDetailItems', () => {
  it('gives every key its own title, so the Details page drops none of them', () => {
    // The Details page keeps the first row of each title. Three keys under
    // "Locked to", "Or to", "Or to" showed two.
    const keys = ['02aa', '02bb', '02cc', '02dd'];
    // Only the fields the rows read.
    const conditions = {
      kind: 'p2pk',
      main: { pubkeys: keys, requiredSignatures: 1 },
      refund: { pubkeys: keys, requiredSignatures: 1 },
      unlockAt: 1_800_000_000,
      unknownTags: [],
      limits: [],
      proofCount: 1,
      lockedProofCount: 1,
    };
    const rows = spendingConditionDetailItems(conditions as never).filter(Boolean) as {
      title: string;
    }[];
    const titles = rows.map((row) => row.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.filter((title) => /^(Locked to|Or to)/.test(title))).toHaveLength(4);
    expect(titles.filter((title) => /^(Can be reclaimed by|Or by)/.test(title))).toHaveLength(4);
  });
});
