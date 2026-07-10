/**
 * @jest-environment node
 */

import { z } from 'zod';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

const mockWarn = jest.fn();

jest.mock('@/shared/lib/logger', () => ({
  log: { warn: (...args: unknown[]) => mockWarn(...args) },
}));

const schema = z.looseObject({
  count: z.number().int().nonnegative(),
  label: z.string(),
});

describe('createMergeWithSchema', () => {
  beforeEach(() => {
    mockWarn.mockReset();
  });

  it('merges validated persisted data over current state without replacing actions', () => {
    const increment = jest.fn();
    const current = { count: 0, label: 'current', increment };
    const merge = createMergeWithSchema('example', schema);

    const result = merge({ count: 3, label: 'persisted' }, current);

    expect(result).toEqual({ count: 3, label: 'persisted', increment });
    expect(result.increment).toBe(increment);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('returns the current object unchanged and logs once when validation fails', () => {
    const current = { count: 0, label: 'current', increment: jest.fn() };
    const merge = createMergeWithSchema('example', schema);

    const result = merge({ count: -1, label: 'persisted' }, current);

    expect(result).toBe(current);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      'store.example.merge_rejected',
      expect.objectContaining({ issues: expect.anything() })
    );
  });

  it.each([null, undefined, 'serialized', 42])(
    'returns current unchanged for non-object persisted value %p',
    (persisted) => {
      const current = { count: 0, label: 'current', increment: jest.fn() };
      const merge = createMergeWithSchema('example', schema);

      expect(merge(persisted, current)).toBe(current);
      expect(mockWarn).not.toHaveBeenCalled();
    }
  );
});
