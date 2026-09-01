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

/**
 * React's `useId` tokens (`_r_4_`, and `url(#_r_4_)` references to them) encode
 * nothing but the order in which ids were handed out across the WHOLE render —
 * so adding a `useId` anywhere upstream renumbers every snapshot downstream.
 * Renumber them per-tree by first appearance instead: identical trees stay
 * identical, and a shared id and its reference still have to match.
 */
const REACT_ID_PATTERN = /_r_[0-9a-z]+_/g;

function canonicalizeReactIds(value: string, seen: Map<string, string>): string {
  return value.replace(REACT_ID_PATTERN, (id) => {
    const existing = seen.get(id);
    if (existing !== undefined) return existing;
    const canonical = `_r_${seen.size}_`;
    seen.set(id, canonical);
    return canonical;
  });
}

function canonicalize(
  value: unknown,
  reactIds: Map<string, string>
): CanonicalReactTestValue | typeof OMIT {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return canonicalizeReactIds(value, reactIds);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') {
    return OMIT;
  }

  if (Array.isArray(value)) {
    const result: CanonicalReactTestValue[] = [];

    for (const item of value) {
      const canonicalItem = canonicalize(item, reactIds);
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
    const canonicalItem = canonicalize(item, reactIds);
    if (canonicalItem !== OMIT) result[key] = canonicalItem;
  }

  return result;
}

/**
 * Converts Testing Library's renderer output into a stable, reviewable tree.
 * Visual and accessibility props remain exact; callbacks, refs, symbols, and
 * React bookkeeping are removed recursively, and `useId` tokens are renumbered
 * per tree so an unrelated upstream `useId` cannot churn every snapshot.
 */
export function canonicalizeReactTestTree(value: unknown): CanonicalReactTestValue {
  const canonicalValue = canonicalize(value, new Map<string, string>());
  return canonicalValue === OMIT ? null : canonicalValue;
}
