/**
 * NFC module logger. Debug logs only in __DEV__ to avoid noise in production.
 */

const PREFIX = '[NFC]';

export function log(...args: unknown[]): void {
  console.log(PREFIX, ...args);
}

export function logDebug(...args: unknown[]): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.debug(PREFIX, ...args);
  }
}

export function logWarn(...args: unknown[]): void {
  console.warn(PREFIX, ...args);
}

export function logError(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}
