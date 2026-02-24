/**
 * Shared types for the image overlay system.
 * Used by provider, overlay, image block, and bottom panel.
 */

import type { useScrollViewOffset } from '@/hooks/useScrollViewOffset';
import type { useDerivedValue, useSharedValue } from 'react-native-reanimated';

/** Post payload for overlay bottom panel (author, content, stats, actions). Kept minimal to avoid circular deps. */
export interface ImageOverlayPost {
  event: {
    id: string;
    pubkey: string;
    content: string;
    created_at: number;
  };
  metrics: {
    replyCount: number;
    repostCount: number;
    likeCount: number;
    satsZapped: number;
  };
  profile?: { name: string; picture?: string } | null;
  reposted?: boolean;
  liked?: boolean;
  repostPending?: boolean;
  likePending?: boolean;
  repostPendingDirection?: 'activating' | 'deactivating';
  likePendingDirection?: 'activating' | 'deactivating';
  onCommentPress?: () => void;
  onRepostPress?: () => void;
  onLikePress?: () => void;
  onActionPressIn?: () => void;
  onActionPressOut?: () => void;
}

export interface ImageOverlayLayout {
  url: string;
  aspectRatio?: number;
  pageX: number;
  pageY: number;
  width: number;
  height: number;
  /** When opening a post with multiple images, pass all urls and the index of the tapped image. */
  urls?: string[];
  initialIndex?: number;
  /** When opening from a post card, pass post data so the overlay can show author, content, stats, reply. */
  post?: ImageOverlayPost | null;
}

export type ThumbnailLayout = { pageX: number; pageY: number; width: number; height: number };

export type ImageOverlayContextValue = {
  scrollHandler: ReturnType<typeof useScrollViewOffset>['scrollHandler'];
  scrollOffsetY: ReturnType<typeof useScrollViewOffset>['scrollOffsetY'];
  open: (layout: ImageOverlayLayout) => void;
  /** Close overlay. Pass current pager index when multiple images so dismiss animates to the visible thumbnail. */
  close: (dismissedPageIndex?: number) => void;
  openToCenter: () => void;
  /** Register a thumbnail's layout (e.g. from onLayout + measureInWindow). Use eventId + imageIndex when opening from a post so dismiss uses this post's position, not another card's. */
  registerThumbnailLayout: (
    url: string,
    layout: ThumbnailLayout,
    options?: { eventId?: string; imageIndex?: number }
  ) => void;
  /** Set panel height (drives image area); used after content measure and when panel is dragged. */
  setPanelHeight: (height: number) => void;
  /** Report measured min content height so overlay can use it for snap points. */
  setPanelContentMinHeight: (height: number) => void;
  /** Start image open animation to final position (for min panel). Call from overlay onLayout when has panel. */
  startOpenPanelImageAnimation: (minPanelHeight: number) => void;
  activeUrl: string | null;
  /** All image urls when overlay shows multiple (e.g. post with 2+ images). Same as [activeUrl] when single. */
  activeUrls: string[];
  /** Current page index when activeUrls.length > 1. */
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  activeAspectRatio: number;
  imageState: ReturnType<typeof useSharedValue<'open' | 'close'>>;
  imageXCoord: ReturnType<typeof useSharedValue<number>>;
  imageYCoord: ReturnType<typeof useSharedValue<number>>;
  imageWidth: ReturnType<typeof useSharedValue<number>>;
  imageHeight: ReturnType<typeof useSharedValue<number>>;
  /** Target thumbnail size for close animation; overlay clamps size to never go below this during dismiss. */
  closeTargetWidth: ReturnType<typeof useSharedValue<number>>;
  closeTargetHeight: ReturnType<typeof useSharedValue<number>>;
  blurIntensity: ReturnType<typeof useSharedValue<number>>;
  thumbnailBlurIntensity: ReturnType<typeof useDerivedValue<number>>;
  closeBtnOpacity: ReturnType<typeof useSharedValue<number>>;
  expandedWidth: number;
  expandedHeight: number;
  /** Shared values for layout that updates with panel drag (use in animated styles when activeOverlayPost). */
  expandedWidthSv: ReturnType<typeof useSharedValue<number>>;
  expandedHeightSv: ReturnType<typeof useSharedValue<number>>;
  panelHeightSv: ReturnType<typeof useSharedValue<number>>;
  panelContentMinHeightSv: ReturnType<typeof useSharedValue<number>>;
  screenWidth: number;
  screenHeight: number;
  /** Post data for overlay bottom panel; set when open(layout) is called with layout.post. */
  activeOverlayPost: ImageOverlayPost | null;
};
