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
 * The upstream's own sentence, dug out of the body the node returned.
 *
 * routstr-core answers with either an OpenAI-shaped `{"error":{"message":…}}`
 * (usually forwarded verbatim from whoever it called) or FastAPI's
 * `{"detail":…}`. Both are the difference between "this node is down" and
 * "this node's OpenRouter credit is exhausted", which is the whole question
 * when a perfectly healthy catalog still answers 404.
 */
function upstreamReason(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as { error?: unknown; detail?: unknown; message?: unknown };
    const error = record.error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
    if (typeof record.detail === 'string') return record.detail;
    if (typeof record.message === 'string') return record.message;
    return undefined;
  } catch {
    return undefined;
  }
}

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
  const body = record.body;
  if (typeof body === 'string') {
    params.bodyLen = body.length;
    const reason = upstreamReason(body);
    putBounded(params, 'reason', reason ?? body);
    params.reasonParsed = reason != null;
    lifted = true;
  }
  return lifted;
}

/**
 * Build a logger for the SDK, scoped by the child prefixes it asks for.
 *
 * `sink` exists so a test can assert what is forwarded and what is dropped
 * without reaching into the app logger.
 */
export function createSdkLogger(
  sink: Pick<typeof apiLog, 'warn' | 'error'> = apiLog,
  scope: string = ''
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
    };

  return {
    // The lane that prints tokens and refund bodies. Never forwarded.
    log: () => {},
    debug: () => {},
    warn: emit('warn'),
    error: emit('error'),
    child: (prefix: string) => createSdkLogger(sink, scope ? `${scope}:${prefix}` : prefix),
  };
}
