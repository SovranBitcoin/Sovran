/**
 * Image overlay module.
 *
 * Declarative config in config.ts; types in types.ts.
 * Provider manages state + animation worklets; overlay handles gestures + rendering.
 *
 * Components:
 *   config.ts               - All gesture, spring, layout, and timing constants
 *   types.ts                - Shared TypeScript interfaces
 *   provider.tsx            - Context, shared values, open/close animation worklets
 *   AnimatedImageOverlay.tsx - Fullscreen overlay with gestures (dismiss, pager, tap)
 *   ImageBlock.tsx           - Feed thumbnail with tap-to-open and blur
 *   BottomPanel.tsx          - Sheet content, absolute bar, reply row
 *   PagerPage.tsx            - Single page in multi-image pager
 *   PagerDots.tsx            - Instagram-style pagination dots
 */

// Provider & hook
export {
  ImageOverlayProvider,
  useImageOverlay,
  IMAGE_OVERLAY_TIMING_CONFIG,
  computeExpandedSize,
} from './provider';
export type { ImageOverlayProviderProps } from './provider';

// Main overlay component
export { AnimatedImageOverlay } from './AnimatedImageOverlay';

// Feed thumbnail
export { ImageBlock } from './ImageBlock';

// Types (re-export for consumers)
export type {
  ImageOverlayPost,
  ImageOverlayLayout,
  ThumbnailLayout,
  ImageOverlayContextValue,
} from './types';
