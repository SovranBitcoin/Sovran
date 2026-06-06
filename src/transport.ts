import { err, errAsync, ok, ResultAsync, type Result } from 'neverthrow';
import type { z } from 'zod';
import {
  NaggGraphqlEnvelopeSchema,
  type NaggServiceInfo,
} from './schemas';
import {
  DEFAULT_TIMEOUT_MS,
  combineSignals,
  timeoutSignal,
  type RequestControls,
} from './timeout';
import type { GraphqlError, NaggError } from './errors';
import { toNaggNetworkError } from './errors';

export type NaggGraphqlVariables = Record<string, unknown>;

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

/**
 * Which transport serves a request:
 * - `graphql`  → POST the generic GraphQL `/graphql` endpoint (recipes/semantics client-side).
 * - `appview`  → GET/POST nagg's server-shaped REST app-view (`/nostr/*`), normalized
 *                back into the same shape the GraphQL `dataSchema` validates.
 *
 * `appview` only applies to a request that carries an {@link NaggAppViewBinding} and to a
 * client configured with an {@link NaggAppViewConfig}; otherwise the GraphQL path is used,
 * so the switch degrades gracefully per-query.
 */
export type NaggTransport = 'graphql' | 'appview';

export interface NaggAppViewConfig {
  /** Base URL of the REST app-view (no trailing `/graphql`), e.g. `https://nagg.example`. */
  baseUrl: string;
  /** Route version prefix: `''` → `/nostr/*`, `'v1'` → `/v1/nostr/*`. Default `''`. */
  version?: '' | 'v1';
}

export type NaggSearchParams = Record<
  string,
  string | number | boolean | readonly string[] | null | undefined
>;

export interface NaggClientConfig {
  /** GraphQL endpoint, e.g. `https://nagg.example/graphql`. */
  endpoint: string;
  /** REST app-view base. Required for any request served via the `appview` transport. */
  appView?: NaggAppViewConfig;
  /** Default transport when a request doesn't specify its own. Default `'graphql'`. */
  transport?: NaggTransport;
  defaultTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: NaggTransportLogger;
}

/**
 * Declares how a single query is served by the REST app-view. `normalize` maps the raw
 * REST JSON into the SAME shape the request's `dataSchema` validates, so callers get an
 * identical, schema-checked result regardless of which transport ran.
 */
export interface NaggAppViewBinding {
  /** Route relative to the app-view base, e.g. `/nostr/feed`. The `/v1` prefix is applied by the client. */
  path: string;
  method?: 'GET' | 'POST';
  searchParams?: NaggSearchParams;
  /** POST body; ignored for GET. */
  body?: unknown;
  /** Map the raw REST JSON into the canonical shape that `dataSchema` parses. */
  normalize: (restJson: unknown) => unknown;
  /** Optional label for logging; defaults to the request's `operationName`. */
  operationName?: string;
}

/** A direct REST app-view request (no GraphQL fallback, no normalize layer). */
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

export interface NaggGraphqlRequest<TSchema extends z.ZodType> extends RequestControls {
  query: string;
  variables?: NaggGraphqlVariables;
  operationName?: string;
  dataSchema: TSchema;
  refresh?: boolean;
  /** Per-call transport override; falls back to the client's configured `transport`. */
  transport?: NaggTransport;
  /**
   * App-view binding for this query. Used only when the effective transport is `appview`
   * AND the client has an `appView` base configured; otherwise the GraphQL path runs.
   */
  appView?: NaggAppViewBinding;
}

export interface NaggClient {
  query<TSchema extends z.ZodType>(
    request: NaggGraphqlRequest<TSchema>
  ): ResultAsync<z.infer<TSchema>, NaggError>;
  /** Direct REST app-view call. Returns a typed Result (never throws). */
  rest<TSchema extends z.ZodType>(
    request: NaggRestRequest<TSchema>
  ): ResultAsync<z.infer<TSchema>, NaggError>;
  endpoint: string;
  /** The client's default transport. */
  transport: NaggTransport;
  /** REST app-view base, when configured (enables the `appview` transport). */
  appViewBaseUrl?: string;
}

type RawGraphqlPayload = {
  query: string;
  variables: NaggGraphqlVariables;
  operationName?: string;
};

export function createNaggClient(config: NaggClientConfig): NaggClient {
  const endpoint = config.endpoint.trim();
  const transport: NaggTransport = config.transport ?? 'graphql';
  const appViewBaseUrl = config.appView?.baseUrl?.trim() || undefined;
  return {
    endpoint,
    transport,
    appViewBaseUrl,
    query: <TSchema extends z.ZodType>(request: NaggGraphqlRequest<TSchema>) => {
      const effective = request.transport ?? transport;
      // Prefer the REST app-view only when explicitly selected, a binding is present,
      // and a base URL is configured — otherwise fall through to GraphQL.
      if (effective === 'appview' && request.appView && appViewBaseUrl) {
        return fetchAppViewQuery(config, appViewBaseUrl, request);
      }
      return postGraphql(config, endpoint, request);
    },
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

function postGraphql<TSchema extends z.ZodType>(
  config: NaggClientConfig,
  endpoint: string,
  request: NaggGraphqlRequest<TSchema>
): ResultAsync<z.infer<TSchema>, NaggError> {
  if (!endpoint) {
    return errAsync({
      type: 'endpoint_required',
      message: 'GraphQL endpoint is required',
    });
  }

  const operationName = request.operationName ?? operationNameFromQuery(request.query);
  const variables = request.variables ?? {};
  const startedAt = Date.now();
  const refresh = request.refresh === true;
  config.logger?.onRequestStart?.({
    operationName,
    endpoint,
    variables: summarizeVariables(variables),
    refresh,
  });

  const execute: ResultAsync<Response, NaggError> = ResultAsync.fromThrowable(
    () => fetchGraphql(config, endpoint, request, { query: request.query, variables, operationName }),
    toNaggNetworkError
  )();

  return execute.andThen((response): ResultAsync<z.infer<TSchema>, NaggError> => {
    if (!response.ok) {
      const error: NaggError = {
        type: 'http',
        message: `GraphQL fetch failed: ${response.status} ${response.statusText}`,
        status: response.status,
        statusText: response.statusText,
      };
      logEnd(config, endpoint, operationName, variables, refresh, startedAt, false, response.status, error.type);
      return errAsync(error);
    }
    return ResultAsync.fromPromise(response.json() as Promise<unknown>, toNaggNetworkError)
      .andThen((raw) => parseGraphqlData(raw, request.dataSchema))
      .map((data) => {
        logEnd(config, endpoint, operationName, variables, refresh, startedAt, true, response.status);
        return data;
      })
      .mapErr((error) => {
        logEnd(config, endpoint, operationName, variables, refresh, startedAt, false, response.status, error.type);
        return error;
      });
  });
}

function fetchGraphql<TSchema extends z.ZodType>(
  config: NaggClientConfig,
  endpoint: string,
  request: NaggGraphqlRequest<TSchema>,
  payload: RawGraphqlPayload
): Promise<Response> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = request.timeoutMs ?? config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = combineSignals(request.signal, timeoutSignal(timeoutMs));
  const url = refreshUrl(endpoint, request.refresh === true);
  return fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(request.refresh === true
        ? {
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          }
        : {}),
    },
    cache: request.refresh === true ? 'no-store' : undefined,
    body: JSON.stringify(payload),
    signal,
  });
}

export function parseGraphqlData<TSchema extends z.ZodType>(
  raw: unknown,
  dataSchema: TSchema
): Result<z.infer<TSchema>, NaggError> {
  const envelope = NaggGraphqlEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return err({
      type: 'schema',
      message: 'GraphQL response did not match the envelope shape',
      issues: envelope.error.issues,
    });
  }
  const graphqlErrors = envelope.data.errors as GraphqlError[] | undefined;
  if (graphqlErrors?.length) {
    return err({
      type: 'graphql',
      message: graphqlErrors[0]?.message ?? 'GraphQL request failed',
      errors: graphqlErrors,
    });
  }
  if (envelope.data.data === undefined) {
    return err({ type: 'missing_data', message: 'GraphQL response did not include data' });
  }
  const data = dataSchema.safeParse(envelope.data.data);
  if (!data.success) {
    return err({
      type: 'schema',
      message: 'GraphQL response data did not match the expected shape',
      issues: data.error.issues,
    });
  }
  return ok(data.data);
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
    url.searchParams.set('refresh', '1');
    url.searchParams.set('_refresh', String(Date.now()));
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
  const url = appViewUrl(baseUrl, config.appView?.version, opts.path, opts.searchParams, refresh);
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

function fetchAppViewQuery<TSchema extends z.ZodType>(
  config: NaggClientConfig,
  baseUrl: string,
  request: NaggGraphqlRequest<TSchema>
): ResultAsync<z.infer<TSchema>, NaggError> {
  const binding = request.appView as NaggAppViewBinding;
  const operationName =
    binding.operationName ?? request.operationName ?? operationNameFromQuery(request.query);
  return fetchAppViewRaw(config, baseUrl, {
    method: binding.method ?? 'GET',
    path: binding.path,
    searchParams: binding.searchParams,
    body: binding.body,
    refresh: request.refresh,
    signal: request.signal,
    timeoutMs: request.timeoutMs,
    operationName,
  }).andThen((raw) => parseRestData(binding.normalize(raw), request.dataSchema));
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

function refreshUrl(endpoint: string, refresh: boolean): string {
  if (!refresh) return endpoint;
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}refresh=1&_refresh=${Date.now()}`;
}

function logEnd(
  config: NaggClientConfig,
  endpoint: string,
  operationName: string,
  variables: NaggGraphqlVariables,
  refresh: boolean,
  startedAt: number,
  okResponse: boolean,
  status?: number,
  errorType?: NaggError['type']
): void {
  config.logger?.onRequestEnd?.({
    operationName,
    endpoint,
    variables: summarizeVariables(variables),
    refresh,
    durationMs: Date.now() - startedAt,
    ok: okResponse,
    status,
    errorType,
  });
}

function operationNameFromQuery(query: string): string {
  const match = /\b(?:query|mutation)\s+([A-Za-z0-9_]+)/.exec(query);
  return match?.[1] ?? 'anonymous';
}

function summarizeVariables(variables: NaggGraphqlVariables): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (Array.isArray(value)) {
      summary[key] = { count: value.length };
      continue;
    }
    if (value && typeof value === 'object') {
      summary[key] = '[object]';
      continue;
    }
    summary[key] = value;
  }
  return summary;
}

export type { NaggError, RequestControls, NaggServiceInfo };
