/**
 * Run after what was just rendered has reached the screen: two animation
 * frames, the second of which starts after the first one's commit is mounted.
 *
 * For a navigation that has to follow another one natively. Two router calls
 * in one task reach the native stack as one update, and a screen pushed in the
 * same update as a sheet's dismissal lands beneath a sheet still presented.
 * Once the dismissal has begun, the native stack holds a later push until it
 * ends. `runAfterInteractions` cannot do this: it runs in the same task.
 */
export function afterNextFrame(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}
