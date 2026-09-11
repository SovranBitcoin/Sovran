import { groupBy } from '@/shared/lib/groupBy';

describe('groupBy', () => {
  it('groups arbitrary keys without reading inherited object properties', () => {
    const values = ['constructor', '__proto__', 'toString', '__proto__'];
    const grouped = groupBy(values, (value) => value);
    expect(Object.entries(grouped)).toEqual([
      ['constructor', ['constructor']],
      ['__proto__', ['__proto__', '__proto__']],
      ['toString', ['toString']],
    ]);
  });

  it('preserves item order and references without mutating its input', () => {
    const items = Object.freeze([
      { key: 'a', id: 1 },
      { key: 'b', id: 2 },
      { key: 'a', id: 3 },
    ]);
    const key = jest.fn((item: (typeof items)[number]) => item.key);
    const grouped = groupBy(items, key);
    expect(grouped.a).toEqual([items[0], items[2]]);
    expect(grouped.a[0]).toBe(items[0]);
    expect(grouped.b).toEqual([items[1]]);
    expect(key).toHaveBeenCalledTimes(items.length);
    expect(groupBy([], key)).toEqual({});
  });
});
