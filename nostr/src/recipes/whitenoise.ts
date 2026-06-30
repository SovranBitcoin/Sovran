// Whitenoise (MLS / Marmot) recipes. nagg indexes the group events; the client
// decrypts them via Marmot. Group membership is MLS-private, so the client must
// supply the group ids (the hex nostr group id from local MLS state).
import type { EventQueryInput } from './rank';

// nagg indexes these events; the read goes through `eventsQueryAppView` (POST
// /nostr/events/query). These builders produce the filter; the client decrypts.

// MLS group message (kind 445), filtered by the `#h` nostr group id set.
export function whitenoiseGroupMessagesInput(options: {
  groupIds: string[];
  since?: number;
  until?: number;
  limit?: number;
}): EventQueryInput {
  return {
    kinds: [445],
    tags: [{ key: 'h', values: options.groupIds }],
    ...(options.since ? { since: options.since } : {}),
    ...(options.until ? { until: options.until } : {}),
    limit: options.limit ?? 200,
  };
}

// Gift-wrapped welcome invites (kind 1059) addressed to the viewer.
export function whitenoiseInvitesInput(options: {
  viewer: string;
  since?: number;
  until?: number;
  limit?: number;
}): EventQueryInput {
  return {
    kinds: [1059],
    tags: [{ key: 'p', value: options.viewer }],
    ...(options.since ? { since: options.since } : {}),
    ...(options.until ? { until: options.until } : {}),
    limit: options.limit ?? 100,
  };
}
