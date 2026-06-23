import { err, errAsync, ok, ResultAsync, type Result } from 'neverthrow';
import type { z } from 'zod';
import {
  DEFAULT_TIMEOUT_MS,
  combineSignals,
  timeoutSignal,
  type RequestControls,
} from './timeout';
import type { NaggError } from './errors';
import { toNaggNetworkError } from './errors';

export interface NaggTransportLogger {
  onRequestStart?: (event: NaggRequestLogEvent) => void;
  onRequestEnd?: (event: NaggResponseLogEvent) => void;
}

export interface NaggRequestLogEvent {
  operationName: string;
  endpoint: string;
  variables: Record<string, unknown>;
  refresh: boolean;
}

export interface NaggResponseLogEvent extends NaggRequestLogEvent {
  durationMs: number;
  ok: boolean;
  status?: number;
  errorType?: NaggError['type'];
}

export interface NaggAppViewConfig {
  /** Base URL of the REST app-view, e.g. `https://nagg.example`. */
  baseUrl: string;
  /** Route version prefix: `''` → `/nostr/*`, `'v1'` → `/v1/nostr/*`. Default `''`. */
  version?: '' | 'v1';
}

export type NaggSearchParams = Record<
  string,
  string | number | boolean | readonly string[] | null | undefined
>;

export interface NaggClientConfig {
  /** REST app-view base. The only transport — every read is served from here. */
  appView: NaggAppViewConfig;
  defaultTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: NaggTransportLogger;
}

/**
 * Declares how a single read reaches a nagg REST route. The REST body IS the
 * canonical shape the caller's schema validates (nagg's app-view emits it
 * directly), so a binding is just route + params/body — there is no normalize
 * layer and no GraphQL fallback. The recipes build these; the facade/client
 * hands them to {@link NaggClient.rest}.
 */
export interface NaggAppViewBinding {
  /** Route relative to the app-view base, e.g. `/nostr/feed`. The `/v1` prefix is applied by the client. */
  path: string;
  method?: 'GET' | 'POST';
  searchParams?: NaggSearchParams;
  /** POST body; ignored for GET. */
  body?: unknown;
  /** Optional label for logging. */
  operationName?: string;
}

/** A REST app-view request: the only request shape the client serves. */
export interface NaggRestRequest<TSchema extends z.ZodType> extends RequestControls {
  /** Route relative to the app-view base, e.g. `/nostr/profile`. */
  path: string;
  method?: 'GET' | 'POST';
  searchParams?: NaggSearchParams;
  body?: unknown;
  /** Parses the raw REST JSON directly. */
  responseSchema: TSchema;
  refresh?: boolean;
  operationName?: string;
}

export interface NaggClient {
  /** REST app-view call. Returns a typed Result (never throws). */
  rest<TSchema extends z.ZodType>(
    request: NaggRestRequest<TSchema>
  ): ResultAsync<z.infer<TSchema>, NaggError>;
  /** REST app-view base. */
  appViewBaseUrl: string;
}

export function createNaggClient(config: NaggClientConfig): NaggClient {
  const appViewBaseUrl = config.appView.baseUrl.trim();
  return {
    appViewBaseUrl,
    rest: <TSchema extends z.ZodType>(request: NaggRestRequest<TSchema>) => {
      if (!appViewBaseUrl) {
        return errAsync<z.infer<TSchema>, NaggError>({
          type: 'endpoint_required',
          message: 'App-view baseUrl is required for REST requests',
        });
      }
      return fetchAppViewRest(config, appViewBaseUrl, request);
    },
  };
}

// ---------------------------------------------------------------------------
// App-view REST transport
// ---------------------------------------------------------------------------

function appViewUrl(
  baseUrl: string,
  version: '' | 'v1' | undefined,
  path: string,
  searchParams: NaggSearchParams | undefined,
  refresh: boolean
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const versionPrefix = version === 'v1' ? '/v1' : '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${base}${versionPrefix}${normalizedPath}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        if (value.length > 0) url.searchParams.set(key, value.join(','));
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  if (refresh) {
    // `refresh=1` tells nagg to revalidate; the no-store fetch + Cache-Control
    // headers already defeat any HTTP cache, so we do NOT add a volatile
    // timestamp that would make every refresh a unique key on nagg's cache.
    url.searchParams.set('refresh', '1');
  }
  return url.toString();
}

interface AppViewFetchOptions extends RequestControls {
  method: 'GET' | 'POST';
  path: string;
  searchParams?: NaggSearchParams;
  body?: unknown;
  refresh?: boolean;
  operationName: string;
}

function fetchAppViewRaw(
  config: NaggClientConfig,
  baseUrl: string,
  opts: AppViewFetchOptions
): ResultAsync<unknown, NaggError> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const refresh = opts.refresh === true;
  const url = appViewUrl(baseUrl, config.appView.version, opts.path, opts.searchParams, refresh);
  const timeoutMs = opts.timeoutMs ?? config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = combineSignals(opts.signal, timeoutSignal(timeoutMs));
  const startedAt = Date.now();
  config.logger?.onRequestStart?.({
    operationName: opts.operationName,
    endpoint: url,
    variables: {},
    refresh,
  });

  const init: RequestInit = {
    method: opts.method,
    headers: {
      Accept: 'application/json',
      ...(opts.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...(refresh ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } : {}),
    },
    ...(opts.method === 'POST' && opts.body !== undefined
      ? { body: JSON.stringify(opts.body) }
      : {}),
    cache: refresh ? 'no-store' : undefined,
    signal,
  };

  const execute: ResultAsync<Response, NaggError> = ResultAsync.fromThrowable(
    () => fetchImpl(url, init),
    toNaggNetworkError
  )();

  return execute.andThen((response): ResultAsync<unknown, NaggError> => {
    if (!response.ok) {
      const error: NaggError = {
        type: 'http',
        message: `App-view fetch failed: ${response.status} ${response.statusText}`,
        status: response.status,
        statusText: response.statusText,
      };
      logAppViewEnd(config, url, opts.operationName, refresh, startedAt, false, response.status, error.type);
      return errAsync(error);
    }
    return ResultAsync.fromPromise(response.json() as Promise<unknown>, toNaggNetworkError)
      .map((raw) => {
        logAppViewEnd(config, url, opts.operationName, refresh, startedAt, true, response.status);
        return raw;
      })
      .mapErr((error) => {
        logAppViewEnd(config, url, opts.operationName, refresh, startedAt, false, response.status, error.type);
        return error;
      });
  });
}

function fetchAppViewRest<TSchema extends z.ZodType>(
  config: NaggClientConfig,
  baseUrl: string,
  request: NaggRestRequest<TSchema>
): ResultAsync<z.infer<TSchema>, NaggError> {
  const operationName = request.operationName ?? request.path;
  return fetchAppViewRaw(config, baseUrl, {
    method: request.method ?? 'GET',
    path: request.path,
    searchParams: request.searchParams,
    body: request.body,
    refresh: request.refresh,
    signal: request.signal,
    timeoutMs: request.timeoutMs,
    operationName,
  }).andThen((raw) => parseRestData(raw, request.responseSchema));
}

function parseRestData<TSchema extends z.ZodType>(
  raw: unknown,
  schema: TSchema
): Result<z.infer<TSchema>, NaggError> {
  const data = schema.safeParse(raw);
  if (!data.success) {
    return err({
      type: 'schema',
      message: 'App-view response data did not match the expected shape',
      issues: data.error.issues,
    });
  }
  return ok(data.data);
}

function logAppViewEnd(
  config: NaggClientConfig,
  endpoint: string,
  operationName: string,
  refresh: boolean,
  startedAt: number,
  okResponse: boolean,
  status?: number,
  errorType?: NaggError['type']
): void {
  config.logger?.onRequestEnd?.({
    operationName,
    endpoint,
    variables: {},
    refresh,
    durationMs: Date.now() - startedAt,
    ok: okResponse,
    status,
    errorType,
  });
}

export type { NaggError, RequestControls };
