/**
 * Normalize a React Native <Image> onError event into a readable string.
 *
 * The error shape varies (`event.error`, `event.nativeEvent.error`, or the raw
 * value), so this single owner unwraps it for logging — used by every surface
 * that reports an image load failure.
 */
export function describeImageLoadError(event: unknown): string {
  if (event && typeof event === 'object') {
    const directError = (event as { error?: unknown }).error;
    if (typeof directError === 'string') return directError;
    const nativeEvent = (event as { nativeEvent?: { error?: unknown } }).nativeEvent;
    if (typeof nativeEvent?.error === 'string') return nativeEvent.error;
  }
  return String(event ?? 'unknown');
}
