const OMIT = Symbol('omit');

type CanonicalReactTestValue =
  | null
  | boolean
  | number
  | string
  | CanonicalReactTestValue[]
  | { [key: string]: CanonicalReactTestValue };

const REACT_INTERNAL_KEYS = new Set([
  '$$typeof',
  '__self',
  '__source',
  '_owner',
  '_store',
  'key',
  'ref',
]);

function isReactInternalKey(key: string): boolean {
  return REACT_INTERNAL_KEYS.has(key) || key.startsWith('__react');
}

function canonicalize(value: unknown): CanonicalReactTestValue | typeof OMIT {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') {
    return OMIT;
  }

  if (Array.isArray(value)) {
    const result: CanonicalReactTestValue[] = [];

    for (const item of value) {
      const canonicalItem = canonicalize(item);
      if (canonicalItem !== OMIT) result.push(canonicalItem);
    }

    return result;
  }

  const result: { [key: string]: CanonicalReactTestValue } = {};
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  for (const [key, item] of entries) {
    if (isReactInternalKey(key)) continue;
    const canonicalItem = canonicalize(item);
    if (canonicalItem !== OMIT) result[key] = canonicalItem;
  }

  return result;
}

/**
 * Converts Testing Library's renderer output into a stable, reviewable tree.
 * Visual and accessibility props remain exact; callbacks, refs, symbols, and
 * React bookkeeping are removed recursively.
 */
export function canonicalizeReactTestTree(value: unknown): CanonicalReactTestValue {
  const canonicalValue = canonicalize(value);
  return canonicalValue === OMIT ? null : canonicalValue;
}
