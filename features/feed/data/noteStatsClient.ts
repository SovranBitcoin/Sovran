/**
 * Per-note engagement counts from nagg's dedicated `POST /nostr/notes/stats`
 * endpoint. The inline feed `noteStats` join is flaky (nagg documents it
 * resetting concurrent ClickHouse connections under load), so feed posts often
 * render with zero counts. This endpoint is the reliable single-query source —
 * we lazy-fetch it for visible notes and merge the result into the feed's
 * metrics map, where the counts animate in.
 */
import { z } from 'zod';
import { createNaggClient, NaggNoteMetricsSchema } from '@sovranbitcoin/nagg-ts';
import { noteStatsAppView } from '@sovranbitcoin/nagg-ts/recipes';

import { backendConfig } from '@/shared/config/backend';
import { feedLog } from '@/shared/lib/logger';
import type { NoteMetrics } from '../components/nostr/feedTypes';

const STATS_TIMEOUT_MS = 10_000;
/** nagg caps `/nostr/notes/stats` at 100 ids per request. */
const MAX_IDS = 100;

const client = createNaggClient({
  endpoint: backendConfig.nostrGraphqlEndpoint,
  appView: { baseUrl: backendConfig.nostrAppViewBaseUrl, version: 'v1' },
  transport: 'appview',
  defaultTimeoutMs: STATS_TIMEOUT_MS,
});

// The endpoint returns the canonical `map[eventId]NoteStats`.
const NoteStatsResponseSchema = z.record(z.string(), NaggNoteMetricsSchema);

/** Fetch authoritative engagement counts for up to 100 note ids. Best-effort:
 *  returns an empty map on failure so callers keep their existing metrics. */
export async function fetchNoteStats(
  ids: readonly string[],
  signal?: AbortSignal
): Promise<Map<string, NoteMetrics>> {
  const unique = [...new Set(ids.filter((id) => id.length === 64))].slice(0, MAX_IDS);
  if (unique.length === 0) return new Map();

  const binding = noteStatsAppView(unique);
  const result = await client.rest<typeof NoteStatsResponseSchema>({
    path: binding.path,
    method: binding.method ?? 'POST',
    body: binding.body,
    responseSchema: NoteStatsResponseSchema,
    operationName: binding.operationName,
    signal,
  });
  if (result.isErr()) {
    feedLog.debug('feed.notestats.failed', { ids: unique.length, error: result.error.message });
    return new Map();
  }
  const out = new Map<string, NoteMetrics>();
  for (const [id, m] of Object.entries(result.value)) {
    out.set(id, {
      likeCount: m.likeCount,
      repostCount: m.repostCount,
      replyCount: m.replyCount,
      satsZapped: m.satsZapped,
    });
  }
  feedLog.debug('feed.notestats.done', { requested: unique.length, returned: out.size });
  return out;
}
