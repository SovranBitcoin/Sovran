/**
 * @fileoverview Non-iOS entry for the SwiftUI glass composer tier.
 *
 * The real implementation lives in `LiquidChatComposerGlass.ios.tsx`, so
 * `@expo/ui/swift-ui` stays off the Android bundle. `LiquidChatComposer` only
 * renders this tier when `useCapabilities().liquidGlass` is true, which never
 * holds off iOS; this stub keeps the module resolvable (Android, Jest) and
 * renders nothing.
 */
import type { LiquidChatComposerGlassProps } from './LiquidChatComposerGlass.types';

export function LiquidChatComposerGlass(_props: LiquidChatComposerGlassProps): null {
  return null;
}
