import {
  createNaggClient,
  NaggEnvelopeSchema,
  enrichmentFromEnvelope,
  type NaggAppViewBinding,
  type NaggError,
} from 'nostr';
import { eventsAppView, profilesAppView } from 'nostr/recipes';
import type { z } from 'zod';
import { backendConfig } from '@/shared/config/backend';
import { apiLog, redactError } from '@/shared/lib/logger';
import type { FeedClient, FeedEnrichmentRequest, FeedEnrichmentUpdates } from './feedClient';
import type { FeedEvent, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';

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
 * (path + params/body, from a recipe) and the route's envelope `responseSchema`;
 * nagg v2 answers every app-view route with the ONE generic envelope
 * (`{ order, orderBy, events, aggregates, cursor? }`), which the caller
 * reconstructs into the canonical shape via `nostr`'s envelope helpers
 * (`enrichmentFromEnvelope`). Errors are logged and rethrown.
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

// Counts the rows in a parsed payload for log diagnostics — distinguishes
// "request returned data" from "request returned an empty page". A v2 envelope
// carries the server render order in `order` (anchor ids), so prefer it; fall
// back to `events`/`entries` for routes whose order is empty by design.
function countCanonical(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const v = value as {
    order?: unknown[];
    entries?: unknown[];
    events?: unknown[];
  };
  if (Array.isArray(v.order) && v.order.length > 0) return v.order.length;
  if (Array.isArray(v.entries) && v.entries.length > 0) return v.entries.length;
  if (Array.isArray(v.events)) return v.events.length;
  return 0;
}

function errorFromNaggError(error: NaggError): Error {
  const out = new Error(error.message, { cause: error });
  out.name =
    error.type === 'network' && /abort|timed out|timeout/i.test(error.message)
      ? 'AbortError'
      : 'NaggError';
  return out;
}

// Feeds, threads and notifications are served by the facade waterfall
// (createFacadeFeedClient), whose nagg tier speaks the same app-view. What is
// left here is the one read that waterfall does not make: filling in quoted
// posts and profiles a page referred to.
export function createNaggFeedClient(): Pick<FeedClient, 'enrich'> {
  return {
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
            responseSchema: NaggEnvelopeSchema,
            signal,
            timeoutMs,
          }).then((envelope) => {
            const page = enrichmentFromEnvelope(envelope);
            return {
              metrics: new Map(Object.entries(page.metrics)) as Map<string, NoteMetrics>,
              profiles: new Map(Object.entries(page.profiles)) as Map<string, ProfileInfo>,
              quotedEvents: new Map(Object.entries(page.quoted)) as Map<string, FeedEvent>,
            };
          })
        );
      }

      if (missingProfilePubkeys.length > 0) {
        tasks.push(
          runNaggRest(profilesAppView(missingProfilePubkeys), refresh, {
            responseSchema: NaggEnvelopeSchema,
            signal,
            timeoutMs,
          }).then((envelope) => ({
            profiles: new Map(Object.entries(enrichmentFromEnvelope(envelope).profiles)) as Map<
              string,
              ProfileInfo
            >,
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
  };
}
