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

  describe('a store whose fields are independent', () => {
    const settings = z.object({
      count: z.number().int().nonnegative(),
      label: z.string(),
      nested: z.object({ on: z.boolean() }).default({ on: false }),
    });
    const current = { count: 0, label: 'default', nested: { on: false }, act: jest.fn() };

    it('keeps the fields that parse when one does not', () => {
      const onRejected = jest.fn();
      const merge = createMergeWithSchema('example', settings, {
        independentFields: true,
        onRejected,
      });

      const result = merge({ count: -1, label: 'saved', nested: { on: true } }, current);

      expect(result).toEqual({ ...current, label: 'saved', nested: { on: true } });
      expect(result.act).toBe(current.act);
      // Still reported as turned down, so the original bytes are copied aside.
      expect(onRejected).toHaveBeenCalledTimes(1);
    });

    it('leaves an absent field on its default and ignores fields the schema does not know', () => {
      const merge = createMergeWithSchema('example', settings, { independentFields: true });

      const result = merge({ count: 'seven', label: 'saved', stray: 1 }, current);

      expect(result).toEqual({ ...current, label: 'saved' });
    });

    it('is all or nothing unless the store asks otherwise', () => {
      const onRejected = jest.fn();
      const merge = createMergeWithSchema('example', settings, { onRejected });

      expect(merge({ count: -1, label: 'saved' }, current)).toBe(current);
      expect(onRejected).toHaveBeenCalledTimes(1);
    });

    it('does not call onRejected for a blob that parses', () => {
      const onRejected = jest.fn();
      const merge = createMergeWithSchema('example', settings, {
        independentFields: true,
        onRejected,
      });

      merge({ count: 1, label: 'saved' }, current);

      expect(onRejected).not.toHaveBeenCalled();
    });
  });
});
