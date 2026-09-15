import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { PostCard } from './nostr/PostCard';
import { MediaSourceContext } from './nostr/image-overlay/MediaSourceContext';
import { AnimatedImageOverlay, ImageOverlayProvider, useImageOverlay } from './nostr/image-overlay';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import {
  DEMO_FEED,
  DEMO_METRICS,
  DEMO_PROFILES,
  DEMO_MEDIA_SOURCES,
} from '@/shared/stores/runtime/mockPresentationData';
import { DEFAULT_METRICS } from './nostr/feedTypes';

const DEMO_OVERLAY_MEDIA = { sources: DEMO_MEDIA_SOURCES };

/** Same target card as live threads; no thread reads, composer, seeding or publishing. */
export function DemoThreadView({ eventId }: { eventId: string }) {
  const event = DEMO_FEED.find((item) => item.id === eventId);
  const [imageReady, setImageReady] = useState(false);
  if (!event) return null;
  const imageUrl = Object.keys(DEMO_MEDIA_SOURCES).find((url) => event.content.includes(url));
  return (
    <MediaSourceContext.Provider
      value={{ sources: DEMO_MEDIA_SOURCES, onLoad: () => setImageReady(true) }}>
      <ImageOverlayProvider mediaSource={DEMO_OVERLAY_MEDIA}>
        <View>
          {/* The card stays inert: its actions, links and menus must never fire in a preview. */}
          <View pointerEvents="none">
            <PostCard
              event={event}
              metrics={DEMO_METRICS.get(event.id) ?? DEFAULT_METRICS}
              profiles={DEMO_PROFILES}
              quotedEvents={new Map()}
              getMetrics={(id) => DEMO_METRICS.get(id) ?? DEFAULT_METRICS}
              variant="thread-target"
            />
          </View>
          {imageReady && imageUrl ? <DemoImageOpener eventId={event.id} url={imageUrl} /> : null}
        </View>
        {imageReady && (
          <E2EAccessibilityProbe
            testID="demo-thread-ready"
            accessibilityLabel="Demo thread ready"
          />
        )}
        <AnimatedImageOverlay />
      </ImageOverlayProvider>
    </MediaSourceContext.Provider>
  );
}

/**
 * Opens the viewer from the card's registered thumbnail without making the card
 * itself interactive. No post payload: the viewer shows the image only, with no
 * reply bar or engagement panel.
 */
function DemoImageOpener({ eventId, url }: { eventId: string; url: string }) {
  const overlay = useImageOverlay();
  return (
    <Pressable
      testID="demo-thread-open-image"
      accessibilityRole="button"
      accessibilityLabel="Open image"
      style={StyleSheet.absoluteFill}
      onPress={() => {
        const layout =
          overlay?.getThumbnailLayout(`${eventId}-0`) ?? overlay?.getThumbnailLayout(url);
        if (!overlay || !layout) return;
        overlay.open({ url, ...layout, aspectRatio: layout.width / layout.height });
      }}
    />
  );
}
