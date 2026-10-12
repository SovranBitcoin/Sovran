/**
 * @fileoverview Non-iOS entry for the liquid-glass keypad key.
 *
 * The real implementation lives in `KeypadGlassKey.ios.tsx`, so
 * `expo-glass-effect` stays off the Android bundle. `CustomKeyboard` only
 * picks this key when `useCapabilities().liquidGlass` is true, which never
 * holds off iOS; this keeps the module resolvable (Android, Jest) and draws
 * the ordinary key.
 */
export { KeypadKey as KeypadGlassKey } from './KeypadKey';
