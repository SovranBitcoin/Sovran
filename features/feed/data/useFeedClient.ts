import type { FeedClient } from './feedClient';
import { createNaggFeedClient } from './naggFeedClient';

export function getFeedClient(): FeedClient {
  return createNaggFeedClient();
}
