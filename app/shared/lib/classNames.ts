import { extendTailwindMerge, type ClassNameValue } from 'tailwind-merge';

/** Uniwind's safe-area values: `safe`, `safe-or-<n>`, `safe-offset-<n>` (`pb-safe-offset-5`). */
const isSafeArea = (value: string) => /^safe(-(or|offset)-.+)?$/.test(value);

const SAFE_AREA_GROUPS = [
  ...['p', 'px', 'py', 'ps', 'pe', 'pt', 'pr', 'pb', 'pl'],
  ...['m', 'mx', 'my', 'ms', 'me', 'mt', 'mr', 'mb', 'ml'],
  ...['inset', 'inset-x', 'inset-y', 'start', 'end', 'top', 'right', 'bottom', 'left'],
] as const;

// Without this, `pb-safe-offset-5` and a caller's `pb-0` both survive the merge
// and the style that wins depends on Uniwind's stylesheet order.
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      ...Object.fromEntries(SAFE_AREA_GROUPS.map((group) => [group, [{ [group]: [isSafeArea] }]])),
      'inset-x': [{ 'inset-x': [isSafeArea], x: [isSafeArea] }],
      'inset-y': [{ 'inset-y': [isSafeArea], y: [isSafeArea] }],
      h: [{ h: ['screen-safe'] }],
      'min-h': [{ 'min-h': ['screen-safe'] }],
      'max-h': [{ 'max-h': ['screen-safe'] }],
    },
  },
});

/**
 * Merge Tailwind class strings, resolving conflicts in favour of the last one.
 *
 * The house primitives build their classes from a base plus the caller's
 * `className`; merging lets the caller's win (`px-3` over a base `p-5`,
 * `pb-0` over a base `pb-safe-offset-5`).
 *
 * Accepts strings, arrays, and the falsy values a conditional produces
 * (`cond && 'class'`). It does **not** accept clsx's object form
 * (`{ 'class': true }`) — `clsx` was dropped, and nothing used that form.
 *
 * @example
 * cn('px-2 py-1', 'px-4')                  // 'py-1 px-4'
 * cn('rounded-md', isActive && 'bg-accent')
 */
export function cn(...inputs: ClassNameValue[]) {
  return merge(inputs);
}
