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
      count: z.number().int().nonnegative().default(7),
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

      // The bad field takes the schema's default, as a normal load would give it.
      expect(result).toEqual({ ...current, count: 7, label: 'saved', nested: { on: true } });
      expect(result.act).toBe(current.act);
      // Still reported as turned down, so the original bytes are copied aside.
      expect(onRejected).toHaveBeenCalledTimes(1);
    });

    it('stays all or nothing when the bad field has no default to fall back on', () => {
      const merge = createMergeWithSchema('example', settings, { independentFields: true });

      expect(merge({ count: 1, label: 42 }, current)).toBe(current);
    });

    it('stays all or nothing when the blob breaks a rule that spans fields', () => {
      const ordered = z
        .object({ low: z.number().default(0), high: z.number().default(1) })
        .refine((value) => value.low <= value.high);
      const merge = createMergeWithSchema('example', ordered, { independentFields: true });
      const defaults = { low: 0, high: 1 };

      expect(merge({ low: 5, high: 2 }, defaults)).toBe(defaults);
    });

    it('stays all or nothing for a schema that is not a plain object', () => {
      const piped = z.object({ count: z.number().default(0) }).transform((value) => value);
      const merge = createMergeWithSchema('example', piped, { independentFields: true });
      const defaults = { count: 0 };

      expect(merge({ count: 'x' }, defaults)).toBe(defaults);
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
