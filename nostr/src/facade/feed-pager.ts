import type { NostrCursor, NostrTier } from "@sovranbitcoin/schemas";
import { ResultAsync } from "neverthrow";
import { toNaggNetworkError } from "../errors";
import { nostrLog, type NostrLogger } from "../log";
import {
  assembleFeedPage,
  feedItemId,
  type FeedPageRequest,
  type ResolvedFeedPage,
} from "./feed";
import type { NostrTierStrategy } from "./strategy";

export type FeedLaneState = "ready" | "backoff" | "exhausted" | "unsupported";
type Lane = {
  tier: NostrTier;
  cursor: NostrCursor;
  offset: number;
  state: FeedLaneState;
  failures: number;
  retryAtMs: number;
  boundaryGrace: boolean;
  pending: ResolvedFeedPage | null;
};
export type FeedPagerPage = {
  pages: ResolvedFeedPage[];
  cursor: NostrCursor;
  hasMore: boolean;
  retryAfterMs?: number;
  sources: NostrTier[];
  showingRecent: boolean;
};
export type FeedPagerOptions = Omit<
  FeedPageRequest,
  "signal" | "cursor" | "offset"
> & {
  tiers: readonly NostrTierStrategy[];
  clock?: () => number;
  log?: NostrLogger;
  ingest?: (page: ResolvedFeedPage) => void;
  seen?: Iterable<string>;
};
export type FeedPager = {
  nextPage(signal?: AbortSignal): Promise<FeedPagerPage>;
  dispose(): void;
};
const BACKOFF_MS = [1_000, 4_000, 15_000, 60_000];

// React Native's abort-controller polyfill does not implement throwIfAborted.
function checkAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Feed read aborted");
  error.name = "AbortError";
  throw error;
}

/** Lane progress and buffered overflow commit together, only after a non-aborted read. */
export function createFeedPager(options: FeedPagerOptions): FeedPager {
  const { tiers, spec, clock = Date.now, log = nostrLog, ingest } = options;
  const limit = Math.max(1, options.limit ?? 30);
  const ranked = spec.kind === "for-you" || spec.kind === "following-popular";
  let lanes: Lane[] = tiers.map(({ tier, feedPage }) => ({
    tier,
    cursor: null,
    offset: 0,
    state: feedPage ? "ready" : "unsupported",
    failures: 0,
    retryAtMs: 0,
    boundaryGrace: false,
    pending: null,
  }));
  const seen = new Set(options.seen);
  let seq = 0;
  const lifetime = new AbortController();
  let reading = false;

  async function nextPage(signal?: AbortSignal): Promise<FeedPagerPage> {
    if (reading) throw new Error("Feed pager already reading");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    lifetime.signal.addEventListener("abort", abort, { once: true });
    if (signal?.aborted || lifetime.signal.aborted) abort();
    reading = true;
    try {
      const draft = lanes.map((lane) => ({ ...lane }));
      const nextSeen = new Set<string>();
      const pages: ResolvedFeedPage[] = [];
      let count = 0;
      let cursor: NostrCursor = null;
      for (const [index, lane] of draft.entries()) {
        checkAborted(controller.signal);
        if (count >= limit) break;
        let page = lane.pending;
        if (!page) {
          if (lane.state === "exhausted" || lane.state === "unsupported")
            continue;
          if (lane.state === "backoff" && clock() < lane.retryAtMs) continue;
          const requestSpec =
            ranked && lane.tier !== "nagg"
              ? {
                  kind: "following-recent" as const,
                  ...(spec.kind === "following-popular"
                    ? { viewerPubkey: spec.viewerPubkey }
                    : {}),
                }
              : spec;
          const outcome = await ResultAsync.fromPromise(
            tiers[index].feedPage!({
              spec: requestSpec,
              cursor: lane.cursor,
              offset: lane.offset,
              limit: limit * 2,
              signal: controller.signal,
              timeoutMs: options.timeoutMs,
              maxContentLength: options.maxContentLength,
              refresh: options.refresh,
            }),
            toNaggNetworkError,
          );
          checkAborted(controller.signal);
          const answer = outcome.isOk()
            ? outcome.value
            : { kind: "failed" as const, error: outcome.error };
          if (answer.kind === "unsupported") {
            lane.state = "unsupported";
            continue;
          }
          if (answer.kind === "failed") {
            lane.failures++;
            lane.state = "backoff";
            const retryAfterMs = BACKOFF_MS[Math.min(lane.failures - 1, 3)];
            lane.retryAtMs = clock() + retryAfterMs;
            log.info("nostr.feed.pager.backoff", {
              tier: lane.tier,
              retryAfterMs,
            });
            continue;
          }
          const served = assembleFeedPage(lane.tier, answer.value);
          ingest?.(served);
          const fresh = served.items.filter((item) => {
            const id = feedItemId(item);
            if (seen.has(id) || nextSeen.has(id)) return false;
            nextSeen.add(id);
            return true;
          });
          lane.state = "ready";
          lane.failures = 0;
          lane.retryAtMs = 0;
          if (ranked && lane.tier === "nagg") {
            lane.offset += served.items.length;
            if (served.hasMore === false || served.items.length === 0)
              lane.state = "exhausted";
          } else {
            const next = served.cursor;
            if (
              next &&
              (!lane.cursor || next.createdAt < lane.cursor.createdAt)
            ) {
              lane.cursor = next;
              lane.boundaryGrace = false;
            } else if (
              next &&
              lane.cursor &&
              next.createdAt === lane.cursor.createdAt &&
              fresh.length &&
              !lane.boundaryGrace
            ) {
              lane.cursor = next;
              lane.boundaryGrace = true;
            } else {
              lane.state = "exhausted";
            }
            if (served.items.length < limit * 2 || served.hasMore === false)
              lane.state = "exhausted";
          }
          log.info("nostr.feed.pager.page", {
            seq: seq + 1,
            tier: lane.tier,
            fresh: fresh.length,
            dupes: served.items.length - fresh.length,
            laneState: lane.state,
          });
          page = { ...served, items: fresh };
        }
        const items = page.items.slice(0, limit - count);
        lane.pending =
          page.items.length > items.length
            ? { ...page, items: page.items.slice(items.length) }
            : null;
        if (items.length) {
          pages.push({ ...page, items });
          count += items.length;
          cursor = page.cursor;
        }
      }
      checkAborted(controller.signal);
      lanes = draft;
      for (const id of nextSeen) seen.add(id);
      seq++;
      const hasMore = lanes.some(
        (lane) =>
          lane.pending || lane.state === "ready" || lane.state === "backoff",
      );
      const retries = lanes
        .filter((lane) => lane.state === "backoff")
        .map((lane) => Math.max(0, lane.retryAtMs - clock()));
      const sources = [...new Set(pages.map((page) => page.tier))];
      return {
        pages,
        cursor,
        hasMore,
        sources,
        showingRecent: ranked && sources.some((tier) => tier !== "nagg"),
        ...(count === 0 && hasMore
          ? { retryAfterMs: retries.length ? Math.min(...retries) : 1_000 }
          : {}),
      };
    } finally {
      reading = false;
      signal?.removeEventListener("abort", abort);
      lifetime.signal.removeEventListener("abort", abort);
    }
  }
  return { nextPage, dispose: () => lifetime.abort() };
}
