/**
 * @fileoverview The amount keypad's input rules.
 *
 * A leaf module with no native imports: these rules decide what a user can
 * type into every amount field in the app, and they belong somewhere a test
 * can reach without booting the icon and haptics stack.
 */

export type KeyboardValue = string | number;

/**
 * The keypad's next input string, or `null` when the key is rejected.
 *
 * Pure, and at module scope: this used to run INSIDE a `setInputValue`
 * updater, firing haptics and `onKeyPress` from it. A state updater has to be
 * pure — React may call it more than once — and the side effects in there were
 * also why React Compiler could not preserve the callback's memoization.
 */
export function nextKeypadValue(prev: string, key: KeyboardValue, unit: string): string | null {
  const str = String(key);
  let next: string;

  if (str === '<') {
    next = prev.slice(0, -1);
  } else if (unit !== 'sat' && prev === '0' && str !== '.') {
    next = str;
  } else {
    next = prev + str;
  }

  if (next.startsWith('.')) return null;
  if ((next.match(/\./g) || []).length > 1) return null;

  if (next.startsWith('0')) {
    if (unit === 'sat') return null;
    if (next.startsWith('00')) return null;
  }

  const parts = next.split('.');
  if (parts[1] && parts[1].length > 2) {
    next = `${parts[0]}.${parts[1].slice(0, 2)}`;
  }

  return next;
}
