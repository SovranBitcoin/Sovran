import { View } from 'react-native';
import { PostCard } from './nostr/PostCard';
import { MediaSourceContext } from './nostr/image-overlay/MediaSourceContext';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import {
  DEMO_FEED,
  DEMO_METRICS,
  DEMO_PROFILES,
  DEMO_MEDIA_SOURCES,
} from '@/shared/stores/runtime/mockPresentationData';
import { DEFAULT_METRICS } from './nostr/feedTypes';
import { useState } from 'react';

/** Same target card as live threads; no thread reads, composer, seeding or publishing. */
export function DemoThreadView({ eventId }: { eventId: string }) {
  const event = DEMO_FEED.find((item) => item.id === eventId);
  const [imageReady, setImageReady] = useState(false);
  if (!event) return null;
  return (
    <MediaSourceContext.Provider
      value={{ sources: DEMO_MEDIA_SOURCES, onLoad: () => setImageReady(true) }}>
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
      {imageReady && (
        <E2EAccessibilityProbe testID="demo-thread-ready" accessibilityLabel="Demo thread ready" />
      )}
    </MediaSourceContext.Provider>
  );
}
