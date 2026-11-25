import { twMerge, type ClassNameValue } from 'tailwind-merge';

/**
 * Merge Tailwind class strings, resolving conflicts in favour of the last one.
 *
 * The house primitives build their classes from a base plus the caller's
 * `className`; merging lets the caller's win (`px-3` over a base `p-5`).
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
  return twMerge(inputs);
}
