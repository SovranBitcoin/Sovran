import type { FeedClient } from './feedClient';
import { createNaggFeedClient } from './naggFeedClient';
import { createFacadeFeedClient } from './facadeFeedClient';

export function getFeedClient(): FeedClient {
  // The for-you / following-popular home feeds route through the tier-selecting
  // facade (so the Settings → Network toggles take effect); everything else
  // delegates to the existing nagg feed client.
  return createFacadeFeedClient(createNaggFeedClient());
}
