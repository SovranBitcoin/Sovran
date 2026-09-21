import { createContext } from 'react';

import type { RelayInformation } from '@/shared/lib/nostr/nip11';

/**
 * Presentation-only NIP-11 documents for RelayCard, keyed by
 * `relayMetadataKey(url)`; `null` is a relay with no document. A listed relay
 * renders from here and never touches `relayMetadataStore` or the network, so
 * design-system fixtures stay out of the persisted cache.
 *
 * Own module so the design-system catalog can provide it without importing
 * the feed graph behind RelayCard.
 */
export const RelayCardFixturesContext = createContext<ReadonlyMap<
  string,
  RelayInformation | null
> | null>(null);
