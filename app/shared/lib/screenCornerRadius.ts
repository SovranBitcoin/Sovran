import { requireOptionalNativeModule } from 'expo';

type ScreenCornerRadiusModule = {
  getCornerRadiusSync(): number | null;
};

// `expo-screen-corner-radius` only ships native code; if the running binary was
// built before the package was linked (stale dev client / APK), the module
// resolves to undefined/null. Resolve it optionally so a missing module never
// crashes the screen — we just fall back to a token radius instead.
const nativeModule =
  requireOptionalNativeModule<ScreenCornerRadiusModule>('ExpoScreenCornerRadius');

/**
 * Hardware screen corner radius in dp, or `fallback` when it can't be read.
 *
 * Returns the fallback when the native module is absent from the binary, when
 * the platform can't report it (Android <12, devices without rounded displays),
 * or when the native call throws.
 */
export function getScreenCornerRadius(fallback: number): number {
  try {
    return nativeModule?.getCornerRadiusSync() ?? fallback;
  } catch {
    return fallback;
  }
}
