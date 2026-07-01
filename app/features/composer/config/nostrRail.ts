/**
 * @fileoverview The Nostr rail capability descriptor.
 *
 * Nostr has no protocol-level content limit, so the char budget is sourced from
 * the user's write relays' NIP-11 `max_content_length` (the strictest wins),
 * falling back to a generous default. Media is enabled now that the Blossom
 * upload pipeline exists. Poll/alt-text/sensitive are all supported.
 */
import { getMergedContentLimit } from '@/shared/lib/nostr/nip11';
import type { RailCapability } from '@/features/composer/config/types';

const DEFAULT_CHAR_BUDGET = 10_000;
const MAX_MEDIA = 4;

/** Synchronous default — used before NIP-11 limits resolve (never blocks open). */
export function defaultNostrRail(): RailCapability {
  return {
    id: 'nostr',
    label: 'Nostr',
    charBudget: DEFAULT_CHAR_BUDGET,
    maxMedia: MAX_MEDIA,
    allowAltText: true,
    allowSensitive: true,
    allowPoll: true,
    reasons: {},
  };
}

/** Builds the rail with the char budget tightened to the write relays' limit. */
export async function buildNostrRail(writeRelays: readonly string[]): Promise<RailCapability> {
  const limit = await getMergedContentLimit(writeRelays);
  return {
    ...defaultNostrRail(),
    charBudget: limit && limit > 0 ? limit : DEFAULT_CHAR_BUDGET,
  };
}
