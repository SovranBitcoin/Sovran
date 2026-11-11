import type { FeedClient } from './feedClient';
import { createNaggFeedClient } from './naggFeedClient';
import { createFacadeFeedClient } from './facadeFeedClient';

export function getFeedClient(): FeedClient {
  // Feeds, threads and notifications route through the tier-selecting facade
  // (so the Settings → Network toggles take effect); enrichment delegates to
  // the nagg feed client.
  return createFacadeFeedClient(createNaggFeedClient());
}
