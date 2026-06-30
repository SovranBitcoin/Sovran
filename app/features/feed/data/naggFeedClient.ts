import {
  createNaggClient,
  NaggEnrichmentSchema,
  NaggFeedPageSchema,
  NaggNotificationsPageSchema,
  NaggThreadSchema,
  type NaggAppViewBinding,
  type NaggError,
  type NaggNotificationsPage,
} from 'nostr';
import {
  eventsAppView,
  followingPopularRankedEventsInput,
  followsFeedAppView,
  forYouRankedEventsInput,
  notificationsAppView,
  profilesAppView,
  rankedFeedAppView,
  threadAppView,
  userFeedAppView,
  withRankedTargetExclusions,
  type RankedEventsInput,
} from 'nostr/recipes';
import { type NaggFeedPage } from 'nostr/map';
import type { z } from 'zod';
import { backendConfig } from '@/shared/config/backend';
import { apiLog, feedLog, redactError } from '@/shared/lib/logger';
import { buildThreadStructure } from '@/features/feed/lib/buildThreadStructure';
import { mapNaggFeedPage } from './mapNaggFeedPage';
import type {
  FeedClient,
  FeedEnrichmentRequest,
  FeedEnrichmentUpdates,
  FeedParseResult,
  FeedPageRequest,
  FeedNotification,
  FeedNotificationsRequest,
  FeedNotificationsResult,
  ThreadRequest,
  ThreadResult,
  UserFeedPageRequest,
  PostsByPubkeysRequest,
} from './feedClient';
import { emptyFeedParseResult } from './feedClient';
import { ingestOwnContent } from '@/shared/stores/profile/ownContentStore';
import { ingestOwnMediaBlobs } from '@/shared/stores/profile/ownedMediaStore';
import { hasEmptyExplicitPubkeys, hydrateSpecWithPubkey } from './feedSpec';
import { parseJson } from '../components/nostr/feedParse';
import type { FeedEvent, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';
import { useFeedIgnoreStore } from '../stores/ignoreStore';

const RELEVANT_AUTHOR_REPLY_LIMIT = 50;

type FeedQueryOptions = {
  includeNote?: (event: FeedEvent, rootEvent?: FeedEvent) => boolean;
  includeRepost?: (event: FeedEvent, originalEvent?: FeedEvent, rootEvent?: FeedEvent) => boolean;
  extraProfile?: { pubkey: string; profile: ProfileInfo };
};

function isRootNote(event: { tags: string[][] }): boolean {
  const eTags = (event.tags || []).filter((tag) => tag[0] === 'e');
  if (eTags.length === 0) return true;
  return eTags.every((tag) => tag[3] === 'mention');
}

function shortId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 10) : undefined;
}

function endpointLogFields(): Record<string, unknown> {
  try {
    const url = new URL(backendConfig.nostrAppViewBaseUrl);
    return { host: url.host };
  } catch {
    return { endpoint: 'invalid' };
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dataKeysOf(value: unknown): string[] {
  const record = objectRecord(value);
  return record ? Object.keys(record).slice(0, 8) : [];
}

// The single nagg client — REST app-view only. There is no GraphQL transport.
const naggClient = createNaggClient({
  appView: { baseUrl: backendConfig.nostrAppViewBaseUrl, version: 'v1' },
});

type NaggRestOptions<TSchema extends z.ZodType> = {
  responseSchema: TSchema;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * One REST app-view request per view. The caller supplies the route `binding`
 * (path + params/body, from a recipe) and the canonical `responseSchema`; nagg's
 * app-view emits the canonical shape directly, so the raw body is parsed by the
 * schema with no distill step. Errors are logged and rethrown.
 */
async function runNaggRest<TSchema extends z.ZodType>(
  binding: NaggAppViewBinding,
  refresh: boolean | undefined,
  options: NaggRestOptions<TSchema>
): Promise<z.infer<TSchema>> {
  logBackendConfigOnce();
  const operationName = binding.operationName ?? binding.path;
  const requestFields = {
    operationName,
    method: binding.method ?? 'GET',
    path: binding.path,
    refresh: !!refresh,
    timeoutMs: options.timeoutMs,
    ...endpointLogFields(),
  };
  apiLog.info('nagg.appview.request.start', requestFields);
  const startedAt = Date.now();
  const result = await naggClient.rest({
    path: binding.path,
    method: binding.method,
    searchParams: binding.searchParams,
    body: binding.body,
    responseSchema: options.responseSchema,
    operationName,
    refresh,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  const durationMs = Date.now() - startedAt;

  if (result.isErr()) {
    const error = result.error;
    const thrown = errorFromNaggError(error);
    if (error.type === 'schema') {
      // The app-view body failed `responseSchema.safeParse` — the prime suspect
      // for an EMPTY feed/notifications: the request succeeded but the client
      // rejected the payload. Log the exact failing field(s).
      apiLog.error('nagg.appview.request.schema_error', {
        ...requestFields,
        durationMs,
        issueCount: error.issues?.length ?? 0,
        issues: (error.issues ?? []).slice(0, 10).map((issue) => ({
          path: Array.isArray(issue.path)
            ? issue.path.join('.')
            : String((issue as { path?: unknown }).path ?? ''),
          code: issue.code,
          message: issue.message,
        })),
      });
    } else if (redactError(thrown).message === 'Aborted') {
      apiLog.warn('nagg.appview.request.aborted', { ...requestFields, durationMs });
    } else {
      apiLog.error('nagg.appview.request.error', {
        ...requestFields,
        durationMs,
        error: redactError(thrown),
      });
    }
    throw thrown;
  }

  apiLog.info('nagg.appview.request.done', {
    ...requestFields,
    durationMs,
    dataKeys: dataKeysOf(result.value),
    resultCount: countCanonical(result.value),
  });
  return result.value;
}

// Logs the resolved app-view base once per session.
let loggedBackendConfig = false;
function logBackendConfigOnce(): void {
  if (loggedBackendConfig) return;
  loggedBackendConfig = true;
  apiLog.info('nagg.backend.config', {
    appViewBaseUrl: backendConfig.nostrAppViewBaseUrl,
  });
}

// Counts the rows in a parsed canonical payload (feed items / notification nodes
// / thread events) for log diagnostics — distinguishes "request returned data"
// from "request returned an empty page".
function countCanonical(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const v = value as {
    items?: unknown[];
    notifications?: { nodes?: unknown[] };
    events?: unknown[];
  };
  if (Array.isArray(v.items)) return v.items.length;
  if (v.notifications && Array.isArray(v.notifications.nodes)) return v.notifications.nodes.length;
  if (Array.isArray(v.events)) return v.events.length;
  return 0;
}

/**
 * The feed seam: fetch a route binding's canonical {@link NaggFeedPage} from the
 * REST app-view and feed it straight into `mapNaggFeedPage`.
 */
function fetchNaggFeedPage(
  binding: NaggAppViewBinding,
  refresh: boolean | undefined,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<NaggFeedPage<FeedEvent, ProfileInfo>> {
  return runNaggRest(binding, refresh, {
    responseSchema: NaggFeedPageSchema,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  }) as Promise<NaggFeedPage<FeedEvent, ProfileInfo>>;
}

function errorFromNaggError(error: NaggError): Error {
  const out = new Error(error.message);
  out.name =
    error.type === 'network' && /abort|timed out|timeout/i.test(error.message)
      ? 'AbortError'
      : 'NaggError';
  return out;
}

function forYouInputFromSpec({
  parsed,
  viewerPubkey,
  limit,
  offset,
}: {
  parsed: Record<string, unknown> | null;
  viewerPubkey?: string;
  limit: number;
  offset?: number;
}): RankedEventsInput {
  const hours = feedWindowHours(parsed);
  const since = Math.floor(Date.now() / 1000) - hours * 60 * 60;
  return forYouRankedEventsInput({
    viewerPubkey,
    since,
    limit,
    offset,
  });
}

function isForYouSpec(parsed: Record<string, unknown> | null): boolean {
  return parsed?.id === 'for-you' && parsed.kind === 'notes';
}

function isFollowingRepliesSpec(parsed: Record<string, unknown> | null): boolean {
  return parsed?.id === 'following-replies' && parsed.kind === 'notes';
}

function isFollowingPopularSpec(parsed: Record<string, unknown> | null): boolean {
  return parsed?.id === 'following-popular' && parsed.kind === 'notes';
}

function isFollowingRecentSpec(parsed: Record<string, unknown> | null): boolean {
  return parsed?.id === 'following-recent' && parsed.kind === 'notes';
}

function followingPopularInput({
  viewerPubkey,
  parsed,
  limit,
  offset,
}: {
  viewerPubkey: string;
  parsed: Record<string, unknown> | null;
  limit: number;
  offset?: number;
}): RankedEventsInput {
  const hours = feedWindowHours(parsed);
  const since = Math.floor(Date.now() / 1000) - hours * 60 * 60;
  return followingPopularRankedEventsInput({
    viewerPubkey,
    since,
    limit,
    offset,
  }) as RankedEventsInput;
}

function feedWindowHours(parsed: Record<string, unknown> | null): number {
  const hours = typeof parsed?.hours === 'number' ? parsed.hours : 24;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) return 24;
  return Math.floor(hours);
}

function pubkeysFromSpec(parsed: Record<string, unknown> | null): string[] {
  if (!parsed) return [];
  const out = new Set<string>();
  if (typeof parsed.pubkey === 'string' && parsed.pubkey) out.add(parsed.pubkey);
  if (Array.isArray(parsed.pubkeys)) {
    for (const value of parsed.pubkeys) {
      if (typeof value === 'string' && value) out.add(value);
    }
  }
  return Array.from(out);
}

type FeedPreferenceFilters = {
  ignoredPubkeys: string[];
  ignoredEventIds: string[];
};

function currentFeedPreferenceFilters(): FeedPreferenceFilters {
  const ignoreState = useFeedIgnoreStore.getState();
  return {
    ignoredPubkeys: ignoreState.ignoredPubkeys,
    ignoredEventIds: ignoreState.ignoredEventIds,
  };
}

function withPreferenceRankedFilters(
  input: RankedEventsInput,
  filters: FeedPreferenceFilters
): RankedEventsInput {
  return withRankedTargetExclusions(input, {
    excludeIds: filters.ignoredEventIds,
    excludePubkeys: filters.ignoredPubkeys,
  });
}

function feedQueryOptionsFromPreferences(filters: FeedPreferenceFilters): FeedQueryOptions {
  const ignoredPubkeys = new Set(filters.ignoredPubkeys.map((pubkey) => pubkey.toLowerCase()));
  const ignoredEventIds = new Set(filters.ignoredEventIds.map((id) => id.toLowerCase()));
  if (ignoredPubkeys.size === 0 && ignoredEventIds.size === 0) return {};

  const includeEvent = (event: FeedEvent | undefined) => {
    if (!event) return true;
    return (
      !ignoredPubkeys.has(event.pubkey.toLowerCase()) &&
      !ignoredEventIds.has(event.id.toLowerCase())
    );
  };

  return {
    includeNote: (event, rootEvent) => includeEvent(event) && includeEvent(rootEvent),
    includeRepost: (event, originalEvent, rootEvent) =>
      includeEvent(event) && includeEvent(originalEvent) && includeEvent(rootEvent),
  };
}

type NaggFeedPageOf = NaggFeedPage<FeedEvent, ProfileInfo>;

function emptyNaggFeedPage(): NaggFeedPageOf {
  return {
    items: [],
    metrics: {},
    profiles: {},
    quoted: {},
    paginationUntil: 0,
    paginationOffset: 0,
  };
}

function compareNotificationsNewestFirst(
  left: FeedNotificationsResult['notifications'][number],
  right: FeedNotificationsResult['notifications'][number]
): number {
  return (
    right.event.created_at - left.event.created_at || right.event.id.localeCompare(left.event.id)
  );
}

// Own-note candidates from a feed page — note events, their roots, and reposted
// originals. `ingestOwnContent` filters these to our own kind:1.
function ownNoteCandidatesFromFeed(result: FeedParseResult): FeedEvent[] {
  const events: FeedEvent[] = [];
  for (const item of result.orderedFeedItems) {
    if (item.type === 'note') {
      events.push(item.event);
      if (item.rootEvent) events.push(item.rootEvent);
    } else if (item.originalEvent) {
      events.push(item.originalEvent);
    }
  }
  return events;
}

/**
 * Map a {@link NaggFeedPage} through the shared mapper.
 * Pagination fields ride on the page itself, so ranked and events feeds paginate
 * exactly as they did before — there is no transport-specific post-processing.
 */
function mapNaggFeedPageResult(
  page: NaggFeedPageOf,
  options: FeedQueryOptions = {}
): FeedParseResult {
  return mapNaggFeedPage(page, options);
}

function replyPreviewCount(result: FeedParseResult): number {
  let count = 0;
  for (const item of result.orderedFeedItems) {
    const previews = (item as { replyPreviewEvents?: unknown[] }).replyPreviewEvents;
    if (Array.isArray(previews)) count += previews.length;
  }
  return count;
}

function logFeedPageResult(
  source: string,
  result: FeedParseResult,
  params: Record<string, unknown>
): FeedParseResult {
  feedLog.info('feed.nagg.page.done', {
    source,
    ...params,
    items: result.orderedFeedItems.length,
    replyPreviews: replyPreviewCount(result),
    metrics: result.metricsMap.size,
    profiles: result.profilesMap.size,
    quoted: result.quotedEventsMap.size,
    missingProfiles: result.missingProfilePubkeys.length,
    missingQuoted: result.missingQuotedIds.length,
    paginationUntil: result.paginationUntil,
    paginationOffset: result.paginationOffset,
  });
  return result;
}

/**
 * Build a {@link FeedNotificationsResult} from the parsed canonical
 * {@link NaggNotificationsPage}, identically for both transports: order notifs
 * newest-first, derive the next-page `until` cursor, and lift the hydration side
 * maps into the result Maps.
 */
function notificationsResultFromPage(page: NaggNotificationsPage): FeedNotificationsResult {
  const notifications = page.notifications.nodes
    .map((node) => {
      const enriched = node as NaggNotificationsPage['notifications']['nodes'][number] & {
        type?: 'single' | 'group';
        targetEvent?: FeedEvent;
        targetEventId?: string;
        total?: number;
        totalCapped?: boolean;
        sampleActors?: FeedNotification['sampleActors'];
      };
      return {
        event: node.event as FeedEvent,
        ...(enriched.targetEvent ? { targetEvent: enriched.targetEvent } : {}),
        ...(enriched.targetEventId ? { targetEventId: enriched.targetEventId } : {}),
        reason: node.reason,
        actorVertexScore: node.actorVertexScore,
        ...(enriched.type ? { type: enriched.type } : {}),
        ...(typeof enriched.total === 'number' ? { total: enriched.total } : {}),
        ...(enriched.totalCapped ? { totalCapped: enriched.totalCapped } : {}),
        ...(enriched.sampleActors ? { sampleActors: enriched.sampleActors } : {}),
      };
    })
    .sort(compareNotificationsNewestFirst);
  return {
    notifications,
    metricsMap: new Map(Object.entries(page.metrics)) as Map<string, NoteMetrics>,
    profilesMap: new Map(Object.entries(page.profiles)) as Map<string, ProfileInfo>,
    quotedEventsMap: new Map(Object.entries(page.quoted)) as Map<string, FeedEvent>,
    paginationUntil:
      notifications.length > 0
        ? Math.min(...notifications.map((notification) => notification.event.created_at))
        : 0,
    hasNextPage: page.notifications.pageInfo?.hasNextPage ?? false,
  };
}

export function createNaggFeedClient(): FeedClient {
  return {
    async getFeed({
      spec,
      userPubkey,
      limit = 30,
      until,
      offset,
      refresh,
      signal,
      timeoutMs,
    }: FeedPageRequest) {
      const startedAt = Date.now();
      const logResult = (source: string, result: FeedParseResult): FeedParseResult => {
        // Passive convergence: settle any of our own notes this page surfaced.
        ingestOwnContent(ownNoteCandidatesFromFeed(result), userPubkey);
        ingestOwnMediaBlobs(ownNoteCandidatesFromFeed(result), userPubkey);
        // (No profile fan-out: the facade already ingests this page's inline
        // profiles into the single owner — the entity cache — that every surface
        // now reads. A separate copy here would be pure duplication.)
        return logFeedPageResult(source, result, {
          limit,
          until,
          offset,
          refresh: !!refresh,
          viewerPubkey: !!userPubkey,
          durationMs: Date.now() - startedAt,
        });
      };
      const hydratedSpec = hydrateSpecWithPubkey(spec, userPubkey);
      if (hasEmptyExplicitPubkeys(hydratedSpec)) {
        return logResult('empty-explicit-pubkeys', emptyFeedParseResult());
      }
      const parsedSpec = parseJson<Record<string, unknown>>(hydratedSpec);
      const preferenceFilters = currentFeedPreferenceFilters();
      const feedOptions = feedQueryOptionsFromPreferences(preferenceFilters);
      if (isForYouSpec(parsedSpec)) {
        const input = withPreferenceRankedFilters(
          forYouInputFromSpec({
            parsed: parsedSpec,
            viewerPubkey: userPubkey,
            limit,
            offset,
          }),
          preferenceFilters
        );
        const page = await fetchNaggFeedPage(rankedFeedAppView(input), refresh, {
          signal,
          timeoutMs,
        });
        return logResult('for-you', mapNaggFeedPageResult(page, feedOptions));
      }
      if (isFollowingRepliesSpec(parsedSpec)) {
        if (!userPubkey) return logResult('following-replies-no-viewer', emptyFeedParseResult());
        const page = await fetchNaggFeedPage(
          followsFeedAppView({ pubkeys: [userPubkey], until, limit, offset }),
          refresh,
          { signal, timeoutMs }
        );
        return logResult('following-replies', mapNaggFeedPageResult(page, feedOptions));
      }
      if (isFollowingPopularSpec(parsedSpec)) {
        if (!userPubkey) return logResult('following-popular-no-viewer', emptyFeedParseResult());
        const input = withPreferenceRankedFilters(
          followingPopularInput({
            viewerPubkey: userPubkey,
            parsed: parsedSpec,
            limit,
            offset,
          }),
          preferenceFilters
        );
        const page = await fetchNaggFeedPage(rankedFeedAppView(input), refresh, {
          signal,
          timeoutMs,
        });
        return logResult('following-popular', mapNaggFeedPageResult(page, feedOptions));
      }
      if (isFollowingRecentSpec(parsedSpec)) {
        if (!userPubkey) return logResult('following-recent-no-viewer', emptyFeedParseResult());
        const page = await fetchNaggFeedPage(
          followsFeedAppView({ pubkeys: [userPubkey], until, limit, offset }),
          refresh,
          { signal, timeoutMs }
        );
        return logResult('following-recent', mapNaggFeedPageResult(page, feedOptions));
      }
      const genericPubkeys = pubkeysFromSpec(parsedSpec);
      const page = await fetchNaggFeedPage(
        followsFeedAppView({ pubkeys: genericPubkeys, until, limit, offset }),
        refresh,
        { signal, timeoutMs }
      );
      return logResult('generic', mapNaggFeedPageResult(page, feedOptions));
    },

    async getUserFeed({
      pubkey,
      authorName,
      authorPicture,
      limit = 50,
      until,
      offset,
      refresh,
      signal,
      timeoutMs,
    }: UserFeedPageRequest) {
      const page = await fetchNaggFeedPage(
        userFeedAppView({ pubkey, until, limit, offset }),
        refresh,
        { signal, timeoutMs }
      );
      return mapNaggFeedPage(page, {
        includeNote: (event) => event.pubkey === pubkey && isRootNote(event),
        includeRepost: (event) => event.pubkey === pubkey,
        extraProfile: authorName
          ? { pubkey, profile: { name: authorName, picture: authorPicture } }
          : undefined,
      });
    },

    async getPostsByPubkeys({
      pubkeys,
      limit = 30,
      until,
      offset,
      refresh,
      signal,
      timeoutMs,
    }: PostsByPubkeysRequest) {
      if (pubkeys.length === 0) {
        return mapNaggFeedPage(emptyNaggFeedPage(), {
          includeNote: () => false,
          includeRepost: () => false,
        });
      }
      const pubkeySet = new Set(pubkeys);
      const page = await fetchNaggFeedPage(
        followsFeedAppView({ pubkeys, until, limit, offset }),
        refresh,
        { signal, timeoutMs }
      );
      return mapNaggFeedPage(page, {
        includeNote: (event) => pubkeySet.has(event.pubkey) && isRootNote(event),
        includeRepost: (event) => pubkeySet.has(event.pubkey),
      });
    },

    async enrich({
      missingQuotedIds,
      missingProfilePubkeys,
      refresh,
      signal,
      timeoutMs,
    }: FeedEnrichmentRequest): Promise<FeedEnrichmentUpdates> {
      const tasks: Promise<FeedEnrichmentUpdates>[] = [];

      if (missingQuotedIds.length > 0) {
        tasks.push(
          runNaggRest(eventsAppView(missingQuotedIds), refresh, {
            responseSchema: NaggEnrichmentSchema,
            signal,
            timeoutMs,
          }).then((page) => ({
            metrics: new Map(Object.entries(page.metrics)) as Map<string, NoteMetrics>,
            profiles: new Map(Object.entries(page.profiles)) as Map<string, ProfileInfo>,
            quotedEvents: new Map(Object.entries(page.quoted)) as Map<string, FeedEvent>,
          }))
        );
      }

      if (missingProfilePubkeys.length > 0) {
        tasks.push(
          runNaggRest(profilesAppView(missingProfilePubkeys), refresh, {
            responseSchema: NaggEnrichmentSchema,
            signal,
            timeoutMs,
          }).then((page) => ({
            profiles: new Map(Object.entries(page.profiles)) as Map<string, ProfileInfo>,
          }))
        );
      }

      const responses = await Promise.all(tasks);
      const updates: FeedEnrichmentUpdates = {};
      for (const response of responses) {
        if (response.quotedEvents) {
          updates.quotedEvents ??= new Map();
          for (const [key, value] of response.quotedEvents) updates.quotedEvents.set(key, value);
        }
        if (response.metrics) {
          updates.metrics ??= new Map();
          for (const [key, value] of response.metrics) updates.metrics.set(key, value);
        }
        if (response.profiles) {
          updates.profiles ??= new Map();
          for (const [key, value] of response.profiles) updates.profiles.set(key, value);
        }
      }

      return updates;
    },

    async getNotifications({
      viewerPubkey,
      tab = 'ALL',
      policy = 'STRICT',
      replyScope = 'THREAD',
      since,
      until,
      limit = 50,
      refresh,
      grouped = true,
      signal,
      timeoutMs,
    }: FeedNotificationsRequest): Promise<FeedNotificationsResult> {
      const page = await runNaggRest(
        notificationsAppView({
          pubkey: viewerPubkey,
          tab,
          policy,
          replyScope,
          since,
          until,
          limit,
          grouped,
        }),
        refresh,
        { responseSchema: NaggNotificationsPageSchema, signal, timeoutMs }
      );
      const result = notificationsResultFromPage(page);
      feedLog.info('feed.notifications.fetch.done', {
        transport: 'appview',
        tab,
        policy,
        replyScope,
        pageNodes: page.notifications.nodes.length,
        results: result.notifications.length,
        metrics: result.metricsMap.size,
        profiles: result.profilesMap.size,
        paginationUntil: result.paginationUntil,
      });
      return result;
    },

    async getThread({
      eventId,
      limit = 10,
      offset = 0,
      sort = 'relevant',
      viewerPubkey,
      seed,
      signal,
      timeoutMs,
    }: ThreadRequest): Promise<ThreadResult> {
      const startedAt = Date.now();
      // A generous candidate fetch so the server-side relevance merge + ordering
      // see the full reply set; the page window (offset/limit) is applied to the
      // returned manifest. The viewer-specific reply order is computed by nagg
      // (`sort=relevant`), replacing the old client-side GraphQL merge.
      const candidateLimit = Math.max(100, offset + limit + RELEVANT_AUTHOR_REPLY_LIMIT + 1);
      // nagg's thread endpoint sorts by relevant | ranked | new; the legacy
      // engagement sorts (likes/zaps/reposts) all map to the server's `ranked`.
      const threadSort: 'relevant' | 'ranked' | 'new' =
        sort === 'relevant' || sort === 'new' ? sort : 'ranked';
      const page = await runNaggRest(
        threadAppView({
          id: eventId,
          limit: candidateLimit,
          sort: threadSort,
          viewer: viewerPubkey,
          offset,
          replyLimit: limit,
          candidateLimit,
          rankedLimit: Math.min(candidateLimit, 50),
        }),
        false,
        { responseSchema: NaggThreadSchema, signal, timeoutMs }
      );

      // The canonical thread carries the root + flat descendants + side maps;
      // FeedEvent/NoteMetrics/ProfileInfo are structurally the canonical shapes,
      // so hydrate the buckets directly. buildThreadStructure builds the tree;
      // the server `ordering` manifest is the reply render order.
      const buckets = {
        allEvents: seed ? new Map(seed.allEvents) : new Map<string, FeedEvent>(),
        profiles: seed ? new Map(seed.profiles) : new Map<string, ProfileInfo>(),
        metrics: seed ? new Map(seed.metrics) : new Map<string, NoteMetrics>(),
        quotedEvents: seed ? new Map(seed.quotedEvents) : new Map<string, FeedEvent>(),
      };
      const root = page.root as FeedEvent;
      buckets.allEvents.set(root.id, root);
      for (const event of page.events as FeedEvent[]) buckets.allEvents.set(event.id, event);
      for (const [id, metrics] of Object.entries(page.metrics)) {
        buckets.metrics.set(id, metrics as NoteMetrics);
      }
      for (const [pubkey, profile] of Object.entries(page.profiles)) {
        buckets.profiles.set(pubkey, profile as ProfileInfo);
      }
      for (const [id, quoted] of Object.entries(page.quoted)) {
        buckets.quotedEvents.set(id, quoted as FeedEvent);
      }

      const orderedReplyIds = page.ordering?.elements ?? page.events.map((event) => event.id);
      const thread = buildThreadStructure(eventId, buckets.allEvents);
      const targetMetrics = buckets.metrics.get(eventId);
      // Another page may exist when the candidate fetch saturated.
      const hasMoreReplies = page.events.length >= candidateLimit;

      feedLog.info('thread.nagg.appview.result', {
        eventId,
        sort,
        limit,
        offset,
        candidateLimit,
        durationMs: Date.now() - startedAt,
        seedEvents: seed?.allEvents.size ?? 0,
        allEvents: buckets.allEvents.size,
        replyCount: orderedReplyIds.length,
        replyPageEventIds: orderedReplyIds.map(shortId),
        renderedReplies: thread.replies.length,
        targetReplyCount: targetMetrics?.replyCount ?? null,
        hasMoreReplies,
      });

      return {
        ...buckets,
        thread,
        replyPageEventIds: orderedReplyIds,
        replyPageSize: limit,
        loadedReplyCount: orderedReplyIds.length,
        hasMoreReplies,
      };
    },
  };
}
