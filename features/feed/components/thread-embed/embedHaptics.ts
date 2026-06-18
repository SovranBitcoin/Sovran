import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';

/**
 * Light tick used for thread-embed feedback — when the sheet settles on a new
 * snap point and when a link is tapped to open the embed. Module-level so it can
 * be passed to `runOnJS` from gesture worklets.
 */
export const embedHaptic = () => {
  void EnhancedHaptics.buttonHaptic();
};
