import { FeedScreen } from '@/features/feed';
import { LazyTabContent } from '@/shared/ui/composed/LazyTabContent';

// Native iOS tabs eagerly mount every tab on first render. We defer the
// heavy Feed subtree (NDK subscriptions, stories, image prefetching, etc.)
// until the user actually focuses this tab — keeps cold boot cheap.
export default function FeedRoute() {
  return (
    <LazyTabContent tag="feed">
      <FeedScreen />
    </LazyTabContent>
  );
}
