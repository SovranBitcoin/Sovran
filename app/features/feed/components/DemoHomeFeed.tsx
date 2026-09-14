import { useMemo, useState } from 'react';
import { MediaSourceContext } from './nostr/image-overlay/MediaSourceContext';
import { View } from 'react-native';
import { List } from '@/shared/ui/composed/List';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import {
  DEMO_FEED,
  DEMO_MEDIA_SOURCES,
  DEMO_METRICS,
  DEMO_PROFILES,
} from '@/shared/stores/runtime/mockPresentationData';
import { PostCard } from './nostr/PostCard';
import { DEFAULT_METRICS } from './nostr/feedTypes';
const firstImageUrl =
  'https://image.nostr.build/73a0a70de41c73241f10ab42edddeab0f2f6566a3b760a9c4abf46df797f41c2.jpg';
const quotedEvents = new Map();
const getMetrics = (id: string) => DEMO_METRICS.get(id) ?? DEFAULT_METRICS;

/** Uses the real post renderer; fixture cards are read-only and never publish. */
export function DemoHomeFeed() {
  const [imageReady, setImageReady] = useState(false);
  const media = useMemo(
    () => ({
      sources: DEMO_MEDIA_SOURCES,
      onLoad: (url: string) => {
        if (url === firstImageUrl) setImageReady(true);
      },
    }),
    []
  );
  return (
    <MediaSourceContext.Provider value={media}>
      {imageReady && (
        <E2EAccessibilityProbe testID="demo-feed-ready" accessibilityLabel="Demo feed ready" />
      )}
      <List
        testID="feed-list"
        data={DEMO_FEED}
        keyExtractor={(event) => event.id}
        renderItem={({ item }) => (
          <View pointerEvents="none">
            <PostCard
              event={item}
              metrics={getMetrics(item.id)}
              profiles={DEMO_PROFILES}
              quotedEvents={quotedEvents}
              getMetrics={getMetrics}
              variant="feed"
            />
          </View>
        )}
      />
    </MediaSourceContext.Provider>
  );
}
