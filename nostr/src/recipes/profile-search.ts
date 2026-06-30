import type { EventQueryInput } from './rank';
import type { NaggAppViewBinding } from '../transport';

export type ProfileSearchInput = {
  query: string;
  limit?: number;
  sort?: string;
  source?: string;
};

/** REST app-view binding for `GET /nostr/search` (the facade's nagg search tier). */
export function profileSearchAppView(input: ProfileSearchInput): NaggAppViewBinding {
  return {
    path: '/nostr/search',
    method: 'GET',
    operationName: 'ProfileSearch',
    searchParams: {
      query: input.query,
      limit: input.limit ?? 10,
      sort: input.sort ?? 'globalPagerank',
      ...(input.source ? { source: input.source } : {}),
    },
  };
}

export function profileSearchInput(input: ProfileSearchInput): ProfileSearchInput {
  return {
    query: input.query,
    limit: input.limit ?? 10,
    sort: input.sort ?? 'globalPagerank',
    ...(input.source ? { source: input.source } : {}),
  };
}

export function profileEventsSearchInput(input: { query: string; limit?: number }): EventQueryInput {
  return {
    kinds: [0],
    search: input.query,
    limit: input.limit ?? 10,
  };
}
