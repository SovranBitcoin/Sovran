import { twMerge, type ClassNameValue } from 'tailwind-merge';

/**
 * Merge Tailwind class strings, resolving conflicts in favour of the last one.
 *
 * `tailwind-merge` is not optional here — `heroui-native` peer-depends on it and
 * its compiled component styles import `tailwind-variants`, which peer-depends
 * on it in turn. So this is the one class utility that costs nothing extra.
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
