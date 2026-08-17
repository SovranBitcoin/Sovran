/**
 * Normalize a React Native image `onError` payload into a loggable string.
 *
 * RN hands back `{ error }` on some platforms and `{ nativeEvent: { error } }`
 * on others, and Expo Image can surface either — every image surface that logs
 * a load failure needs the same flattening, so it lives here once.
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
