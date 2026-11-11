export type NaggFeedEvent = {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
};

export type NaggNoteMetrics = {
  likeCount: number;
  repostCount: number;
  replyCount: number;
  satsZapped: number;
  /** Discrete zap-receipt count (new in the v2 envelope; v1 had no zap count). */
  zapCount?: number;
  /** q-tag quote count (new in the v2 envelope). */
  quoteCount?: number;
};

export type NaggProfileInfo = {
  name: string;
  picture?: string;
};

export type NaggReposterInfo<TEvent extends NaggFeedEvent = NaggFeedEvent> = {
  pubkey: string;
  event: TEvent;
};

export type NaggFeedItem<TEvent extends NaggFeedEvent = NaggFeedEvent> =
  | {
      type: 'note';
      event: TEvent;
      rootEvent?: TEvent | null;
      rootEventId?: string;
      replyPreviewEvents?: TEvent[];
    }
  | {
      type: 'repost';
      repostEvent: TEvent;
      originalEvent?: TEvent | null;
      originalEventId?: string;
      rootEvent?: TEvent | null;
      rootEventId?: string;
      reposters?: Array<NaggReposterInfo<TEvent>>;
    };

export type NaggOrderingManifest = {
  orderBy: 'rank' | 'created_at' | 'arrival';
  elements: string[];
};

export type NaggFeedPage<
  TEvent extends NaggFeedEvent = NaggFeedEvent,
  TProfile extends NaggProfileInfo = NaggProfileInfo,
> = {
  items: Array<NaggFeedItem<TEvent>>;
  /** Server-authoritative render order; present on the REST app-view, absent on GraphQL. */
  ordering?: NaggOrderingManifest;
  metrics: Record<string, NaggNoteMetrics>;
  profiles: Record<string, TProfile>;
  quoted: Record<string, TEvent>;
  hasMore?: boolean;
  paginationUntil: number;
  paginationOffset: number;
};

export function firstTagValue(event: Pick<NaggFeedEvent, 'tags'>, tagName: string): string | undefined {
  return event.tags.find((tag) => tag[0] === tagName && typeof tag[1] === 'string')?.[1];
}
