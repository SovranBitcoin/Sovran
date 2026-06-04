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

export interface NaggClientConfig {
  endpoint: string;
  defaultTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: NaggTransportLogger;
}

export interface NaggGraphqlRequest<TSchema extends z.ZodType> extends RequestControls {
  query: string;
  variables?: NaggGraphqlVariables;
  operationName?: string;
  dataSchema: TSchema;
  refresh?: boolean;
}

export interface NaggClient {
  query<TSchema extends z.ZodType>(
    request: NaggGraphqlRequest<TSchema>
  ): ResultAsync<z.infer<TSchema>, NaggError>;
  endpoint: string;
}

type RawGraphqlPayload = {
  query: string;
  variables: NaggGraphqlVariables;
  operationName?: string;
};

export function createNaggClient(config: NaggClientConfig): NaggClient {
  const endpoint = config.endpoint.trim();
  return {
    endpoint,
    query: <TSchema extends z.ZodType>(request: NaggGraphqlRequest<TSchema>) =>
      postGraphql(config, endpoint, request),
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
