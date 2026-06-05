/**
 * Shared envelope for the generic query cache. One shape for every cached
 * fetch (feed, notifications, search, DMs). The data is stored opaquely
 * (`z.unknown()` in the persisted schema) and re-validated on read by the
 * consumer's domain schema, so a wire-shape drift re-fetches instead of
 * wiping the blob.
 */
export interface QueryCacheEntry<TData> {
  /** The cached response payload (mirrors the server response shape). */
  data: TData;
  /** ms since epoch when this entry was last written. */
  fetchedAt: number;
  /** Viewer pubkey this entry belongs to (`''` for host-scoped data). */
  viewerKey: string;
  /** Opaque pagination cursor / endCursor for the next page. */
  cursor?: string;
}
