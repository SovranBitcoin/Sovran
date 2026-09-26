/**
 * @fileoverview The SDK's own diagnosis, without its token-bearing lane.
 *
 * `@routstr/sdk` was given `noopLogger` because its DEBUG stream prints raw
 * refund bodies and whole cashu tokens — logging that is not safe to keep. The
 * cost showed up the first time a request failed for a reason only the SDK
 * knew: a node refused a correctly priced 38-sat token from a mint it accepts,
 * and every trace of why was discarded. The app could only report its own
 * verdict, `no_providers`, which says that the walk ended, not what ended it.
 *
 * WARN and ERROR are a different lane from DEBUG. They carry the upstream
 * status, the failover decision and the refusal text — the answer to "why did
 * this provider fail" — so those two are forwarded and the other two stay
 * dropped. Values still pass through the app logger's redaction, which brands
 * anything token-, key- or invoice-shaped rather than printing it, so a stray
 * secret in a warning is caught by the same net as everywhere else.
 *
 * Forwarding alone turned out not to be enough. The app logger compacts any
 * string over 120 characters to a 32-character preview, and the SDK's most
 * load-bearing lines put their reason at the END: `createProviderToken:
 * mint=<url> failed: Failed to fetch mint <url>` is 124 characters, so every
 * copy in `app/log.txt` reads `{"_kind":"long_string","len":124,"preview":
 * "createProviderToken: mint=https:…"}` — the name of the phase, and not one
 * word of why it failed. Same for `Upstream error response`, whose `body`
 * holds the node's `{"error":{"message":…}}` and survived as `"{\"error\":
 * {\"message\": \"Error for…"`. So this module does the bounding itself:
 * redact first, then keep a head AND a tail under the cap, and lift the
 * fields a reader actually greps for — status, host, path, request id, and
 * the upstream's own reason — out of the detail blob and onto flat params.
 */

import { apiLog, redactKnownSecretSubstrings } from '@/shared/lib/logger';

/** `@routstr/sdk`'s logger seam. Varargs, console-style. */
interface SdkLogger {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  child: (prefix: string) => SdkLogger;
}

/**
 * Just under the app logger's 120-character compaction threshold, so a bounded
 * field always prints as itself rather than as a `{_kind, len, preview}` stub.
 */
const FIELD_MAX = 118;

/** The leading string is the SDK's own message; the rest is its detail. */
function split(args: readonly unknown[]): { message: string; detail: unknown[] } {
  const [head, ...rest] = args;
  return typeof head === 'string'
    ? { message: head, detail: rest }
    : { message: '', detail: [...args] };
}

/**
 * Put `text` on `params` under `key`, whole if it fits and head-plus-tail if
 * not.
 *
 * Secrets are removed BEFORE the slice, never after: cutting a cashu token in
 * half would hand each half to the classifier as anonymous base64 and defeat
 * the branding that makes this lane safe at all.
 */
function putBounded(params: Record<string, unknown>, key: string, text: string): void {
  const safe = redactKnownSecretSubstrings(text);
  if (safe.length <= FIELD_MAX) {
    params[key] = safe;
    return;
  }
  params[key] = safe.slice(0, FIELD_MAX);
  params[`${key}Tail`] = safe.slice(-FIELD_MAX);
  params[`${key}Len`] = safe.length;
}

/** The host of a URL, without pulling in a `URL` parser React Native fakes. */
function hostOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^[a-z]+:\/\/([^/?#]+)/i.exec(value)?.[1];
}

/** Scalars the SDK attaches to its structured warnings, worth their own field. */
const SCALAR_KEYS = [
  'status',
  'statusText',
  'requestId',
  'errorType',
  'errorCode',
  'path',
  'baseUrl',
  'url',
] as const;

/**
 * What the node's error body says, in the three fields that decide anything.
 *
 * routstr-core answers with either an OpenAI-shaped `{"error":{"message":…}}`
 * (usually forwarded verbatim from whoever it called) or FastAPI's
 * `{"detail":…}`. Both are the difference between "this node is down" and
 * "this node's OpenRouter credit is exhausted", which is the whole question
 * when a perfectly healthy catalog still answers 404.
 *
 * `type` and `code` matter as much as the sentence. An X-Cashu node that
 * forwards an upstream failure discards the upstream body and answers
 * `{"type":"upstream_error","code":<upstream status>}` under that status,
 * with the full refund in the header — which is a fact about ONE MODEL's
 * upstream, and the only thing that separates it from the node's own 404 or
 * 500. The candidate walk reads these to decide whether to try the next
 * model on the same node or to stop.
 */
interface SdkErrorEnvelope {
  message?: string;
  type?: string;
  code?: string | number;
}

function upstreamEnvelope(body: string): SdkErrorEnvelope {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return {};
    const record = parsed as { error?: unknown; detail?: unknown; message?: unknown };
    // FastAPI's `detail` may itself wrap an `error` object (nodes ≥ v0.4.5
    // copy it to the top level too; older ones do not).
    const detail = record.detail;
    const error =
      record.error ??
      (detail && typeof detail === 'object' ? (detail as { error?: unknown }).error : undefined) ??
      (detail && typeof detail === 'object' ? detail : undefined);
    if (typeof error === 'string') return { message: error };
    if (error && typeof error === 'object') {
      const { message, type, code } = error as {
        message?: unknown;
        type?: unknown;
        code?: unknown;
      };
      return {
        ...(typeof message === 'string' ? { message } : {}),
        ...(typeof type === 'string' ? { type } : {}),
        ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
      };
    }
    if (typeof detail === 'string') return { message: detail };
    if (typeof record.message === 'string') return { message: record.message };
    return {};
  } catch {
    return {};
  }
}

/**
 * One refusal the SDK saw on the wire, handed to whoever built the logger.
 *
 * The SDK folds every non-OK response into its provider failover and, when
 * that walk is one node long, throws `FailoverError` — which carries no
 * status, no body and no request id. The one place the real answer survives
 * is this log line. So the logger is also the channel: a caller that passes
 * `onRefusal` gets the status the node actually returned and can put it back
 * on the error the SDK threw away.
 */
export interface SdkRefusal {
  status: number;
  requestId?: string;
  path?: string;
  message?: string;
  type?: string;
  code?: string | number;
}

const UPSTREAM_ERROR_MESSAGE = 'Upstream error response';

/**
 * Flatten the SDK's first detail argument onto `params`.
 *
 * Returns whether anything was lifted, because a detail this did not
 * understand still has to travel — unflattened — rather than be dropped.
 */
function flatten(params: Record<string, unknown>, detail: unknown): boolean {
  if (detail instanceof Error) {
    params.errorName = detail.name;
    putBounded(params, 'reason', detail.message);
    return true;
  }
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return false;
  const record = detail as Record<string, unknown>;
  let lifted = false;
  for (const key of SCALAR_KEYS) {
    const value = record[key];
    if (value == null) continue;
    if (key === 'baseUrl' || key === 'url') {
      const host = hostOf(value);
      if (host && params.host == null) {
        params.host = host;
        lifted = true;
      }
      continue;
    }
    if (typeof value === 'string') putBounded(params, key, value);
    else if (typeof value === 'number' || typeof value === 'boolean') params[key] = value;
    else continue;
    lifted = true;
  }
  // A transport failure's own words ("The request timed out", "The network
  // connection was lost"). The SDK puts them under `error`, not `body`, and
  // they went unlifted: the one send in the 2026-09-26 log that died at the
  // 60-second mark logged `Network error fetching from provider` and nothing
  // about why.
  const transport = record.error;
  if (typeof transport === 'string' && params.reason == null) {
    putBounded(params, 'reason', transport);
    params.reasonParsed = true;
    lifted = true;
  }
  const body = record.body;
  if (typeof body === 'string') {
    params.bodyLen = body.length;
    const envelope = upstreamEnvelope(body);
    putBounded(params, 'reason', envelope.message ?? body);
    params.reasonParsed = envelope.message != null;
    // The node's own classification, when it gave one. `errorType` and
    // `errorCode` are the names the SDK's own structured warnings use for the
    // same two facts, so a reader greps once.
    if (envelope.type != null && params.errorType == null) params.errorType = envelope.type;
    if (envelope.code != null && params.errorCode == null) params.errorCode = envelope.code;
    lifted = true;
  }
  return lifted;
}

/** The refusal a flattened "Upstream error response" line describes. */
function refusalFrom(params: Record<string, unknown>): SdkRefusal | null {
  if (typeof params.status !== 'number') return null;
  return {
    status: params.status,
    ...(typeof params.requestId === 'string' ? { requestId: params.requestId } : {}),
    ...(typeof params.path === 'string' ? { path: params.path } : {}),
    ...(typeof params.reason === 'string' && params.reasonParsed === true
      ? { message: params.reason }
      : {}),
    ...(typeof params.errorType === 'string' ? { type: params.errorType } : {}),
    ...(typeof params.errorCode === 'string' || typeof params.errorCode === 'number'
      ? { code: params.errorCode }
      : {}),
  };
}

/**
 * Build a logger for the SDK, scoped by the child prefixes it asks for.
 *
 * `sink` exists so a test can assert what is forwarded and what is dropped
 * without reaching into the app logger.
 */
export function createSdkLogger(
  sink: Pick<typeof apiLog, 'warn' | 'error'> = apiLog,
  scope: string = '',
  onRefusal?: (refusal: SdkRefusal) => void
): SdkLogger {
  const emit =
    (level: 'warn' | 'error') =>
    (...args: unknown[]) => {
      const { message, detail } = split(args);
      const params: Record<string, unknown> = { scope };
      putBounded(params, 'message', message);
      const lifted = detail.length > 0 && flatten(params, detail[0]);
      // Anything this did not recognise still travels, bounded by the logger's
      // own compaction. Dropping it is how the last investigation ran out of
      // evidence.
      if (detail.length > 0 && (!lifted || detail.length > 1)) params.detail = detail;
      sink[level](`routstr.sdk.${level}`, params);
      if (onRefusal && message.includes(UPSTREAM_ERROR_MESSAGE)) {
        const refusal = refusalFrom(params);
        if (refusal) onRefusal(refusal);
      }
    };

  return {
    // The lane that prints tokens and refund bodies. Never forwarded.
    log: () => {},
    debug: () => {},
    warn: emit('warn'),
    error: emit('error'),
    child: (prefix: string) =>
      createSdkLogger(sink, scope ? `${scope}:${prefix}` : prefix, onRefusal),
  };
}
