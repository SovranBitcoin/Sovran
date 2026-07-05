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
  paginationUntil: number;
  paginationOffset: number;
};

export type MappedNaggFeedItem<TEvent extends NaggFeedEvent = NaggFeedEvent> =
  | {
      type: 'note';
      event: TEvent;
      rootEvent?: TEvent;
      rootEventId?: string;
      replyPreviewEvents?: TEvent[];
      timestamp: number;
    }
  | {
      type: 'repost';
      repostEvent: TEvent;
      originalEvent: TEvent | undefined;
      originalEventId: string;
      rootEvent?: TEvent;
      rootEventId?: string;
      reposters?: Array<NaggReposterInfo<TEvent>>;
      timestamp: number;
    };

export type MappedNaggFeedPage<
  TEvent extends NaggFeedEvent = NaggFeedEvent,
  TProfile extends NaggProfileInfo = NaggProfileInfo,
> = {
  orderedFeedItems: Array<MappedNaggFeedItem<TEvent>>;
  metricsMap: Map<string, NaggNoteMetrics>;
  profilesMap: Map<string, TProfile>;
  quotedEventsMap: Map<string, TEvent>;
  missingQuotedIds: string[];
  missingProfilePubkeys: string[];
  paginationUntil: number;
  paginationOffset: number;
};

export type NaggFeedReferenceCollector<TEvent extends NaggFeedEvent = NaggFeedEvent> = (
  events: TEvent[]
) => {
  eventIds: string[];
  pubkeys: string[];
};

export type MapNaggFeedPageOptions<
  TEvent extends NaggFeedEvent = NaggFeedEvent,
  TProfile extends NaggProfileInfo = NaggProfileInfo,
> = {
  includeNote?: (event: TEvent, rootEvent?: TEvent) => boolean;
  includeRepost?: (event: TEvent, originalEvent?: TEvent, rootEvent?: TEvent) => boolean;
  extraProfile?: { pubkey: string; profile: TProfile };
  collectReferences?: NaggFeedReferenceCollector<TEvent>;
  defaultMetrics?: NaggNoteMetrics;
};

export const DEFAULT_NAGG_NOTE_METRICS: Readonly<NaggNoteMetrics> = Object.freeze({
  likeCount: 0,
  repostCount: 0,
  replyCount: 0,
  satsZapped: 0,
});

export function mapNaggFeedPage<
  TEvent extends NaggFeedEvent = NaggFeedEvent,
  TProfile extends NaggProfileInfo = NaggProfileInfo,
>(
  page: NaggFeedPage<TEvent, TProfile>,
  options: MapNaggFeedPageOptions<TEvent, TProfile> = {}
): MappedNaggFeedPage<TEvent, TProfile> {
  const metricsMap = new Map<string, NaggNoteMetrics>(Object.entries(page.metrics));
  const profilesMap = new Map<string, TProfile>(Object.entries(page.profiles));
  const quotedEventsMap = new Map<string, TEvent>(Object.entries(page.quoted));
  const defaultMetrics = options.defaultMetrics ?? DEFAULT_NAGG_NOTE_METRICS;
  if (options.extraProfile) {
    profilesMap.set(options.extraProfile.pubkey, options.extraProfile.profile);
  }

  const orderedFeedItems: Array<MappedNaggFeedItem<TEvent>> = [];
  const contentSources: TEvent[] = [];
  const repostItemsByOriginalId = new Map<
    string,
    Extract<MappedNaggFeedItem<TEvent>, { type: 'repost' }>
  >();

  for (const item of page.items) {
    if (item.type === 'note') {
      const rootEvent = item.rootEvent ?? undefined;
      if (options.includeNote && !options.includeNote(item.event, rootEvent)) continue;
      const rootEventId = item.rootEventId ?? rootEvent?.id;
      const replyPreviewEvents = item.replyPreviewEvents ?? [];
      orderedFeedItems.push({
        type: 'note',
        event: item.event,
        rootEvent,
        rootEventId,
        ...(replyPreviewEvents.length > 0 ? { replyPreviewEvents } : {}),
        timestamp: item.event.created_at || 0,
      });
      appendContentSources(contentSources, item.event, rootEvent, replyPreviewEvents);
      ensureMetrics(metricsMap, defaultMetrics, item.event.id, rootEvent?.id);
      for (const replyPreviewEvent of replyPreviewEvents) {
        ensureMetrics(metricsMap, defaultMetrics, replyPreviewEvent.id);
      }
      continue;
    }

    const originalEvent = item.originalEvent ?? undefined;
    const originalEventId = item.originalEventId ?? firstTagValue(item.repostEvent, 'e');
    const rootEvent = item.rootEvent ?? undefined;
    if (options.includeRepost && !options.includeRepost(item.repostEvent, originalEvent, rootEvent)) {
      continue;
    }
    const rootEventId = item.rootEventId ?? rootEvent?.id;
    if (!originalEventId) continue;
    const reposters =
      item.reposters && item.reposters.length > 0
        ? item.reposters
        : [{ pubkey: item.repostEvent.pubkey, event: item.repostEvent }];

    const existingRepost = repostItemsByOriginalId.get(originalEventId);
    if (existingRepost) {
      existingRepost.reposters = mergeReposters(existingRepost.reposters, reposters);
      for (const reposter of reposters) contentSources.push(reposter.event);
      continue;
    }

    const repostItem: Extract<MappedNaggFeedItem<TEvent>, { type: 'repost' }> = {
      type: 'repost',
      repostEvent: item.repostEvent,
      originalEvent,
      originalEventId,
      rootEvent,
      rootEventId,
      reposters,
      timestamp: item.repostEvent.created_at || 0,
    };
    orderedFeedItems.push(repostItem);
    repostItemsByOriginalId.set(originalEventId, repostItem);

    appendContentSources(contentSources, originalEvent, rootEvent);
    for (const reposter of reposters) contentSources.push(reposter.event);
    ensureMetrics(metricsMap, defaultMetrics, originalEventId, rootEvent?.id);
  }

  const references = options.collectReferences?.(contentSources) ?? collectTagReferences(contentSources);
  const missingQuotedIds = references.eventIds.filter((id) => !quotedEventsMap.has(id));

  const neededPubkeys = new Set(references.pubkeys);
  for (const event of contentSources) neededPubkeys.add(event.pubkey);
  for (const item of orderedFeedItems) {
    if (item.type === 'repost') {
      for (const reposter of item.reposters ?? []) neededPubkeys.add(reposter.pubkey);
      neededPubkeys.add(item.repostEvent.pubkey);
    }
  }
  for (const event of quotedEventsMap.values()) neededPubkeys.add(event.pubkey);
  const missingProfilePubkeys = Array.from(neededPubkeys).filter(
    (pubkey) => !profilesMap.has(pubkey)
  );

  return {
    orderedFeedItems,
    metricsMap,
    profilesMap,
    quotedEventsMap,
    missingQuotedIds,
    missingProfilePubkeys,
    paginationUntil: page.paginationUntil,
    paginationOffset: page.paginationOffset,
  };
}

export function mergeReposters<TEvent extends NaggFeedEvent>(
  existing: Array<NaggReposterInfo<TEvent>> | undefined,
  next: Array<NaggReposterInfo<TEvent>>
): Array<NaggReposterInfo<TEvent>> {
  const out = existing ? [...existing] : [];
  const seen = new Set(out.map((reposter) => reposter.pubkey));
  for (const reposter of next) {
    if (seen.has(reposter.pubkey)) continue;
    seen.add(reposter.pubkey);
    out.push(reposter);
  }
  return out;
}

export function firstTagValue(event: Pick<NaggFeedEvent, 'tags'>, tagName: string): string | undefined {
  return event.tags.find((tag) => tag[0] === tagName && typeof tag[1] === 'string')?.[1];
}

function ensureMetrics(
  metricsMap: Map<string, NaggNoteMetrics>,
  defaultMetrics: NaggNoteMetrics,
  ...ids: Array<string | undefined>
): void {
  for (const id of ids) {
    if (id && !metricsMap.has(id)) metricsMap.set(id, { ...defaultMetrics });
  }
}

function appendContentSources<TEvent extends NaggFeedEvent>(
  out: TEvent[],
  ...events: Array<TEvent | TEvent[] | undefined>
): void {
  for (const event of events) {
    if (!event) continue;
    if (Array.isArray(event)) out.push(...event);
    else out.push(event);
  }
}

function collectTagReferences<TEvent extends NaggFeedEvent>(
  events: TEvent[]
): ReturnType<NaggFeedReferenceCollector<TEvent>> {
  const eventIds = new Set<string>();
  const pubkeys = new Set<string>();
  for (const event of events) {
    for (const tag of event.tags) {
      if (tag[0] === 'q' && typeof tag[1] === 'string') {
        eventIds.add(tag[1]);
      }
      if (tag[0] === 'p' && typeof tag[1] === 'string') {
        pubkeys.add(tag[1]);
      }
    }
  }
  return { eventIds: Array.from(eventIds), pubkeys: Array.from(pubkeys) };
}
